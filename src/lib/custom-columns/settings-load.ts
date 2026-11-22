import "server-only";
import { CUSTOM_MAX_PAGES, CUSTOM_PAGE, FIELD_READ_LIMIT, MISSING_TABLE_CODES } from "./load";
import { parseField, type CustomField } from "./rules";

/**
 * Settings -> Columns' read: EVERY field of the firm, archived ones included, through the caller's SCOPED client (taken as a parameter,
 * never created here). Three states:
 *   ok           the fields the CO1 read rules accept (a row the database could not have stored is dropped and counted, never drawn
 *                half), `live` and `archived` each in the order the database returned (position, label, id; never re-sorted here);
 *   not-set-up   the table isn't there yet (42P01 / PGRST205);
 *   unavailable  anything else, a non-list answer, or a read that hit the limit.
 * The choices' use counts are their OWN state: a failed or cut-short count read leaves the page `ok` (R16); saving re-counts anyway.
 */

export type SettingsField = CustomField & { archived: boolean; updatedAt: string };
export type OptionUse = { status: "ok"; counts: Record<string, Record<string, number>> } | { status: "unavailable" };
export type ColumnsSettingsState =
  | { status: "ok"; live: SettingsField[]; archived: SettingsField[]; dropped: number; use: OptionUse }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export const SETTINGS_FIELD_SELECT = "id, section, label, kind, options, position, archived, updated_at";

type Answer = { data: unknown; error: unknown };
type Q = PromiseLike<Answer> & {
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly string[]): Q;
  not(column: string, op: string, value: unknown): Q;
  order(column: string): Q;
  range(from: number, to: number): Q;
  limit(n: number): Q;
};
type ReadClient = { from(table: string): { select(columns: string): Q } };

const codeOf = (e: unknown): string | null => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : null);

/** One settings row as read, or null (dropped). */
export function parseSettingsField(raw: unknown): SettingsField | null {
  const f = parseField(raw);
  if (!f) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.archived !== "boolean" || typeof r.updated_at !== "string" || r.updated_at === "") return null;
  return { ...f, archived: r.archived, updatedAt: r.updated_at };
}

async function readUse(raw: ReadClient, fieldIds: string[]): Promise<OptionUse> {
  if (fieldIds.length === 0) return { status: "ok", counts: {} };
  try {
    const counts: Record<string, Record<string, number>> = {};
    for (let i = 0; i < CUSTOM_MAX_PAGES; i++) {
      const from = i * CUSTOM_PAGE;
      const { data, error } = await raw.from("crm_custom_value").select("id, field_id, value_choice").in("field_id", fieldIds).not("value_choice", "is", null).order("id").range(from, from + CUSTOM_PAGE - 1);
      if (error || !Array.isArray(data)) return { status: "unavailable" };
      for (const r of data as { field_id?: unknown; value_choice?: unknown }[]) {
        if (typeof r.field_id !== "string" || typeof r.value_choice !== "string") continue;
        const byOption = (counts[r.field_id] ??= {});
        byOption[r.value_choice] = (byOption[r.value_choice] ?? 0) + 1;
      }
      if (data.length < CUSTOM_PAGE) return { status: "ok", counts };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadColumnsSettings(db: unknown): Promise<ColumnsSettingsState> {
  const raw = db as ReadClient;
  try {
    const { data, error } = await raw.from("crm_custom_field").select(SETTINGS_FIELD_SELECT).order("position").order("label").order("id").limit(FIELD_READ_LIMIT);
    if (error) {
      const code = codeOf(error);
      return code !== null && MISSING_TABLE_CODES.has(code) ? { status: "not-set-up" } : { status: "unavailable" };
    }
    if (!Array.isArray(data) || data.length >= FIELD_READ_LIMIT) return { status: "unavailable" };
    const parsed = data.map(parseSettingsField);
    const kept = parsed.filter((f): f is SettingsField => f !== null);
    const use = await readUse(raw, kept.filter((f) => f.kind === "choice").map((f) => f.id));
    return { status: "ok", live: kept.filter((f) => !f.archived), archived: kept.filter((f) => f.archived), dropped: parsed.length - kept.length, use };
  } catch {
    return { status: "unavailable" };
  }
}
