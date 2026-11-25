import { COLUMNS_NO_PERMISSION, CUSTOM_FIELD_GONE, CUSTOM_SAVE_FAILED, CUSTOM_SAVE_FAILED_READ, FIRM_COLUMN_LABEL_NOT_CLEARED } from "@/lib/ui/words";
import type { ActionState, UpdateInput } from "@/lib/custom-columns/field-actions";
import { isCfKey } from "./validate";

/**
 * Changing a firm's OWN column from its header menu (key `cf:<field id>`): rename the FIELD itself, edit its choices, or archive it. Pure
 * over injected dependencies. Each goes through the owner-gated field logic (`updateField`), so the record card, the "Not tracked" note and
 * the name-clash rules all agree with the List. The field's rendered `updated_at` is read here (server side, right before the write):
 * the menu has no form that was drawn from it.
 *
 * A rename also clears any saved layout label for that key, so a name the owner typed in the view can never hide the field's real name.
 * If the field was renamed but a label couldn't be cleared, the answer is ok with a fixed sentence saying so.
 */
export type FirmColumnInput = { op: unknown; key: unknown; label?: unknown; choices?: unknown };
export type FirmColumnResult = { ok: true; note?: string } | { ok: false; error: string };

export type FirmColumnDeps = {
  /** An owner by the caller's own membership row. Asked first, before any read. */
  owner: () => Promise<boolean>;
  /** The field's `updated_at` as it is now, or null when there is no such field. Throws when it can't be read. */
  readStamp: (fieldId: string) => Promise<string | null>;
  update: (input: UpdateInput) => Promise<ActionState>;
  /** Clear a saved label for the key in every List layout that holds one; true when none is left (or none was there). */
  clearLabels: (key: string) => Promise<boolean>;
};

export async function changeFirmColumn(deps: FirmColumnDeps, input: FirmColumnInput): Promise<FirmColumnResult> {
  let owner = false;
  try {
    owner = (await deps.owner()) === true;
  } catch {
    owner = false;
  }
  if (!owner) return { ok: false, error: COLUMNS_NO_PERMISSION };
  const op = input.op === "rename" || input.op === "options" || input.op === "archive" ? input.op : null;
  if (!op || !isCfKey(input.key)) return { ok: false, error: CUSTOM_SAVE_FAILED };
  const id = input.key.slice(3);
  let stamp: string | null;
  try {
    stamp = await deps.readStamp(id);
  } catch {
    return { ok: false, error: CUSTOM_SAVE_FAILED_READ };
  }
  if (!stamp) return { ok: false, error: CUSTOM_FIELD_GONE };
  let state: ActionState;
  try {
    state = await deps.update(
      op === "rename" ? { op, id, label: input.label, updatedAt: stamp } : op === "options" ? { op, id, choices: input.choices, updatedAt: stamp } : { op, id },
    );
  } catch {
    return { ok: false, error: CUSTOM_SAVE_FAILED };
  }
  if (!state.saved) return { ok: false, error: state.error ?? CUSTOM_SAVE_FAILED };
  if (op !== "rename") return { ok: true };
  let cleared = false;
  try {
    cleared = await deps.clearLabels(input.key);
  } catch {
    cleared = false;
  }
  return cleared ? { ok: true } : { ok: true, note: FIRM_COLUMN_LABEL_NOT_CLEARED };
}
