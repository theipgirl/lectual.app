import {
  COLUMNS_NO_PERMISSION,
  CUSTOM_BAD_KIND,
  CUSTOM_BAD_SECTION,
  CUSTOM_BUSY,
  CUSTOM_CHOICE_BAD,
  CUSTOM_CHOICES_INVALID,
  CUSTOM_COLUMN_ARCHIVED,
  CUSTOM_COLUMNS_NOT_READY,
  CUSTOM_FIELD_GONE,
  CUSTOM_FIELD_IMMUTABLE,
  CUSTOM_LABEL_SPACES,
  CUSTOM_LABEL_TAKEN,
  CUSTOM_LABEL_TOO_LONG,
  CUSTOM_LIMIT,
  CUSTOM_MONEY_TOO_BIG,
  CUSTOM_MOVE_FAILED,
  CUSTOM_OPTIONS_IN_USE,
  CUSTOM_PERSON_NOT_MEMBER,
  CUSTOM_SAVE_FAILED,
  CUSTOM_TEXT_TOO_LONG,
  CUSTOM_VALUE_CHANGED,
  CUSTOM_VALUE_EMPTY,
  CUSTOM_VALUE_IMMUTABLE,
  CUSTOM_VALUE_MERGED,
  CUSTOM_VALUE_NOT_ALLOWED,
  CUSTOM_VALUE_ONE_RECORD,
  CUSTOM_VALUE_SAVE_FAILED,
  CUSTOM_WRONG_KIND,
  CUSTOM_WRONG_SECTION,
  CUSTOM_MONEY_OWNER_ONLY,
  RECORD_CARD_GONE,
} from "@/lib/ui/words";

/**
 * The ONE place a database refusal of a custom-column write becomes words. Pure, and it never throws. It reads only three things, in
 * this order of precedence: a leading `<prefix>:` of the message (0115's trigger prefixes), then a `constraint "<name>"` inside the
 * message (a CHECK, a unique key or a foreign key), then the code. Anything else is the context's fallback. It returns a constant from
 * `words.ts`, never any part of what it was given, so a table, column or constraint name can never reach a person.
 */

export type ErrorContext = "field" | "value";

/** 0115's 15 distinct trigger prefixes (the 15th, money owner-only, Taylor Nov 23). */
export const PREFIX_WORDS: Readonly<Record<string, string>> = {
  custom_field_immutable: CUSTOM_FIELD_IMMUTABLE,
  custom_field_limit: CUSTOM_LIMIT,
  custom_field_label_taken: CUSTOM_LABEL_TAKEN,
  custom_field_options_in_use: CUSTOM_OPTIONS_IN_USE,
  custom_value_immutable: CUSTOM_VALUE_IMMUTABLE,
  custom_value_one_record: CUSTOM_VALUE_ONE_RECORD,
  custom_value_no_field: CUSTOM_FIELD_GONE,
  custom_value_no_record: RECORD_CARD_GONE,
  custom_value_merged_lead: CUSTOM_VALUE_MERGED,
  custom_value_field_archived: CUSTOM_COLUMN_ARCHIVED,
  custom_value_wrong_section: CUSTOM_WRONG_SECTION,
  custom_value_empty: CUSTOM_VALUE_EMPTY,
  custom_value_wrong_kind: CUSTOM_WRONG_KIND,
  custom_value_bad_choice: CUSTOM_CHOICE_BAD,
  custom_value_money_owner_only: CUSTOM_MONEY_OWNER_ONLY,
};

