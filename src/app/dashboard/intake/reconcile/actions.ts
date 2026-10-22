"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { moveLeadStage } from "@/lib/pipeline";
import { usableEvidenceDate } from "@/lib/pipeline/evidence-date";
import { bumpLeadLastTouch } from "@/lib/leads/touch";
import { orgHasModule } from "@/lib/org/modules";
import { searchableMailboxAccess } from "@/lib/mailbox/my-mailbox";
import { readLawmaticsNotes } from "@/lib/lawmatics/notes";
import { searchPersonMail, type MailboxDeps, type MailboxSearch } from "@/lib/reconcile/mailbox-search";
import { friendlyMoveStageError } from "@/app/dashboard/leads/errors";
import { SHEET_MESSAGES, checkSheetFile, parseSheetRecords, readSheetRecords } from "@/lib/intake/sheet-read";
import { planFingerprint } from "@/lib/reconcile/fingerprint";
import { buildPlan } from "@/lib/reconcile/plan";
import { authorizeReconcile } from "@/lib/reconcile/authorize";
import { MAX_MOVES_PER_APPLY, RECONCILE_MESSAGES as MSG, isUuid } from "@/lib/reconcile/rules";
import { readLawmatics, readLeads, readStageMapping, readStages, readStoredMail } from "@/lib/reconcile/sources";
import type { ApplyResult, Confidence, MoveRequest, PlanRow, PreviewResult, RowOutcome } from "@/lib/reconcile/types";

/**
 * The two server actions behind /dashboard/intake/reconcile.
 *
 * Both resolve the session and role on EVERY call (nothing is cached) and refuse anything outside
 * owner / admin / senior_admin before reading or writing a thing. No org id is accepted from the
 * browser: every read and write goes through the caller's scoped client, so RLS is the boundary.
 *
 * Preview writes nothing anywhere. Apply writes only through `moveLeadStage`, which logs each move
 * on the lead's timeline, and nothing is ever written to Lawmatics. Messages returned to the
 * screen are fixed sentences: no database text, constraint name or org id reaches it.
 */

type Scoped = Awaited<ReturnType<typeof getScopedClient>>;

const authorize = authorizeReconcile;

function logFailure(what: string, err: unknown) {
  // A name only: an error's message can carry database text, which is never logged or shown.
  console.error(`[reconcile] ${what}`, err instanceof Error ? err.name : "error");
}

type UploadedFile = { name: string; size: number; text: () => Promise<string> };

function asUploadedFile(value: FormDataEntryValue | null): UploadedFile | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Partial<UploadedFile>;
  if (typeof file.name !== "string" || typeof file.size !== "number" || typeof file.text !== "function") return null;
  return file as UploadedFile;
}

/**
 * The mailbox search for this preview. The module and the mailboxes are read once, on the first
 * person who needs them, and only through the caller's own access: a failure in either is a named
 * state on every row, never "no mail".
 */
function mailboxSearcher(): (address: string) => Promise<MailboxSearch> {
  let deps: Promise<MailboxDeps> | null = null;
  const load = (): Promise<MailboxDeps> =>
    (deps ??= (async () => {
      let moduleOn: boolean | null = null;
      try {
        moduleOn = await orgHasModule("mailbox");
      } catch {
        moduleOn = null;
      }
      if (moduleOn !== true) return { moduleOn, mailboxes: { ok: false } as const };
      try {
        return { moduleOn, mailboxes: await searchableMailboxAccess() };
      } catch (err) {
        logFailure("read mailboxes", err);
        return { moduleOn, mailboxes: { ok: false } as const };
      }
    })());
  return async (address) => searchPersonMail(address, await load());
}

