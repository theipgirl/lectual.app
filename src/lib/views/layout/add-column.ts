import { LAYOUT_PLACE_NOT_SAVED, CUSTOM_SAVE_FAILED } from "@/lib/ui/words";
import type { ActionState, CreateInput } from "@/lib/custom-columns/field-actions";
import { isReviewListView } from "@/lib/review/layout";
import { cfKey } from "./validate";
import type { LayoutResult } from "./save";

/**
 * "Add a column" from a column's menu: create the firm's field AND put its `cf:` key where the owner chose, in one action. Pure over
 * injected dependencies (the field create is `createFieldWithId`, the layout write is `changeLayout`).
 *
 * The field is created first (it asks the owner membership row itself, and its own rules, before anything is written). If the field is
 * made but its place can't be saved (the layout changed meanwhile, the table isn't there, a failed write), the column still shows: a
 * layout draws any column it doesn't name at the end. The answer then says so (`placed: false`) with a fixed sentence.
 */
export type AddColumnInput = { view: unknown; rev: unknown; relativeTo: unknown; side: unknown; label: unknown; section: unknown; kind: unknown; choices: unknown };

export type AddColumnResult = { ok: true; rev: number | null; placed: boolean; /** Said when the column was added but not placed. */ note?: string } | { ok: false; error: string };

export type AddColumnDeps = {
  createField: (input: CreateInput) => Promise<{ state: ActionState; id: string | null }>;
  /** The layout write, with the operation it was handed (the owner check happens inside). */
  changeLayout: (view: unknown, op: unknown, rev: unknown) => Promise<LayoutResult>;
};

export async function addColumn(deps: AddColumnDeps, input: AddColumnInput): Promise<AddColumnResult> {
  // Only a List section can take a new column; any other view, a bad side or a missing neighbour is refused before a field is made:
  // nothing half done for a request that could never be placed.
  if (!isReviewListView(input.view) || (input.side !== "left" && input.side !== "right") || typeof input.relativeTo !== "string") return { ok: false, error: CUSTOM_SAVE_FAILED };
  let made: { state: ActionState; id: string | null };
  try {
    made = await deps.createField({ label: input.label, section: input.section, kind: input.kind, choices: input.choices });
  } catch {
    return { ok: false, error: CUSTOM_SAVE_FAILED };
  }
  if (!made.state.saved) return { ok: false, error: made.state.error ?? CUSTOM_SAVE_FAILED };
  const unplaced = (): AddColumnResult => ({ ok: true, rev: null, placed: false, note: LAYOUT_PLACE_NOT_SAVED });
  if (!made.id) return unplaced();
  let placed: LayoutResult;
  try {
    placed = await deps.changeLayout(input.view, { op: "insert", key: cfKey(made.id), relativeTo: input.relativeTo, side: input.side }, input.rev);
  } catch {
    return unplaced();
  }
  return placed.ok ? { ok: true, rev: placed.rev, placed: true } : unplaced();
}
