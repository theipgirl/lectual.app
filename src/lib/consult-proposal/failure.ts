/**
 * What went wrong when a consult proposal couldn't be drafted: which STAGE it
 * failed at, one safe log line, and the sentence a person reads.
 *
 * Pure (no database, no network, no `server-only`) so it is unit-tested.
 *
 * Why this exists: the draft path used to turn every throw into one generic
 * sentence and log nothing, so a production failure left no trace. Now every
 * failure logs `{event, stage, name, message}` as one JSON line, and the cause
 * we can recognise is named to the person.
 *
 * Nothing secret is ever logged or shown: no transcript text, no tokens or
 * keys (only an environment variable's NAME), no email addresses. Messages are
 * cut to 500 characters and scrubbed of anything that looks like an address or
 * a token before they are logged.
 */

import { ProposalEmailError, type ProposalEmailRule } from "./email";

export type ConsultStage =
  /** Building what the run needs: clients, queue key, site address. */
  | "env"
  /** Reading the earlier-draft marker. */
  | "check"
  /** Reading the firm's proposal settings, name and time zone. */
  | "settings"
  /** The model call that writes the proposal. */
  | "draft"
  /** Saving the draft proposal row. */
  | "insert"
  /** Recording the evidence event. */
  | "event"
  /** Rendering the email (the proposal link rules). */
  | "email"
  /** Putting the email into the approval queue. */
  | "queue"
  /** Writing the `queue_drafted` marker. */
  | "marker";

/** A throw tagged with the stage it happened at. */
export class ConsultStageError extends Error {
  readonly stage: ConsultStage;
  readonly original: unknown;
  constructor(stage: ConsultStage, original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "ConsultStageError";
    this.stage = stage;
    this.original = original;
  }
}

const MAX_LOGGED = 500;

/** Strip anything that could be personal or secret before a message reaches a log. */
export function scrubForLog(text: string): string {
  return text
    .replace(/[^\s@<>()"',;]+@[^\s@<>()"',;]+/g, "[email]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[token]")
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, "[token]")
    .slice(0, MAX_LOGGED);
}

type ErrorParts = { name: string; message: string };

function parts(err: unknown): ErrorParts {
  if (err instanceof ConsultStageError) return parts(err.original);
  if (err instanceof Error) return { name: err.name || "Error", message: err.message };
  if (err && typeof err === "object") {
    // A PostgREST error is a plain object: { code, message, details, hint }.
    const o = err as { code?: unknown; name?: unknown; message?: unknown };
    return {
      name: typeof o.name === "string" ? o.name : typeof o.code === "string" ? `DbError:${o.code}` : "Error",
      message: typeof o.message === "string" ? o.message : "",
    };
  }
  return { name: "Error", message: String(err ?? "") };
}

/** The one log line: a JSON object with the stage and a scrubbed, shortened message. */
export function consultFailureLine(stage: ConsultStage, err: unknown): string {
  const { name, message } = parts(err);
  return JSON.stringify({ event: "consult_proposal_failed", stage, name, message: scrubForLog(message) });
}

export function logConsultFailure(stage: ConsultStage, err: unknown): void {
  try {
    console.error(consultFailureLine(stage, err));
  } catch {
    // Logging must never be the thing that fails.
  }
}

/* ─────────────────────────── what a person reads ─────────────────────────── */

const NOTHING_SENT = "Nothing was sent.";

function envKeyOf(err: unknown): { key: string; reason: string } | null {
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "EnvVarError") {
    const e = err as { key?: unknown; reason?: unknown };
    if (typeof e.key === "string") return { key: e.key, reason: e.reason === "invalid" ? "invalid" : "missing" };
  }
  return null;
}

function emailRuleOf(err: unknown): ProposalEmailRule | null {
  if (err instanceof ProposalEmailError) return err.rule;
  if (err && typeof err === "object" && (err as { name?: unknown }).name === "ProposalEmailError") {
    const rule = (err as { rule?: unknown }).rule;
    if (typeof rule === "string") return rule as ProposalEmailRule;
  }
  return null;
}

