import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import type { Database, Json } from "@/lib/db/types";
import { askClaude } from "@/lib/ai/claude";
import { parseIntakeConfig, publicConfig, type IntakeFormConfig, type PublicIntakeConfig } from "./config";
import { publicPackages, type LibraryItem } from "./packages";
import {
  answersNote,
  firstOpenIntakeStageId,
  leadFromSubmission,
  type ValidatedSubmission,
} from "./public-submit";
import { buildScreeningPrompt, parseScreening, SCREENING_SYSTEM } from "./screening";
import { isRequestTokenShape } from "./request-token";
import { isMissingTableError } from "./store";
import type { IntakeAnswer } from "./submission";
import type { Stage } from "@/lib/pipeline/stages";

/**
 * The `/i/<slug>` and `/r/<token>` read and write path — the only
 * service-role code in the intake feature, and it runs for callers who have
 * no session at all.
 *
 * ── WHY A SERVICE-ROLE CLIENT, AND WHAT FENCES IT ───────────────────────────
 * A prospect has no JWT, so `current_org_id()` is null and every 0075 policy
 * returns nothing — correct, and useless for a public page. So RLS is not the
 * boundary on these routes; the SLUG (a published, live form) or the TOKEN
 * (32 random bytes) is. Every rule below exists because of that:
 *
 *  1. The row is found by EXACT `slug` / `token` match and nothing else, and
 *     only in its public state: a form must be `live`, a request `sent`.
 *     Draft, unknown, revoked, completed and malformed all read `not_found`,
 *     so the page cannot be used as an oracle.
 *  2. EXPLICIT COLUMN LISTS, never `*`: a column added later cannot reach a
 *     public page by accident.
 *  3. Every other read (org name, fee packages, stages) and EVERY WRITE is
 *     fenced on the `org_id` (and `id`) read off that row — never on anything
 *     the browser sent. 0075's composite foreign keys back this up: a
 *     submission, lead link or request can't point at another firm's rows
 *     even from the service role.
 *  4. The config is parsed here and only `publicConfig()` of it leaves: the
 *     firm's notes and fit criteria stay on the server. The full config is
 *     kept on the server-side handle for validation and screening.
 *
 * ── THE WRITES, ALL OF THEM ─────────────────────────────────────────────────
 *   /i/<slug>   crm_intake_event (visit/start/complete), crm_intake_submission,
 *               crm_lead (+ submission.lead_id), crm_activity (lead_created,
 *               note), and the submission's fit/screening_note.
 *   /r/<token>  crm_intake_request (answers, completed) and a crm_activity
 *               note on its matter.
 * Nothing is emailed or sent to anyone. A lead is created for the firm to
 * work; anything the firm later sends goes through the approval queue.
 */

type Admin = ReturnType<typeof getAdminClient>;

function db(): Admin {
  // Built per call, never cached: see src/lib/quotes/public.ts.
  return getAdminClient();
}

type PgError = { code?: string; message?: string } | null | undefined;

const FORM_COLUMNS = "id, org_id, slug, status, config, allowed_domains, receives_referrals";

/** Server-side only. Never pass this to a client component. */
export type IntakeHandle = {
  formId: string;
  orgId: string;
  slug: string;
  config: IntakeFormConfig;
  orgName: string;
  receivesReferrals: boolean;
};

export type PublicIntakeRead =
  | { status: "ok"; handle: IntakeHandle; view: PublicIntakeConfig; packages: { name: string; price: string; includes: string }[] }
  | { status: "not_found" }
  | { status: "unconfigured" }
  | { status: "unavailable" };

const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

async function orgName(admin: Admin, orgId: string): Promise<string | null> {
  const { data, error } = await admin.from("crm_org").select("name").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return data?.name ?? null;
}

/** The handle alone (for actions): the live form by slug, config parsed. */
export async function readIntakeHandle(slug: string): Promise<
  { status: "ok"; handle: IntakeHandle } | { status: "not_found" } | { status: "unconfigured" } | { status: "unavailable" }