export async function previewReconcileAction(formData: FormData): Promise<PreviewResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const { supabase } = auth;

  // The file first: nothing is read for a file that cannot be used.
  const file = asUploadedFile(formData?.get?.("sheet") ?? null);
  if (!file) return { ok: false, error: SHEET_MESSAGES.noFile };
  const checked = checkSheetFile(file.name, file.size);
  if (!checked.ok) return checked;
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: MSG.badRequest };
  }
  const parsed = parseSheetRecords(text);
  if (!parsed.ok) return parsed;

  let stages;
  try {
    stages = await readStages(supabase);
  } catch (err) {
    logFailure("read stages", err);
    return { ok: false, error: MSG.stagesUnreadable };
  }
  let leads;
  try {
    leads = await readLeads(supabase);
  } catch (err) {
    logFailure("read leads", err);
    return { ok: false, error: MSG.leadsUnreadable };
  }

  const sheet = readSheetRecords(parsed.records, stages.map((s) => ({ id: s.id, name: s.name })), new Date(), {
    rowNumbers: parsed.rowNumbers,
    sections: parsed.sections,
    contacts: parsed.contacts,
  });
  // Each source stands alone: a failure here becomes that source's named state, not a failed preview.
  const lawmatics = await readLawmatics();
  const stageMapping = await readStageMapping(supabase);
  const lawmaticsClient = lawmatics.status === "ok" ? lawmatics.client : undefined;
  const { view, plan } = await buildPlan({
    fileName: file.name,
    stages,
    leads: leads.leads,
    leadsTruncated: leads.truncated,
    sheet,
    lawmatics,
    readEmail: (ids) => readStoredMail(supabase, ids),
    mapping: stageMapping.mapping,
    mappingNote: stageMapping.note,
    readLawmaticsNotes: lawmaticsClient ? (targets) => readLawmaticsNotes(lawmaticsClient, targets) : undefined,
    searchMail: mailboxSearcher(),
  });
  return { ok: true, view, plan, fingerprint: planFingerprint(plan) };
}

// ── apply ────────────────────────────────────────────────────────────────────

const CONFIDENCES: ReadonlySet<unknown> = new Set(["agree", "sheet_only", "single_source", "conflict", "no_evidence"]);
const MAX_PLAN_ROWS = 20_000;

type ApplySubmission = { plan: PlanRow[]; fingerprint: string; moves: MoveRequest[] };

function parsePlanRow(value: unknown): PlanRow | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (!isUuid(r.leadId) || !isUuid(r.fromStageId)) return null;
  if (r.proposedStageId !== null && !isUuid(r.proposedStageId)) return null;
  if (r.evidenceDate !== null && typeof r.evidenceDate !== "string") return null;
  if (r.lastTouch !== undefined && r.lastTouch !== null && typeof r.lastTouch !== "string") return null;
  if (r.confidence !== null && !CONFIDENCES.has(r.confidence)) return null;
  return {
    leadId: r.leadId,
    fromStageId: r.fromStageId,
    proposedStageId: r.proposedStageId as string | null,
    evidenceDate: r.evidenceDate as string | null,
    confidence: r.confidence as Confidence | null,
    lastTouch: (r.lastTouch as string | null | undefined) ?? null,
  };
}

function parseSubmission(input: unknown): ApplySubmission | null {
  if (!input || typeof input !== "object") return null;
  const { plan, fingerprint, moves } = input as Record<string, unknown>;
  if (typeof fingerprint !== "string" || !Array.isArray(plan) || !Array.isArray(moves)) return null;
  if (plan.length > MAX_PLAN_ROWS) return null;
  const planRows: PlanRow[] = [];
  for (const raw of plan) {
    const row = parsePlanRow(raw);
    if (!row) return null;
    planRows.push(row);
  }
  const moveRows: MoveRequest[] = [];
  for (const raw of moves) {
    if (!raw || typeof raw !== "object") return null;
    const { leadId, stageId } = raw as Record<string, unknown>;
    if (!isUuid(leadId) || !isUuid(stageId)) return null;
    moveRows.push({ leadId, stageId });
  }
  return { plan: planRows, fingerprint, moves: moveRows };
}

/**
 * Sets the lead's last touch to the proposed one: only when it is a real past date and NEWER than what the
 * lead held before this apply. Never backwards, never into the future. A move stamps "now" on its own; the
 * evidence date replaces that because a reconcile is not itself a touch. Best effort: a failure changes
 * nothing about the move, and is reported as not set.
 */
async function applyLastTouch(supabase: Scoped, leadId: string, proposed: string | null | undefined, stored: string | null, nowMs: number): Promise<boolean> {
  const usable = usableEvidenceDate(proposed, nowMs);
  if (!usable) return false;
  if (stored !== null && Date.parse(usable) <= Date.parse(stored)) return false;
  await bumpLeadLastTouch(supabase, leadId, null, new Date(usable));
  return true;
}