/** Why the proposal link was refused, in words, and what the deployment resolved. */
export function emailRuleSentence(rule: ProposalEmailRule | string, origin?: string | null): string {
  const resolved = origin ? ` The site address Lectual used was "${origin.replace(/[^\x21-\x7e]/g, "").slice(0, 200)}".` : "";
  switch (rule) {
    case "not_https":
      return `The proposal link address is invalid: it must start with https://.${resolved}`;
    case "claude_link":
      return `The proposal link address is invalid: it must be this site's own proposal page, never a claude.ai link.${resolved}`;
    case "credentials":
      return `The proposal link address is invalid: it must not contain a username or password.${resolved}`;
    case "no_sign_off":
      return "The email has no firm sign-off (Settings, then Firm).";
    default:
      return `The proposal link address is invalid: it isn't a web address.${resolved}`;
  }
}

function queueMessage(err: unknown): string | null {
  const { message } = parts(err);
  if (/queue api not configured/i.test(message)) {
    return "Approvals aren't connected for your firm yet, so the email couldn't be queued. Lectual will connect them.";
  }
  const status = /^Queue API (\d{3})\b/.exec(message);
  if (status) return `Approvals didn't accept the draft (it answered HTTP ${status[1]}), so the email couldn't be queued.`;
  if (/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|timed? ?out/i.test(message)) {
    return "Approvals couldn't be reached, so the email couldn't be queued.";
  }
  return null;
}

/**
 * The sentence for a failure at `stage`. `origin` is the site address the run
 * used (public, safe to show); it only appears for a refused proposal link.
 * Every sentence keeps the assurance that nothing was sent.
 */
export function describeConsultFailure(stage: ConsultStage, err: unknown, ctx: { origin?: string | null } = {}): string {
  const inner = err instanceof ConsultStageError ? err.original : err;

  const env = envKeyOf(inner);
  if (env) {
    if (env.key === "SUPABASE_SERVICE_ROLE_KEY") {
      return `The proposal couldn't be drafted because a setting on Lectual's side is missing. Use Send feedback so Lectual can fix it. ${NOTHING_SENT}`;
    }
    return `The proposal couldn't be drafted because a setting on Lectual's side is missing or wrong. Use Send feedback so Lectual can fix it. ${NOTHING_SENT}`;
  }

  const rule = emailRuleOf(inner);
  if (rule) {
    return `${emailRuleSentence(rule, ctx.origin)} The proposal was withdrawn. ${NOTHING_SENT}`;
  }

  if (stage === "queue") {
    const q = queueMessage(inner);
    if (q) return `${q} The proposal was withdrawn and nothing is waiting. ${NOTHING_SENT} Try again shortly.`;
  }

  switch (stage) {
    case "env":
      return `The proposal couldn't be drafted: Lectual's setup for your firm isn't finished. Use Send feedback so Lectual can fix it. ${NOTHING_SENT}`;
    case "check":
    case "settings":
      return `The proposal couldn't be drafted: the firm's records couldn't be read (step: ${stage}). ${NOTHING_SENT} Try again shortly.`;
    case "draft":
      return `The proposal couldn't be written (step: draft). ${NOTHING_SENT} Try again shortly.`;
    case "insert":
      return `The proposal couldn't be saved (database step: insert). ${NOTHING_SENT} Try again shortly.`;
    case "event":
      return `The proposal's activity note couldn't be saved (database step: event). The proposal was withdrawn. ${NOTHING_SENT} Try again shortly.`;
    case "email":
      return `The email couldn't be written (step: email). The proposal was withdrawn. ${NOTHING_SENT} Try again shortly.`;
    case "queue":
      return `The email couldn't be queued (step: queue). The proposal was withdrawn and nothing is waiting. ${NOTHING_SENT} Try again shortly.`;
    case "marker":
      return `The proposal and email were drafted but couldn't be linked (database step: marker), so the proposal was withdrawn. Reject the email now waiting in the approval queue. ${NOTHING_SENT}`;
  }
}
