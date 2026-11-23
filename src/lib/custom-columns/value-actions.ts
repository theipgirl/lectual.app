import { isFieldId, type CustomKind } from "@/lib/review/sheet-columns";
import {
  CUSTOM_COLUMN_ARCHIVED,
  CUSTOM_COLUMNS_NOT_READY,
  CUSTOM_FIELD_GONE,
  CUSTOM_MONEY_OWNER_ONLY,
  CUSTOM_PERSON_NOT_MEMBER,
  CUSTOM_TEAM_UNREADABLE,
  CUSTOM_VALUE_CHANGED,
  CUSTOM_VALUE_SAVE_FAILED,
  CUSTOM_WRONG_SECTION,
  MERGE_POINTER_UNREADABLE,
  RECORD_CARD_GONE,
  RECORD_CARD_NO_PERMISSION,
} from "@/lib/ui/words";
import { customColumnsError, isMissingTable, isOnePerRecordConflict } from "./errors";
import { parseValueInput, type CustomInputValue } from "./input";
import { canSeeCustomMoney, canWriteCustomValue } from "./rules";
import { optionsShapeOk } from "./text";
import type { ActionState, FieldRow } from "./field-actions";

/**
 * The logic behind typing a value in a firm's column (the owner Sheet and the opened card). Dependencies are injected. It stores by
 * read-then-insert-or-update, never an upsert (0115 "WRITES": the conflict-update form needs UPDATE on org_id, field_id, lead_id and
 * matter_id, which is not granted), ONE row per request. The role is re-resolved on every call; the org comes from the RECORD ROW read
 * through the caller's scoped client; the person value is data checked against the directory, never used to authorize.
 */

export type RecordKind = "lead" | "matter";
export type RecordRow = { id: string; org_id: string; type?: string | null };
export type ValueColumn = "value_text" | "value_date" | "value_cents" | "value_choice" | "value_user_id";
export type ValueInsert = { org_id: string; field_id: string; lead_id?: string; matter_id?: string } & Partial<Record<ValueColumn, string | number>>;

export type ValueDeps = {
  /** `resolveCurrentRole` through the scoped client: throws on an RPC error or no role. */
  role: () => Promise<string>;
  readField: (id: string) => Promise<FieldRow | null>;
  /** `keeperForWrite`: a merged lead's keeper; throws when the pointer can't be read. */
  keeper: (leadId: string) => Promise<string>;
  readRecord: (kind: RecordKind, id: string) => Promise<RecordRow | null>;
  readMembers: () => Promise<{ userId: string }[]>;
  readValueRow: (fieldId: string, kind: RecordKind, recordId: string) => Promise<{ id: string } | null>;
  insertValue: (row: ValueInsert) => Promise<void>;
  updateValue: (id: string, patch: Partial<Record<ValueColumn, string | number>>) => Promise<number>;
  deleteValue: (id: string) => Promise<number>;
  revalidate: (kind: RecordKind, id: string) => void;
};

export type ValueInput = { fieldId: unknown; kind: unknown; id: unknown; value: unknown };

export const KIND_COLUMN: Record<CustomKind, ValueColumn> = { text: "value_text", date: "value_date", money: "value_cents", choice: "value_choice", person: "value_user_id" };

const refuse = (error: string): ActionState => ({ error });

/** The app's `isTrademarkRow` for a matter: TM, CR and PATENT (and no type) are Trademarks. */
const matterSection = (type: string | null | undefined): "trademarks" | "contracts" => (["TM", "CR", "PATENT"].includes(type ?? "TM") ? "trademarks" : "contracts");

