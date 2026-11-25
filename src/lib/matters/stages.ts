import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";
import { ReadableError } from "@/lib/ui/readable-error";
import { isMissingColumnError } from "./phase-group";


/**
 * The prosecution docket's read layer (crm_matter_stage,
 * supabase/migrations/0042_matter_stage.sql).
 *
 * 0042 built the whole write side — the table, the composite FK, the RLS
 * template, the seed script — and then nothing ever selected from it. 110 RPB
 * matters carry a stage_id that no surface could see, which is why the matters
 * list reads as a flat table and the matter page shows no stage at all. This
 * module is the missing half.
 *
 * Two rules inherited from the migration and not to be relitigated here:
 *
 *  1. A stage's identity is its FULL `code`, letter included, as text. '19A'
 *     (a response is OWED to the USPTO) and '19F' (it was already FILED) are
 *     opposite states sharing a numeric prefix. Nothing in this file parses a
 *     code back down to a number, and nothing downstream should either.
 *  2. Whether a quiet matter is a problem depends on WHO is holding it. That
 *     lives in the stage's `waiting_on` column, not in a hardcoded list of
 *     stage numbers — see matterIsStale below.
 */

export type MatterStageRow = Database["public"]["Tables"]["crm_matter_stage"]["Row"];
// The enum is re-exported from stage-rules so client components can name it
// without importing this (server-only) module. Kept structurally identical to
// the DB enum; the assertion below fails the build if they ever drift.
export type { MatterWaitingOn } from "./stage-rules";
type WaitingOnDb = Database["public"]["Enums"]["crm_matter_waiting_on"];
type MatterWaitingOn = WaitingOnDb;

/**
 * The stage as every surface consumes it: the six columns a docket board, a
 * table chip, or a stale badge actually needs. Deliberately narrower than the
 * Row — created_at/updated_at/org_id are catalog bookkeeping, and org_id in
 * particular has no business travelling into a client component.
 */
export type MatterStage = {
  id: string;
  code: string;
  label: string;
  order_index: number;
  is_open: boolean;
  waiting_on: MatterWaitingOn;
  /**
   * pipeline | pre_filing | post_filing | maintenance, or null. ABSENT (undefined) when the database has no
   * `phase` column yet: every read falls back to the old columns. Read only by phase-group.ts.
   */
  phase?: string | null;
  /** The stage's role (lectual 0119): ABSENT when the database has no `role` column. Read before the label by the rules. */
  role?: string | null;
};

/** The columns selected wherever a MatterStage is built, embed included. */
export const MATTER_STAGE_COLUMNS = "id, code, label, order_index, is_open, waiting_on, phase";
/** What every read falls back to on a database whose crm_matter_stage has no `phase` column (42703 / PGRST204). */
export const MATTER_STAGE_COLUMNS_NO_PHASE = "id, code, label, order_index, is_open, waiting_on";

/**
 * Lists the active org's docket stages in board order (order_index ascending,
 * the total order 0042's unique (org_id, order_index) guarantees). RLS scopes
 * the rows to the caller's org; there is no org argument and never should be.
 *
 * At ~42 rows per firm this is cheap enough to fetch once per request and join
 * in memory, which is exactly what listMatters/getMatter do.
 */
export async function listMatterStages(): Promise<MatterStage[]> {
  const read = await loadMatterStages();
  if (read.status === "unavailable") throw read.error;
  return read.stages;
}

/**
 * The stage list with its phase state, three states, never two:
 *  - ok: read with the `phase` column.
 *  - not-set-up: the database has no `phase` column (error CODE 42703 / PGRST204, never message text); the stages are
 *    read again without it and carry no phase.
 *  - unavailable: any other failure. A failed read, never "no phases".
 */
export type MatterStageRead =
  | { status: "ok"; stages: MatterStage[] }
  | { status: "not-set-up"; stages: MatterStage[] }
  | { status: "unavailable"; error: unknown };

/** The four selects a stage read tries, newest database first: `role` (lectual 0119) and `phase` each fall away on their own. */
const READ_ATTEMPTS: ReadonlyArray<{ cols: string; phase: boolean }> = [
  { cols: `${MATTER_STAGE_COLUMNS}, role`, phase: true },
  { cols: `${MATTER_STAGE_COLUMNS_NO_PHASE}, role`, phase: false },
  { cols: MATTER_STAGE_COLUMNS, phase: true },
  { cols: MATTER_STAGE_COLUMNS_NO_PHASE, phase: false },
];

