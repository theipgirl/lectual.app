import {
  STAGES_NOT_READY,
  STAGE_BAD_CATEGORY,
  STAGE_BAD_OPEN,
  STAGE_BAD_WAITING_ON,
  STAGE_BUSY,
  STAGE_CHANGE_FAILED,
  STAGE_GONE,
  STAGE_HOLDS_ROLE,
  STAGE_LAST_OPEN,
  STAGE_LAST_WON,
  STAGE_NAME_BAD,
  STAGE_NAME_TAKEN,
  STAGE_NEEDS_DESTINATION,
  STAGE_NOT_YOURS,
  STAGE_NO_WON_DESTINATION,
  STAGE_OPEN_MISMATCH,
  STAGE_ORDER_FULL,
  STAGE_OWNER_ONLY,
  STAGE_PLACE_GONE,
  STAGE_RECORDS_CHANGED,
  STAGE_ROLE_MISFIT,
  STAGE_ROLE_TAKEN,
  STAGE_SAME_DESTINATION,
  STAGE_TOO_MANY,
  STAGE_TYPE_NOT_EMPTY,
  STAGE_WON_SOURCE,
} from "@/lib/ui/words";

/**
 * lectual 0119's stage-function refusals, read by their stable PREFIX (`stage_last_open: ...`) and, where there is none, by the
 * error CODE. Every answer is a fixed sentence from words.ts: the database's own text never reaches a person. Pure.
 */
const PREFIXES: ReadonlyArray<[string, string]> = [
  ["stage_not_owner", STAGE_OWNER_ONLY],
  ["stage_owner_only", STAGE_OWNER_ONLY],
  ["stage_role_guarded", STAGE_OWNER_ONLY],
  ["stage_not_found", STAGE_GONE],
  ["stage_delete_bad_destination", STAGE_NOT_YOURS],
  ["stage_name_taken", STAGE_NAME_TAKEN],
  ["stage_bad_name", STAGE_NAME_BAD],
  ["stage_bad_position", STAGE_PLACE_GONE],
  ["stage_bad_category", STAGE_BAD_CATEGORY],
  ["stage_delete_bad_ids", STAGE_RECORDS_CHANGED],
  ["stage_delete_needs_destination", STAGE_NEEDS_DESTINATION],
  ["stage_delete_same_stage", STAGE_SAME_DESTINATION],
  ["matter_stage_bad_waiting_on", STAGE_BAD_WAITING_ON],
  ["stage_limit", STAGE_TOO_MANY],
  ["stage_order_overflow", STAGE_ORDER_FULL],
  ["stage_not_empty", STAGE_TYPE_NOT_EMPTY],
  ["stage_last_open", STAGE_LAST_OPEN],
  ["stage_last_won", STAGE_LAST_WON],
  ["stage_holds_role", STAGE_HOLDS_ROLE],
  ["stage_role_delete", STAGE_HOLDS_ROLE],
  ["stage_role_taken", STAGE_ROLE_TAKEN],
  ["stage_role_category_mismatch", STAGE_ROLE_MISFIT],
  ["stage_delete_records_changed", STAGE_RECORDS_CHANGED],
  ["stage_delete_won_destination", STAGE_NO_WON_DESTINATION],
  ["stage_delete_won_source", STAGE_WON_SOURCE],
  ["stage_delete_open_mismatch", STAGE_OPEN_MISMATCH],
];

type DbError = { code?: unknown; message?: unknown };

function codeOf(error: unknown): string {
  return error && typeof error === "object" && typeof (error as DbError).code === "string" ? ((error as DbError).code as string) : "";
}
function messageOf(error: unknown): string {
  return error && typeof error === "object" && typeof (error as DbError).message === "string" ? ((error as DbError).message as string) : "";
}

/** The stage functions are not on this database yet (lectual 0119 not applied): PostgREST's PGRST202 or Postgres 42883. */
export function isStageFunctionMissing(error: unknown): boolean {
  const code = codeOf(error);
  return code === "PGRST202" || code === "42883";
}

/** A deadlock (40P01) or a lock that couldn't be taken (55P03): worth exactly one retry. */
export function isStageLockError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "40P01" || code === "55P03";
}

/** The fixed sentence for a refusal. `kind` only chooses between the lead and matter wording of a category refusal. */
export function stageErrorSentence(error: unknown, kind: "lead" | "matter" = "lead"): string {
  if (isStageFunctionMissing(error)) return STAGES_NOT_READY;
  if (isStageLockError(error)) return STAGE_BUSY;
  const message = messageOf(error).trim();
  for (const [prefix, sentence] of PREFIXES) {
    if (message === prefix || message.startsWith(`${prefix}:`)) {
      return prefix === "stage_bad_category" && kind === "matter" ? STAGE_BAD_OPEN : sentence;
    }
  }
  const code = codeOf(error);
  // 0042's RESTRICT / 0105's NO ACTION: a record slipped into the stage between the dialog and the delete.
  if (code === "23503") return STAGE_RECORDS_CHANGED;
  if (code === "42501") return STAGE_OWNER_ONLY;
  return STAGE_CHANGE_FAILED;
}
