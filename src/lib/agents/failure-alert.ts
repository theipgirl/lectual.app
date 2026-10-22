import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http/timeout";

/** Short on purpose: the alert runs inside the cron's 270 s wall budget and must never push a run past maxDuration. */
const ALERT_FETCH_TIMEOUT_MS = 10_000;
import type { AgentId } from "./types";
import { AGENT_DEFS } from "./types";

/**
 * Tells Lectual when an agent run ends as an error. The firm is told "Lectual has been told" (see
 * digest.ts `failureAction`); this is how that sentence is true.
 *
 * INTERNAL ONLY. The recipients come from AGENT_FAILURE_ALERT_TO and nothing else, so it can never
 * reach a firm or a client. The input type has no summary or client field: only the stored error text
 * (counts-only by rule), which is cut to 2,000 characters and has anything shaped like an email address
 * replaced before it goes anywhere. Sending never throws into the run and never changes its status.
 *
 * Dedupe, with no new table: at most one email per firm + agent + error signature per UTC day, judged by
 * reading that day's earlier error rows of `agent_run` through the runner's own org-fenced client.
 */

export const ALERT_ERROR_MAX_CHARS = 2_000;
export const DEFAULT_ALERT_FROM = "Lectual alerts <noreply@lectual.app>";
const RESEND_URL = "https://api.resend.com/emails";

export type FailureAlertInput = {
  orgId: string;
  firmName: string;
  agent: AgentId;
  runId: string | null;
  startedAt: string;
  finishedAt: string;
  error: string;
  vercelEnv?: string | null;
  commitSha?: string | null;
};

export type AlertConfig = { apiKey: string; to: string[]; from: string };

/** The settings, or null when alerts are off (no recipients or no key): nothing is read or sent. */
export function alertConfigFromEnv(): AlertConfig | null {
  const to = (env.AGENT_FAILURE_ALERT_TO ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const apiKey = env.RESEND_API_KEY?.trim();
  if (to.length === 0 || !apiKey) return null;
  return { apiKey, to, from: env.AGENT_FAILURE_ALERT_FROM?.trim() || DEFAULT_ALERT_FROM };
}

const EMAIL_LIKE = /[^\s<>()"',;:]+@[^\s<>()"',;]+/g;

/** Anything that looks like an email address becomes [email]. */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_LIKE, "[email]");
}

/** The first sentence of the error, with every run of digits turned into #, so "3 leads" and "5 leads" match. */
export function errorSignature(error: string): string {
  const text = error.trim().replace(/\s+/g, " ");
  const end = text.search(/[.!?](\s|$)/);
  const first = end === -1 ? text : text.slice(0, end + 1);
  return first.replace(/\d+/g, "#").toLowerCase();
}

export function alertSubject(agent: AgentId, firmName: string): string {
  return `[Lectual bug] ${agent} failed for ${redactEmails(firmName)}`;
}

export function alertBody(input: FailureAlertInput): string {
  const error = redactEmails(input.error).slice(0, ALERT_ERROR_MAX_CHARS);
  const lines = [
    `Agent: ${input.agent} (${AGENT_DEFS[input.agent].name})`,
    `Firm: ${redactEmails(input.firmName)}`,
    `Org id: ${input.orgId}`,
    `Run id: ${input.runId ?? "(no run row)"}`,
    `Started: ${input.startedAt}`,
    `Finished: ${input.finishedAt}`,
    `Deployment: ${input.vercelEnv || "unknown"}${input.commitSha ? ` @ ${input.commitSha}` : ""}`,
    "",
    "Stored error:",
    error,
  ];
  return lines.join("\n");
}

/** UTC midnight of the day `iso` falls on. */
export function utcDayStart(iso: string): string {
  return `${iso.slice(0, 10)}T00:00:00.000Z`;
}

/** Pure dedupe decision: true when an earlier row of the same day carries the same signature. */
export function alreadyAlerted(earlier: ReadonlyArray<{ error: string | null }>, error: string): boolean {
  const sig = errorSignature(error);
  return earlier.some((r) => r.error != null && errorSignature(r.error) === sig);
}

async function alreadySentToday(admin: SupabaseClient, input: FailureAlertInput): Promise<boolean> {
  try {
    let q = admin
      .from("agent_run")
      .select("id, error")
      .eq("org_id", input.orgId)
      .eq("agent", input.agent)
      .eq("status", "error")
      .gte("started_at", utcDayStart(input.startedAt))
      .lte("started_at", input.startedAt);
    if (input.runId) q = q.neq("id", input.runId);
    const { data, error } = await q;
    // An unreadable history sends: a duplicate email is better than a failure nobody heard about.
    if (error) return false;
    return alreadyAlerted((data ?? []) as Array<{ error: string | null }>, input.error);
  } catch {
    return false;
  }
}

/**
 * Sends the alert if alerts are on and this failure has not been reported today. Never throws; a
 * failed send is one log line with no content.
 */
export async function sendFailureAlert(args: {
  admin: SupabaseClient;
  input: FailureAlertInput;
  config?: AlertConfig | null;
  fetchImpl?: typeof fetch;
}): Promise<"sent" | "off" | "deduped" | "failed"> {
  try {
    const config = args.config === undefined ? alertConfigFromEnv() : args.config;
    if (!config) return "off";
    if (await alreadySentToday(args.admin, args.input)) return "deduped";
    const post = fetchWithTimeout(args.fetchImpl ?? fetch, ALERT_FETCH_TIMEOUT_MS);
    const res = await post(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.from,
        to: config.to,
        subject: alertSubject(args.input.agent, args.input.firmName),
        text: alertBody(args.input),
      }),
    });
    if (!res.ok) {
      console.error(`[failure-alert] the alert email was refused (HTTP ${res.status}).`);
      return "failed";
    }
    return "sent";
  } catch {
    console.error("[failure-alert] the alert email could not be sent.");
    return "failed";
  }
}

/** The firm's name for the subject. An unreadable name does not hold the alert back. */
export async function readFirmName(admin: SupabaseClient, orgId: string): Promise<string> {
  try {
    const { data } = await admin.from("crm_org").select("name").eq("id", orgId).maybeSingle();
    const name = (data as { name?: string } | null)?.name?.trim();
    return name || "an unnamed firm";
  } catch {
    return "an unnamed firm";
  }
}

export function deploymentInfo(): { vercelEnv: string | null; commitSha: string | null } {
  return { vercelEnv: process.env.VERCEL_ENV ?? null, commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null };
}
