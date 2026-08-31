import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types.generated";
import type { MatterWaitingOn } from "@/lib/board/stage-rules";

/**
 * The firm's docket ladder (`crm_matter_stage`) — read only.
 *
 * Ported from theipgirl/lectual's `src/lib/matters/stages.ts`, minus its write
 * half: redefining the ladder is an admin act performed in the main repo's
 * seed script, and this app has no business doing it. Moving a matter ALONG
 * the ladder is ordinary work and lives in `./write.ts`.
 *
 * Three rules inherited from the schema and not relitigated here:
 *
 *  1. A stage's identity is its FULL `code`, letter included, as text. Nothing
 *     parses a code down to a number. Tracy's collections ladder is PC10…PC90
 *     and her litigation ladder is SERVED…CLOSED; `@/lib/practice/resolve`
 *     reads the *prefix* of the string, never an integer.
 *  2. Order is `order_index`, which the `(org_id, order_index)` unique index
 *     makes a total order. Everything downstream — board columns, the stage
 *     picker — depends on this function returning them in it.
 *  3. NO `org_id` FILTER. `getScopedClient()` carries the caller's JWT and its
 *     `active_org_id` claim; RLS scopes the rows. A redundant filter here
 *     would turn a policy regression into an empty screen instead of a loud
 *     failure, and on this product an empty screen reads as "nothing is due".
 */

export type MatterStageRow = Database["public"]["Tables"]["crm_matter_stage"]["Row"];

/**
 * The stage as every surface consumes it. Deliberately narrower than the Row:
 * `created_at`/`updated_at` are catalog bookkeeping and `org_id` has no
 * business travelling into a client component. The shape is structurally
 * identical to `BoardStage` in `@/lib/board/board`, so a `MatterStage[]` drops
 * straight into `buildBoard`.
 */
export type MatterStage = {
  id: string;
  code: string;
  label: string;
  order_index: number;
  is_open: boolean;
  waiting_on: MatterWaitingOn;
};

/** The columns selected wherever a MatterStage is built. */
export const MATTER_STAGE_COLUMNS = "id, code, label, order_index, is_open, waiting_on";

/**
 * The active org's docket stages in board order.
 *
 * At a few dozen rows per firm this is cheap enough to fetch once per request
 * and join in memory, which is exactly what `listMatters`/`getMatter` do — a
 * PostgREST embed across the composite `(stage_id, org_id)` FK would leak its
 * resolution shape into every consuming type for no gain.
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

/** A stage by id, or null when it is not on this firm's ladder (or not visible). */
export async function getMatterStage(stageId: string): Promise<MatterStage | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_matter_stage")
    .select(MATTER_STAGE_COLUMNS)
    .eq("id", stageId)
    .maybeSingle();
  if (error) throw error;
  return (data as MatterStage | null) ?? null;
}

/**
 * Index a stage list by id. Pure. Callers resolve `matter.stage_id` through
 * this rather than through an embed, so a matter pointing at a stage the
 * caller cannot see resolves to `null` — "not on the docket" — instead of
 * throwing or, worse, being dropped.
 */
export function indexStagesById(stages: readonly MatterStage[]): Map<string, MatterStage> {
  return new Map(stages.map((s) => [s.id, s]));
}
