/**
 * "Marked paid", and the follow-up steps that hang off an accepted proposal (Sprint 19).
 *
 * Pure and client-safe: no database, no clock, no `server-only`. The proposal page, the
 * list, the history and the actions all read the same few functions, so a sentence or a
 * role list exists once.
 *
 * ── WHY EVERY ENTRY IS AN `edited` EVENT ────────────────────────────────────
 * `client_proposal_event.type` is a closed set (no `paid`), its staff insert policy allows
 * only `edited` / `revised` / `viewed`, and this repo cannot add a migration. So each
 * step below is an `edited` event whose payload carries `step` and `outcome`. Readers that
 * only know "edited" must look at `step` first (`describeStepEvent`).
 *
 * ── PAID IS DERIVED, NOT STORED ─────────────────────────────────────────────
 * There is no paid column. A version is paid when its newest `paid_marked` /
 * `paid_undone` event is `paid_marked`. The read is three-state (paid / not paid /
 * couldn't be read): a failed read of the events is never "Not paid" and never "Paid".
 */

import type { Role } from "@/lib/auth/roles";

/** Who may mark a version paid, undo it, or retry a step. A subset of the staff write roles. */
export const PROPOSAL_PAID_ROLES: Role[] = ["owner", "admin", "senior_admin", "intake"];

export const PROPOSAL_STEPS = [
  "paid_marked",
  "paid_undone",
  "accept_notice",
  "lawmatics_note",
  "loe_draft",
  "accepted_file_upload",
  "loe_file_upload",
  "custom_fields",
] as const;
export type ProposalStep = (typeof PROPOSAL_STEPS)[number];

export function isProposalStep(value: unknown): value is ProposalStep {
  return typeof value === "string" && (PROPOSAL_STEPS as readonly string[]).includes(value);
}

/**
 * What a step can end as. Each step has exactly one success word (`STEP_SUCCESS`);
 * `blocked` means a person can fix it (no matter yet, not connected), `failed` means a
 * call went wrong, `skipped` means there was nothing to do.
 */
export type StepOutcome = string;
export const NON_SUCCESS_OUTCOMES = ["blocked", "failed", "skipped"] as const;

export const STEP_SUCCESS: Record<ProposalStep, string> = {
  paid_marked: "marked",
  paid_undone: "undone",
  accept_notice: "sent",
  lawmatics_note: "added",
  loe_draft: "queued",
  accepted_file_upload: "uploaded",
  loe_file_upload: "uploaded",
  custom_fields: "written",
};

/** The steps the page offers to run again, in the order the page lists them. */
export const RETRYABLE_STEPS = ["loe_draft", "accepted_file_upload", "custom_fields", "lawmatics_note", "loe_file_upload"] as const;
export type RetryableStep = (typeof RETRYABLE_STEPS)[number];

export function isRetryableStep(value: unknown): value is RetryableStep {
  return typeof value === "string" && (RETRYABLE_STEPS as readonly string[]).includes(value);
}

/** The payload of a step event. `extra` holds ids only (never a name, email or amount). */
export type StepPayload = {
  step: ProposalStep;
  outcome: StepOutcome;
  reason?: string;
} & Record<string, unknown>;

const REASON_MAX = 240;

export function stepPayload(step: ProposalStep, outcome: StepOutcome, reason?: string | null, extra: Record<string, string | number> = {}): StepPayload {
  const text = reason?.replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
  return { ...extra, step, outcome, ...(text ? { reason: text } : {}) };
}

/** The slice of a `client_proposal_event` row these functions read. */
export type StepEventInput = {
  proposal_id?: string | null;
  type?: string;
  actor?: string;
  actor_user_id?: string | null;
  created_at: string;
  payload?: unknown;
};

export type ParsedStep = { step: ProposalStep; outcome: string; reason: string | null; payload: Record<string, unknown> };

/** A step event's payload, or null when it is not one (an ordinary edit, or a payload that cannot be read). */
export function readStep(payload: unknown): ParsedStep | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (!isProposalStep(p.step) || typeof p.outcome !== "string" || !p.outcome) return null;
  return { step: p.step, outcome: p.outcome, reason: typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : null, payload: p };
}

function ms(iso: string): number {
  // PostgREST sends "…T…+00:00"; a bare "+00" offset (raw SQL) is widened so Date can read it.
  const t = Date.parse(iso.replace(" ", "T").replace(/(T[\d:.]+[+-]\d{2})$/, "$1:00"));
  return Number.isNaN(t) ? 0 : t;
}

/* ─────────────────────────── paid state ─────────────────────────────────── */

export type PaidState =
  | { state: "paid"; by: string | null; at: string }
  | { state: "not_paid"; undoneAt: string | null };

/**
 * The newest of the `paid_marked` / `paid_undone` events, whatever order they arrive in.
 * A malformed payload is ignored. Two events at the same instant read as undone: the
 * choice that offers Mark paid again, which is idempotent, rather than hiding it.
 */
export function paidStateFromEvents(events: readonly StepEventInput[]): PaidState {
  let newest: { step: ProposalStep; at: string; by: string | null } | null = null;
  for (const e of events) {
    const parsed = readStep(e.payload);
    if (!parsed || (parsed.step !== "paid_marked" && parsed.step !== "paid_undone")) continue;
    if (parsed.outcome !== STEP_SUCCESS[parsed.step]) continue;
    const here = { step: parsed.step, at: e.created_at, by: e.actor_user_id ?? null };
    if (!newest || ms(here.at) > ms(newest.at) || (ms(here.at) === ms(newest.at) && here.step === "paid_undone")) newest = here;
  }
  if (!newest) return { state: "not_paid", undoneAt: null };
  return newest.step === "paid_marked" ? { state: "paid", by: newest.by, at: newest.at } : { state: "not_paid", undoneAt: newest.at };
}

