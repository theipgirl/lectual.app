import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { parseIntakeConfig } from "./config";
import { generateRequestToken } from "./request-token";
import { isMissingTableError } from "./store";

/**
 * "Send intake questions" on a matter (`crm_intake_request`, 0079), through
 * the caller's SCOPED client only: RLS keys every statement on the active org,
 * and 0079's policies let anyone but a viewer create or revoke. The role is
 * also checked here, on every call, so a viewer gets a sentence, not a
 * permission error.
 *
 * Creating a request makes a link and nothing else. Nothing is emailed: the
 * firm copies the link and sends it the way it sends everything else.
 */

export type IntakeRequestRow = {
  id: string;
  token: string;
  status: "sent" | "completed" | "revoked";
  sentAt: string;
  completedAt: string | null;
};

export type IntakeRequestsLoad =
  | { status: "ok"; requests: IntakeRequestRow[]; formReady: boolean }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export class IntakeRequestError extends Error {}

export function canSendIntakeRequest(role: Role | null | undefined): boolean {
  return !!role && role !== "viewer";
}

async function requireSenderRole(): Promise<void> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  if (typeof data !== "string" || !(ROLES as readonly string[]).includes(data) || !canSendIntakeRequest(data as Role)) {
    throw new IntakeRequestError("Your role can view this matter but not send intake questions.");
  }
}

/** The matter's requests, newest first, and whether the firm has questions to send. */
export async function listMatterIntakeRequests(matterId: string): Promise<IntakeRequestsLoad> {
  try {
    const supabase = await getScopedClient();
    const [reqs, form] = await Promise.all([
      supabase
        .from("crm_intake_request")
        .select("id, token, status, sent_at, completed_at")
        .eq("matter_id", matterId)
        .order("sent_at", { ascending: false })
        .limit(20),
      supabase.from("crm_intake_form").select("config").maybeSingle(),
    ]);
    if (reqs.error) return isMissingTableError(reqs.error) ? { status: "unconfigured" } : { status: "unavailable" };
    if (form.error) return isMissingTableError(form.error) ? { status: "unconfigured" } : { status: "unavailable" };
    const formReady = !!form.data && parseIntakeConfig(form.data.config).questions.some((q) => q.text.trim());
    return {
      status: "ok",
      formReady,
      requests: (reqs.data ?? []).map((r) => ({
        id: r.id,
        token: r.token,
        status: r.status === "completed" || r.status === "revoked" ? r.status : "sent",
        sentAt: r.sent_at,
        completedAt: r.completed_at,
      })),
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** Creates a request on a matter the caller can see; returns its token. */
export async function createMatterIntakeRequest(matterId: string): Promise<string> {
  await requireSenderRole();
  const supabase = await getScopedClient();

  // Through RLS: another firm's matter id is simply not found.
  const { data: matter, error: matterErr } = await supabase.from("crm_matter").select("id, org_id").eq("id", matterId).maybeSingle();
  if (matterErr) throw matterErr;
  if (!matter) throw new IntakeRequestError("That matter isn't available.");

  const { data: form, error: formErr } = await supabase.from("crm_intake_form").select("id, config").maybeSingle();
  if (formErr) throw formErr;
  if (!form || !parseIntakeConfig(form.config).questions.some((q) => q.text.trim())) {
    throw new IntakeRequestError("Set up your intake questions in Intake → Forms first.");
  }

  const { data: user } = await supabase.auth.getUser();
  const token = generateRequestToken();
  const { error } = await supabase.from("crm_intake_request").insert({
    // The matter's own org, read through RLS; 0079's composite keys and the
    // insert policy both refuse anything else.
    org_id: matter.org_id,
    form_id: form.id,
    matter_id: matter.id,
    token,
    sent_by: user.user?.id ?? null,
  });
  if (error) throw error;
  return token;
}

/** Withdraws a link that hasn't been answered. A completed request stays completed. */
export async function revokeMatterIntakeRequest(matterId: string, requestId: string): Promise<void> {
  await requireSenderRole();
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_intake_request")
    .update({ status: "revoked" })
    .eq("id", requestId)
    .eq("matter_id", matterId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new IntakeRequestError("That link was already answered or withdrawn.");
}