export async function applyReconcileAction(input: unknown): Promise<ApplyResult> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const { supabase } = auth;

  const submission = parseSubmission(input);
  if (!submission) return { ok: false, error: MSG.badRequest };
  const { plan, fingerprint, moves } = submission;
  if (moves.length === 0) return { ok: false, error: MSG.nothingChosen };
  if (moves.length > MAX_MOVES_PER_APPLY) return { ok: false, error: MSG.tooMany };
  if (new Set(moves.map((m) => m.leadId)).size !== moves.length) return { ok: false, error: MSG.badRequest };

  // (a) The plan posted back is the plan that was previewed.
  if (planFingerprint(plan) !== fingerprint) return { ok: false, error: MSG.stale, stale: true };
  const planByLead = new Map(plan.map((p) => [p.leadId, p]));
  if (planByLead.size !== plan.length || moves.some((m) => !planByLead.has(m.leadId))) {
    return { ok: false, error: MSG.stale, stale: true };
  }

  // (b) Every lead is still where the plan found it, read now through the caller's own client.
  const { data: current, error: leadError } = await supabase
    .from("crm_lead")
    .select("id, current_stage_id, last_activity_at")
    .in("id", moves.map((m) => m.leadId));
  if (leadError) {
    logFailure("re-read leads", leadError);
    return { ok: false, error: MSG.readFailed };
  }
  const currentStage = new Map((current ?? []).map((r) => [r.id, r.current_stage_id]));
  // What each lead held BEFORE any move: a move stamps now, so the comparison must use this.
  const storedTouch = new Map((current ?? []).map((r) => [r.id, (r as { last_activity_at?: string | null }).last_activity_at ?? null]));
  const nowMs = Date.now();
  if (moves.some((m) => !currentStage.has(m.leadId))) return { ok: false, error: MSG.notFound };
  if (moves.some((m) => currentStage.get(m.leadId) !== planByLead.get(m.leadId)!.fromStageId)) {
    return { ok: false, error: MSG.stale, stale: true };
  }

  // (c) Every target stage still exists, and none opens a matter.
  let stages;
  try {
    stages = await readStages(supabase);
  } catch (err) {
    logFailure("re-read stages", err);
    return { ok: false, error: MSG.readFailed };
  }
  const stageById = new Map(stages.map((s) => [s.id, s]));
  if (moves.some((m) => !stageById.has(m.stageId) || stageById.get(m.stageId)!.category === "won")) {
    return { ok: false, error: MSG.stageGone };
  }

  const outcomes: RowOutcome[] = [];
  for (const move of moves) {
    const target = stageById.get(move.stageId)!;
    const planned = planByLead.get(move.leadId)!;
    if (currentStage.get(move.leadId) === move.stageId) {
      outcomes.push({ leadId: move.leadId, status: "already", stageName: target.name, lastTouchSet: await applyLastTouch(supabase, move.leadId, planned.lastTouch, storedTouch.get(move.leadId) ?? null, nowMs) });
      continue;
    }
    // The sheet's date is evidence for the sheet's stage only; a stage the person picked has none.
    const evidence = planned.proposedStageId === move.stageId ? planned.evidenceDate : null;
    try {
      await moveLeadStage(move.leadId, move.stageId, evidence);
      outcomes.push({ leadId: move.leadId, status: "moved", stageName: target.name, lastTouchSet: await applyLastTouch(supabase, move.leadId, planned.lastTouch, storedTouch.get(move.leadId) ?? null, nowMs) });
    } catch (err) {
      logFailure("move lead", err);
      const forbidden = friendlyMoveStageError(err).startsWith("You don't have permission");
      outcomes.push({ leadId: move.leadId, status: "failed", error: forbidden ? MSG.moveForbidden : MSG.moveFailed });
    }
  }

  const totals = {
    moved: outcomes.filter((o) => o.status === "moved").length,
    already: outcomes.filter((o) => o.status === "already").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
  };
  if (totals.moved > 0) {
    revalidatePath("/dashboard/intake/");
    revalidatePath("/dashboard/leads/");
    for (const o of outcomes) if (o.status === "moved") revalidatePath(`/dashboard/leads/${o.leadId}/`);
  }
  if (totals.moved + totals.already === 0) return { ok: false, error: MSG.allFailed, outcomes };
  return { ok: true, outcomes, totals };
}