export async function setCustomValue(deps: ValueDeps, input: ValueInput): Promise<ActionState> {
  // 1. Shape: nothing is read for a malformed request.
  const fieldId = typeof input.fieldId === "string" ? input.fieldId.trim() : "";
  const postedId = typeof input.id === "string" ? input.id.trim() : "";
  const kind: RecordKind | null = input.kind === "lead" || input.kind === "matter" ? input.kind : null;
  if (!isFieldId(fieldId) || !isFieldId(postedId) || !kind) return refuse(RECORD_CARD_GONE);

  // 2. Role, re-resolved now (a throw is no role).
  let role: string | null = null;
  try {
    role = await deps.role();
  } catch {
    role = null;
  }
  if (!canWriteCustomValue(role)) return refuse(RECORD_CARD_NO_PERMISSION);

  // 3. The field.
  let field: FieldRow | null;
  try {
    field = await deps.readField(fieldId);
  } catch (e) {
    return refuse(isMissingTable(e) ? CUSTOM_COLUMNS_NOT_READY : customColumnsError(e, "value"));
  }
  if (!field || field.id !== fieldId) return refuse(CUSTOM_FIELD_GONE);
  if (field.archived) return refuse(CUSTOM_COLUMN_ARCHIVED);
  const fieldKind = field.kind as CustomKind;
  if (!(fieldKind in KIND_COLUMN) || !optionsShapeOk(fieldKind, field.options)) return refuse(CUSTOM_VALUE_SAVE_FAILED);
  const options = field.options as string[];
  // 3b. A Money column is owner-only, reads and writes alike (Taylor, Nov 23; 0115's value policies say the same). Refused before
  //     the record, the existing value or anything else is read, so a non-owner learns nothing about a stored amount.
  if (fieldKind === "money" && !canSeeCustomMoney(role)) return refuse(CUSTOM_MONEY_OWNER_ONLY);

  // 4. A merged lead writes to its keeper.
  let recordId = postedId;
  if (kind === "lead") {
    try {
      recordId = await deps.keeper(postedId);
    } catch {
      return refuse(MERGE_POINTER_UNREADABLE);
    }
  }

  // 5. The record, through the scoped client (another firm's id reads as missing).
  let record: RecordRow | null;
  try {
    record = await deps.readRecord(kind, recordId);
  } catch (e) {
    return refuse(customColumnsError(e, "value"));
  }
  if (!record || record.id !== recordId || typeof record.org_id !== "string") return refuse(RECORD_CARD_GONE);
  const section = kind === "lead" ? "trademarks" : matterSection(record.type);
  if (field.section !== "both" && field.section !== section) return refuse(CUSTOM_WRONG_SECTION);

  // 6. The value, by the field's kind.
  const parsed = parseValueInput(fieldKind, input.value, options);
  if (!parsed.ok) return refuse(parsed.error);
  const value: CustomInputValue = parsed.value;
  if (fieldKind === "person" && value !== null) {
    let members: { userId: string }[];
    try {
      members = await deps.readMembers();
    } catch {
      return refuse(CUSTOM_TEAM_UNREADABLE);
    }
    if (!members.some((m) => m.userId.toLowerCase() === String(value))) return refuse(CUSTOM_PERSON_NOT_MEMBER);
  }

  // 7. Read first.
  let existing: { id: string } | null;
  try {
    existing = await deps.readValueRow(fieldId, kind, recordId);
  } catch (e) {
    return refuse(customColumnsError(e, "value"));
  }

  // 8. ONE write.
  const column = KIND_COLUMN[fieldKind];
  try {
    if (value === null) {
      if (existing) {
        const rows = await deps.deleteValue(existing.id);
        if (rows === 0) return refuse(CUSTOM_VALUE_CHANGED);
      }
    } else if (existing) {
      const rows = await deps.updateValue(existing.id, { [column]: value });
      if (rows === 0) return refuse(CUSTOM_VALUE_CHANGED);
    } else {
      const row: ValueInsert = { org_id: record.org_id, field_id: fieldId, ...(kind === "lead" ? { lead_id: recordId } : { matter_id: recordId }), [column]: value };
      try {
        await deps.insertValue(row);
      } catch (e) {
        if (!isOnePerRecordConflict(e)) throw e;
        // Another write landed first: re-read once and update by id.
        let again: { id: string } | null = null;
        try {
          again = await deps.readValueRow(fieldId, kind, recordId);
        } catch {
          return refuse(CUSTOM_VALUE_CHANGED);
        }
        if (!again) return refuse(CUSTOM_VALUE_CHANGED);
        let rows = 0;
        try {
          rows = await deps.updateValue(again.id, { [column]: value });
        } catch {
          return refuse(CUSTOM_VALUE_CHANGED);
        }
        if (rows === 0) return refuse(CUSTOM_VALUE_CHANGED);
      }
    }
  } catch (e) {
    return refuse(customColumnsError(e, "value"));
  }
  deps.revalidate(kind, recordId);
  return { saved: true };
}