/**
 * Runs `read` over the attempts in order, moving on ONLY when the database says a column is missing (by CODE). Any other error
 * stops at once. A read with `role` that fails for a missing column is followed by one without it, so a database without 0119
 * reads exactly as before.
 */
async function readWithFallback<R extends { error: unknown }>(read: (cols: string) => PromiseLike<R>): Promise<{ result: R; phase: boolean }> {
  let last: { result: R; phase: boolean } | null = null;
  for (const attempt of READ_ATTEMPTS) {
    const result = await read(attempt.cols);
    last = { result, phase: attempt.phase };
    if (!result.error || !isMissingColumnError(result.error as { code?: string | null })) return last;
  }
  return last as { result: R; phase: boolean };
}

export async function loadMatterStages(): Promise<MatterStageRead> {
  const supabase = await getScopedClient();
  const { result, phase } = await readWithFallback((cols) => supabase.from("crm_matter_stage").select(cols).order("order_index", { ascending: true }));
  if (result.error) return { status: "unavailable", error: result.error };
  const stages = (result.data ?? []) as unknown as MatterStage[];
  return phase ? { status: "ok", stages } : { status: "not-set-up", stages };
}

/** One stage by id, with the same fall-back to the old columns when `phase` or `role` isn't there. */
async function readStageById(supabase: Awaited<ReturnType<typeof getScopedClient>>, id: string): Promise<MatterStage | null> {
  const { result } = await readWithFallback((cols) => supabase.from("crm_matter_stage").select(cols).eq("id", id).maybeSingle());
  if (result.error) throw result.error;
  return (result.data as unknown as MatterStage | null) ?? null;
}

// The pure rules live in ./stage-rules so the board can import them from a
// client component; re-exported here so server code has one import site.
export { daysInStage, STALE_THRESHOLD_DAYS, matterIsStale } from "./stage-rules";

/**
 * Moves a matter to a stage on the firm's own docket and records the move on
 * the matter's timeline.
 *
 * Staff-role-gated through requireMatterWriteRole — the same list the
 * crm_matter_deadline write policies use (owner/admin/senior_admin/intake/
 * paralegal/law_clerk/attorney/clerk; every staff role except social_media and
 * viewer). Moving a matter ALONG the docket is ordinary work; redefining the
 * docket itself is the admin-gated write on crm_matter_stage, and this function
 * never performs it.
 *
 * Both reads go through the caller's own scoped client, so RLS is what proves
 * the matter and the stage belong to the caller's org — this function never
 * takes an org id, and the composite FK (stage_id, org_id) is the backstop that
 * makes a cross-tenant link impossible even if this layer were bypassed.
 *
 * stage_entered_at is stamped with the transition (0042's
 * crm_matter_stage_entered_together check requires the pair to travel
 * together): it is the clock matterIsStale measures against.
 *
 * The activity row is an INSERT and nothing else — crm_activity is append-only,
 * enforced by DB triggers that reject every update/delete path including
 * service-role. It is written after the update succeeds, so the timeline can
 * never claim a move that didn't happen.
 */
export async function updateMatterStage(matterId: string, stageId: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("id, org_id, stage_id")
    .eq("id", matterId)
    .maybeSingle();
  if (matterError) throw matterError;
  if (!matter) throw new ReadableError("Matter not found.");

  const toStage = await readStageById(supabase, stageId);
  if (!toStage) throw new ReadableError("That stage isn't on this firm's docket.");

  // The stage being left, for the timeline entry. Absent when the matter was
  // not on the docket yet, which the payload records honestly as null rather
  // than inventing a starting point.
  let fromStage: MatterStage | null = null;
  if (matter.stage_id) {
    fromStage = await readStageById(supabase, matter.stage_id);
  }

  if (matter.stage_id === stageId) return;

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("crm_matter")
    .update({ stage_id: stageId, stage_entered_at: now, updated_at: now })
    .eq("id", matterId);
  if (updateError) throw updateError;

  // actor_id is the signed-in caller's own id, read from the session — never
  // passed in, the same rule logActivity follows.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { error: activityError } = await supabase.from("crm_activity").insert({
    org_id: matter.org_id,
    matter_id: matterId,
    type: "stage_changed",
    actor_type: "user",
    actor_id: user?.id ?? null,
    payload: {
      from_code: fromStage?.code ?? null,
      from_label: fromStage?.label ?? null,
      to_code: (toStage as MatterStage).code,
      to_label: (toStage as MatterStage).label,
    },
  });
  if (activityError) throw activityError;
}