> {
  if (!SLUG_SHAPE.test(slug)) return { status: "not_found" };
  try {
    const admin = db();
    const { data, error } = await admin
      .from("crm_intake_form")
      .select(FORM_COLUMNS)
      .eq("slug", slug)
      .eq("status", "live")
      .maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable" };
    if (!data) return { status: "not_found" };
    const name = await orgName(admin, data.org_id);
    if (!name) return { status: "not_found" };
    return {
      status: "ok",
      handle: {
        formId: data.id,
        orgId: data.org_id,
        slug: data.slug,
        config: parseIntakeConfig(data.config),
        orgName: name,
        receivesReferrals: data.receives_referrals,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** The page's read: handle + public view + the fee packages marked visible. */
export async function readPublicIntake(slug: string): Promise<PublicIntakeRead> {
  const read = await readIntakeHandle(slug);
  if (read.status !== "ok") return read;
  const { handle } = read;
  let packages: { name: string; price: string; includes: string }[] = [];
  if (handle.config.feesOn && handle.config.visiblePackageIds.length) {
    try {
      const { data, error } = await db()
        .from("crm_service_item")
        .select("id, label, description, kind, unit_amount_cents, active, sort_index")
        .eq("org_id", handle.orgId)
        .in("id", handle.config.visiblePackageIds);
      if (error) return { status: "unavailable" };
      packages = publicPackages((data ?? []) as LibraryItem[], handle.config);
    } catch {
      // Prices shown wrong or missing would misstate the firm's fees; say
      // the page is unavailable rather than silently dropping them.
      return { status: "unavailable" };
    }
  }
  return {
    status: "ok",
    handle,
    view: publicConfig(handle.config, { orgName: handle.orgName, receivesReferrals: handle.receivesReferrals }),
    packages,
  };
}

// ── events ───────────────────────────────────────────────────────────────────

export type IntakeEventKind = "visit" | "start_conversation" | "start_form" | "complete";

/** Best-effort: a broken funnel table must never break the intake. */
export async function recordIntakeEvent(handle: IntakeHandle, kind: IntakeEventKind, sessionHash: string | null): Promise<void> {
  try {
    await db().from("crm_intake_event").insert({ org_id: handle.orgId, form_id: handle.formId, kind, session_hash: sessionHash });
  } catch {
    // swallowed on purpose
  }
}

/** Completed intakes from this session in the window: the database half of the throttle. */
export async function recentCompletions(handle: IntakeHandle, sessionHash: string, sinceIso: string): Promise<number> {
  try {
    const { count, error } = await db()
      .from("crm_intake_event")
      .select("id", { count: "exact", head: true })
      .eq("org_id", handle.orgId)
      .eq("form_id", handle.formId)
      .eq("kind", "complete")
      .eq("session_hash", sessionHash)
      .gte("occurred_at", sinceIso);
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

// ── submission ───────────────────────────────────────────────────────────────

type ActivityType = Database["public"]["Tables"]["crm_activity"]["Insert"]["type"];

export type SubmitOutcome = { ok: true; submissionId: string; leadId: string | null } | { ok: false };

/**
 * Files one validated intake. The submission row is written FIRST and is the
 * only step whose failure the prospect hears about ("we couldn't send this"):
 * once it exists the firm has the intake on its Performance tab, so a lead
 * or timeline write that fails afterwards is logged, not shown.
 */
export async function submitPublicIntake(
  handle: IntakeHandle,
  sub: ValidatedSubmission,
  ctx: { sourceHost: string | null; startedAt: number; now: Date },
): Promise<SubmitOutcome> {
  const admin = db();
  const nowIso = ctx.now.toISOString();
  const { data: row, error } = await admin
    .from("crm_intake_submission")
    .insert({
      org_id: handle.orgId,
      form_id: handle.formId,
      mode: sub.mode,
      contact: sub.contact as unknown as Json,
      answers: sub.answers as unknown as Json,
      source_host: ctx.sourceHost,
      started_at: new Date(Math.min(ctx.startedAt, ctx.now.getTime())).toISOString(),
      submitted_at: nowIso,
      last_active_at: nowIso,
    })
    .select("id")
    .single();
  if (error || !row) {
    console.error("[intake] submission insert failed", error?.code ?? "unknown");
    return { ok: false };
  }

  let leadId: string | null = null;
  try {
    leadId = await createIntakeLead(admin, handle, sub, ctx.sourceHost, nowIso);
    if (leadId) {
      const { error: linkErr } = await admin
        .from("crm_intake_submission")
        .update({ lead_id: leadId })
        .eq("id", row.id)
        .eq("org_id", handle.orgId);
      if (linkErr) console.error("[intake] lead link failed", linkErr.code);
    }
  } catch (e) {
    console.error("[intake] lead creation failed", (e as PgError)?.code ?? "unknown");
  }
  return { ok: true, submissionId: row.id, leadId };
}

async function createIntakeLead(
  admin: Admin,
  handle: IntakeHandle,
  sub: ValidatedSubmission,
  sourceHost: string | null,
  nowIso: string,
): Promise<string | null> {
  const { data: stages, error: stageErr } = await admin
    .from("crm_stage")
    .select("id, org_id, name, category, order_index, aging_threshold_days, created_at")
    .eq("org_id", handle.orgId);
  if (stageErr) throw stageErr;
  const stageId = firstOpenIntakeStageId((stages ?? []) as Stage[]);
  if (!stageId) return null;

  const fields = leadFromSubmission(sub, handle.config, sourceHost);
  const { data: lead, error } = await admin
    .from("crm_lead")
    .insert({
      org_id: handle.orgId,
      ...fields,
      current_stage_id: stageId,
      stage_entered_at: nowIso,
      last_activity_at: nowIso,
      last_inbound_at: nowIso,
    })
    .select("id")
    .single();
  if (error) throw error;

  const activity = [
    {
      org_id: handle.orgId,
      lead_id: lead.id,
      // 0033's value; the generated enum predates it (src/lib/matters/activity.ts).
      type: "lead_created" as ActivityType,
      actor_id: null,
      actor_type: "system" as const,
      payload: { summary: sub.contact.name, email: sub.contact.email, stage_id: stageId, source: "Intake form", mode: sub.mode },
    },
    {
      org_id: handle.orgId,
      lead_id: lead.id,
      type: "note" as ActivityType,
      actor_id: null,
      actor_type: "system" as const,
      payload: {
        note: answersNote(`Intake form (${sub.mode === "conversation" ? "chat" : "form"}${sourceHost ? ` on ${sourceHost}` : ""})`, sub.answers, sub.contact),
        source: "intake-form",
      },
    },
  ];
  const { error: actErr } = await admin.from("crm_activity").insert(activity);
  if (actErr) console.error("[intake] lead timeline write failed", actErr.code);
  return lead.id;
}

/**
 * Scores fit against the firm's criteria and files the note on the
 * submission. Runs after the response (`after()`); every failure — no key,
 * a refusal, a timeout, an unparseable answer — leaves `unscored`.
 */
export async function screenSubmission(handle: IntakeHandle, submissionId: string, sub: ValidatedSubmission): Promise<void> {
  try {
    const result = await askClaude({ system: SCREENING_SYSTEM, prompt: buildScreeningPrompt(handle.config, sub), maxTokens: 600 });
    if ("skipped" in result) return;
    const parsed = parseScreening(result.text);
    if (parsed.fit === "unscored" && !parsed.note) return;
    await db()
      .from("crm_intake_submission")
      .update({ fit: parsed.fit, screening_note: parsed.note })
      .eq("id", submissionId)
      .eq("org_id", handle.orgId);
  } catch {
    // Screening is advisory; the intake is already filed.
  }
}

// ── /r/<token> ───────────────────────────────────────────────────────────────

export type RequestHandle = { id: string; orgId: string; matterId: string; questions: IntakeFormConfig["questions"]; firmName: string };

export type PublicRequestRead =
  | { status: "ok"; handle: RequestHandle }
  | { status: "not_found" }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export async function readPublicRequest(token: string): Promise<PublicRequestRead> {
  if (!isRequestTokenShape(token)) return { status: "not_found" };
  try {
    const admin = db();
    const { data, error } = await admin
      .from("crm_intake_request")
      .select("id, org_id, form_id, matter_id, status")
      .eq("token", token)
      .eq("status", "sent")
      .maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "unconfigured" } : { status: "unavailable" };
    if (!data) return { status: "not_found" };
    const { data: form, error: formErr } = await admin
      .from("crm_intake_form")
      .select("config")
      .eq("id", data.form_id)
      .eq("org_id", data.org_id)
      .maybeSingle();
    if (formErr) return { status: "unavailable" };
    if (!form) return { status: "not_found" };
    const config = parseIntakeConfig(form.config);
    const name = await orgName(admin, data.org_id);
    if (!name) return { status: "not_found" };
    const questions = config.questions.filter((q) => q.text.trim());
    if (!questions.length) return { status: "not_found" };
    return {
      status: "ok",
      handle: { id: data.id, orgId: data.org_id, matterId: data.matter_id, questions, firmName: config.firmName.trim() || name },
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Files a client's answers. The update is conditional on `status = 'sent'`,
 * so a second submit (or a revoke that landed first) changes nothing and
 * reads as `gone`.
 */
export async function completePublicRequest(handle: RequestHandle, answers: IntakeAnswer[], now: Date): Promise<"ok" | "gone" | "failed"> {
  const admin = db();
  const { data, error } = await admin
    .from("crm_intake_request")
    .update({ answers: answers as unknown as Json, status: "completed", completed_at: now.toISOString() })
    .eq("id", handle.id)
    .eq("org_id", handle.orgId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[intake] request completion failed", error.code);
    return "failed";
  }
  if (!data) return "gone";
  const { error: actErr } = await admin.from("crm_activity").insert({
    org_id: handle.orgId,
    matter_id: handle.matterId,
    type: "note",
    actor_id: null,
    actor_type: "system",
    payload: { note: answersNote("Intake questions answered by the client", answers), source: "intake-request", request_id: handle.id },
  });
  if (actErr) console.error("[intake] request timeline write failed", actErr.code);
  return "ok";
}