/** 0115's 11 CHECKs, its 2 mapped unique keys and its 4 named foreign keys. */
export const CONSTRAINT_WORDS: Readonly<Record<string, string>> = {
  crm_custom_field_section: CUSTOM_BAD_SECTION,
  crm_custom_field_label_len: CUSTOM_LABEL_TOO_LONG,
  crm_custom_field_label_trimmed: CUSTOM_LABEL_SPACES,
  crm_custom_field_kind: CUSTOM_BAD_KIND,
  crm_custom_field_options: CUSTOM_CHOICES_INVALID,
  crm_custom_field_position: CUSTOM_MOVE_FAILED,
  crm_custom_value_one_record: CUSTOM_VALUE_ONE_RECORD,
  crm_custom_value_one_value: CUSTOM_WRONG_KIND,
  crm_custom_value_text_len: CUSTOM_TEXT_TOO_LONG,
  crm_custom_value_cents_range: CUSTOM_MONEY_TOO_BIG,
  crm_custom_value_choice_len: CUSTOM_CHOICE_BAD,
  crm_custom_field_label_live_uniq: CUSTOM_LABEL_TAKEN,
  crm_custom_value_one_per_record: CUSTOM_VALUE_CHANGED,
  crm_custom_value_field_org_fk: CUSTOM_FIELD_GONE,
  crm_custom_value_lead_org_fk: RECORD_CARD_GONE,
  crm_custom_value_matter_org_fk: RECORD_CARD_GONE,
  crm_custom_value_value_user_org_fk: CUSTOM_PERSON_NOT_MEMBER,
};

/** The two codes that mean "the tables aren't there yet": the "not switched on" answer, never a failure. */
export const MISSING_TABLE: ReadonlySet<string> = new Set(["42P01", "PGRST205"]);

function codeWords(code: string, context: ErrorContext): string | null {
  if (MISSING_TABLE.has(code)) return CUSTOM_COLUMNS_NOT_READY;
  if (code === "42501") return context === "field" ? COLUMNS_NO_PERMISSION : CUSTOM_VALUE_NOT_ALLOWED;
  if (code === "40P01") return CUSTOM_BUSY;
  return null;
}

export const fallbackFor = (context: ErrorContext): string => (context === "field" ? CUSTOM_SAVE_FAILED : CUSTOM_VALUE_SAVE_FAILED);

/** Every sentence the mapper can return (the test checks each answer is `===` one of these). */
export function mapperSentences(): Set<string> {
  return new Set([...Object.values(PREFIX_WORDS), ...Object.values(CONSTRAINT_WORDS), CUSTOM_COLUMNS_NOT_READY, COLUMNS_NO_PERMISSION, CUSTOM_VALUE_NOT_ALLOWED, CUSTOM_BUSY, CUSTOM_SAVE_FAILED, CUSTOM_VALUE_SAVE_FAILED]);
}

function read(err: unknown): { code: string | null; message: string } {
  try {
    if (typeof err === "string") return { code: null, message: err };
    if (!err || typeof err !== "object") return { code: null, message: "" };
    const o = err as { code?: unknown; message?: unknown };
    return { code: typeof o.code === "string" ? o.code : null, message: typeof o.message === "string" ? o.message : "" };
  } catch {
    return { code: null, message: "" };
  }
}

/** The error's code, for callers that branch on "not switched on" before mapping. Never throws. */
export function errorCode(err: unknown): string | null {
  return read(err).code;
}

/** Whether the error means the 0115 tables aren't there yet (42P01 / PGRST205). */
export function isMissingTable(err: unknown): boolean {
  const code = errorCode(err);
  return code !== null && MISSING_TABLE.has(code);
}

/** Whether a 23505 names the one-value-per-record key (another write landed first). */
export function isOnePerRecordConflict(err: unknown): boolean {
  const { code, message } = read(err);
  return code === "23505" && /constraint "crm_custom_value_one_per_record"/.test(message);
}

export function customColumnsError(err: unknown, context: ErrorContext): string {
  const { code, message } = read(err);
  const prefix = /^([a-z_]+):/.exec(message)?.[1];
  if (prefix && Object.hasOwn(PREFIX_WORDS, prefix)) return PREFIX_WORDS[prefix];
  const constraint = /constraint "([A-Za-z0-9_]+)"/.exec(message)?.[1];
  if (constraint && Object.hasOwn(CONSTRAINT_WORDS, constraint)) return CONSTRAINT_WORDS[constraint];
  if (code) {
    const byCode = codeWords(code, context);
    if (byCode) return byCode;
  }
  return fallbackFor(context);
}
