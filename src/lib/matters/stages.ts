import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";

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
};

/** The columns selected wherever a MatterStage is built, embed included. */
export const MATTER_STAGE_COLUMNS = "id, code, label, order_index, is_open, waiting_on";

/**
 * Lists the active org's docket stages in board order (order_index ascending,
 * the total order 0042's unique (org_id, order_index) guarantees). RLS scopes
 * the rows to the caller's org; there is no org argument and never should be.
 *
 * At ~42 rows per firm this is cheap enough to fetch once per request and join
 * in memory, which is exactly what listMatters/getMatter do.
 */
export async function listMatterStages(): Promise<MatterStage[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_matter_stage")
    .select(MATTER_STAGE_COLUMNS)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MatterStage[];
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
  if (!matter) throw new Error("Matter not found.");

  const { data: toStage, error: toStageError } = await supabase
    .from("crm_matter_stage")
    .select(MATTER_STAGE_COLUMNS)
    .eq("id", stageId)
    .maybeSingle();
  if (toStageError) throw toStageError;
  if (!toStage) throw new Error("That stage isn't on this firm's docket.");

  // The stage being left, for the timeline entry. Absent when the matter was
  // not on the docket yet, which the payload records honestly as null rather
  // than inventing a starting point.
  let fromStage: MatterStage | null = null;
  if (matter.stage_id) {
    const { data, error } = await supabase
      .from("crm_matter_stage")
      .select(MATTER_STAGE_COLUMNS)
      .eq("id", matter.stage_id)
      .maybeSingle();
    if (error) throw error;
    fromStage = (data as MatterStage | null) ?? null;
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