/* ─────────────────────────── step states ────────────────────────────────── */

export type StepState = { step: ProposalStep; outcome: string; reason: string | null; at: string; actor: string | null; payload: Record<string, unknown> };

/**
 * The newest event of each step for one proposal id (a version has its own id, and the
 * history is family-wide). A step with no event is absent.
 */
export function stepStates(events: readonly StepEventInput[], proposalId: string): Partial<Record<ProposalStep, StepState>> {
  const out: Partial<Record<ProposalStep, StepState>> = {};
  for (const e of events) {
    if (e.proposal_id !== undefined && e.proposal_id !== proposalId) continue;
    const parsed = readStep(e.payload);
    if (!parsed) continue;
    const seen = out[parsed.step];
    if (!seen || ms(e.created_at) > ms(seen.at)) {
      out[parsed.step] = { step: parsed.step, outcome: parsed.outcome, reason: parsed.reason, at: e.created_at, actor: e.actor_user_id ?? null, payload: parsed.payload };
    }
  }
  return out;
}

/** True when ANY event of this step for this proposal ended in the step's success word. */
export function stepSucceeded(events: readonly StepEventInput[], proposalId: string, step: ProposalStep): boolean {
  return events.some((e) => {
    if (e.proposal_id !== undefined && e.proposal_id !== proposalId) return false;
    const parsed = readStep(e.payload);
    return !!parsed && parsed.step === step && parsed.outcome === STEP_SUCCESS[step];
  });
}

/* ─────────────────────────── words ───────────────────────────────────────── */

type Words = { success: string; blocked?: string; failed: string; skipped?: string };

/**
 * One sentence per step and outcome, with no leading actor ("marked it paid"), for the
 * history. `reason` is appended where there is one.
 */
const HISTORY_WORDS: Record<ProposalStep, Words> = {
  paid_marked: { success: "marked it paid by hand (LawPay isn’t connected to proposals yet)", failed: "couldn’t mark it paid" },
  paid_undone: { success: "undid the paid mark", failed: "couldn’t undo the paid mark" },
  accept_notice: { success: "sent the firm an in-app notice that the client accepted", failed: "couldn’t send the in-app notice of the acceptance", skipped: "didn’t send the in-app notice of the acceptance" },
  lawmatics_note: { success: "added a note to Lawmatics about the acceptance", blocked: "didn’t add the acceptance note to Lawmatics", failed: "couldn’t add the acceptance note to Lawmatics", skipped: "skipped the Lawmatics acceptance note" },
  loe_draft: { success: "queued the engagement letter draft for approval", blocked: "didn’t draft the engagement letter", failed: "couldn’t draft the engagement letter", skipped: "skipped the engagement letter draft" },
  accepted_file_upload: { success: "uploaded the accepted proposal to Lawmatics", blocked: "didn’t upload the accepted proposal to Lawmatics", failed: "couldn’t upload the accepted proposal to Lawmatics", skipped: "skipped uploading the accepted proposal to Lawmatics" },
  loe_file_upload: { success: "uploaded the approved engagement letter to Lawmatics", blocked: "didn’t upload the approved engagement letter to Lawmatics", failed: "couldn’t upload the approved engagement letter to Lawmatics", skipped: "skipped uploading the approved engagement letter to Lawmatics" },
  custom_fields: { success: "wrote the LOE fields to the Lawmatics matter", blocked: "didn’t write the LOE fields to Lawmatics", failed: "couldn’t write the LOE fields to Lawmatics", skipped: "skipped the Lawmatics LOE fields" },
};

function pickWords(words: Words, outcome: string, step: ProposalStep): string {
  if (outcome === STEP_SUCCESS[step]) return words.success;
  if (outcome === "blocked") return words.blocked ?? words.failed;
  if (outcome === "skipped") return words.skipped ?? words.failed;
  return words.failed;
}

/**
 * A step event as a history clause, or null when the payload is not a step event (the
 * caller then describes it as an ordinary edit). Always has a verb, never "edited".
 */
export function describeStepEvent(payload: unknown): string | null {
  const parsed = readStep(payload);
  if (!parsed) return null;
  const text = pickWords(HISTORY_WORDS[parsed.step], parsed.outcome, parsed.step);
  return parsed.reason ? `${text}: ${parsed.reason}` : text;
}

/** The short label for the list's Last activity cell ("Marked paid"), or null for a non-step payload. */
export function stepActivityLabel(payload: unknown): string | null {
  const parsed = readStep(payload);
  if (!parsed) return null;
  const ok = parsed.outcome === STEP_SUCCESS[parsed.step];
  switch (parsed.step) {
    case "paid_marked":
      return "Marked paid";
    case "paid_undone":
      return "Paid mark undone";
    case "accept_notice":
      return ok ? "Firm notified of the acceptance" : "Acceptance notice not sent";
    case "lawmatics_note":
      return ok ? "Note added to Lawmatics" : "Lawmatics note not added";
    case "loe_draft":
      return ok ? "Engagement letter queued" : "Engagement letter not drafted";
    case "accepted_file_upload":
      return ok ? "Proposal uploaded to Lawmatics" : "Proposal not uploaded to Lawmatics";
    case "loe_file_upload":
      return ok ? "Engagement letter uploaded to Lawmatics" : "Engagement letter not uploaded";
    case "custom_fields":
      return ok ? "LOE fields written to Lawmatics" : "LOE fields not written";
  }
}
