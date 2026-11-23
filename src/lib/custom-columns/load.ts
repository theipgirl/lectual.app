import "server-only";
import { parseField, parseValue, visibleFields, type CustomData, type CustomField, type CustomValue } from "./rules";

/**
 * The read side of a firm's custom columns (lectual 0115, proposed). Takes the caller's SCOPED client as a parameter and never creates
 * or imports one: RLS on the active firm bounds every row, and nothing here touches the service role. Three states:
 *   ok           the fields (live only) and the values of the records asked about;
 *   not-set-up   either table is missing (42P01 / PGRST205): the custom columns aren't switched on for the firm yet. Not a failure;
 *   unavailable  anything else, a non-list answer, a read cut short by the page budget, or a failed merged-leads read.
 * Every select names its columns. Values are read in chunks of ids and paged; a page budget that runs out FAILS the read.
 *
 * Money is owner-only (Taylor, Nov 23). `access.canSeeMoney` comes from the caller's re-resolved role (`canSeeCustomMoney`), never from
 * a browser value. Without it: Money fields are not returned, the value select does not name `value_cents` (VALUE_SELECT_NO_MONEY), and
 * the query asks only for rows whose `value_cents` is null, so no amount ever leaves the database for that viewer. 0115's SELECT policy
 * hides the same rows for every role but owner.
 */

export const CUSTOM_CHUNK = 80;
export const CUSTOM_PAGE = 1000;
export const CUSTOM_MAX_PAGES = 10;
/** A firm has at most 40 live fields; a field read this long was cut short. */
export const FIELD_READ_LIMIT = 1000;

export const FIELD_SELECT = "id, section, label, kind, options, position";
export const VALUE_SELECT = "id, field_id, lead_id, matter_id, value_text, value_date, value_cents, value_choice, value_user_id, updated_at";
/** The same columns without the amount: what a viewer who may not see money is read with. */
export const VALUE_SELECT_NO_MONEY = "id, field_id, lead_id, matter_id, value_text, value_date, value_choice, value_user_id, updated_at";

/** Who is reading: decided by the caller from the role it re-resolved. Required, so no read forgets it. */
export type CustomReadAccess = { canSeeMoney: boolean };

export const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(["42P01", "PGRST205"]);

export type CustomColumnsRead = ({ status: "ok" } & Omit<CustomData, "leadOfMatter">) | { status: "not-set-up" } | { status: "unavailable" };

/** child lead id -> keeper id for the leads merged into `leadIds` (the review loader's own read, injected to avoid an import cycle). */
export type ReadMerged = (db: never, leadIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;

type Answer = { data: unknown; error: unknown };
type Q = PromiseLike<Answer> & {
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  in(column: string, values: readonly string[]): Q;
  order(column: string): Q;
  range(from: number, to: number): Q;
  limit(n: number): Q;
};
type ReadClient = { from(table: string): { select(columns: string): Q } };

class NotSetUp extends Error {}
class Unavailable extends Error {}

function codeOf(error: unknown): string | null {
  return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null;
}

function failure(error: unknown): Error {
  const code = codeOf(error);
  return code !== null && MISSING_TABLE_CODES.has(code) ? new NotSetUp() : new Unavailable();
}

function chunks<T>(items: readonly T[], size = CUSTOM_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function pages(page: (from: number, to: number) => PromiseLike<Answer>): Promise<unknown[]> {
  const all: unknown[] = [];
  for (let i = 0; i < CUSTOM_MAX_PAGES; i++) {
    const { data, error } = await page(i * CUSTOM_PAGE, i * CUSTOM_PAGE + CUSTOM_PAGE - 1);
    if (error) throw failure(error);
    if (!Array.isArray(data)) throw new Unavailable();
    all.push(...data);
    if (data.length < CUSTOM_PAGE) return all;
  }
  throw new Unavailable();
}

async function readFields(raw: ReadClient): Promise<CustomField[]> {
  const { data, error } = await raw.from("crm_custom_field").select(FIELD_SELECT).eq("archived", false).order("position").order("label").order("id").limit(FIELD_READ_LIMIT);
  if (error) throw failure(error);
  if (!Array.isArray(data) || data.length >= FIELD_READ_LIMIT) throw new Unavailable();
  return data.map(parseField).filter((f): f is CustomField => f !== null);
}

async function readValues(raw: ReadClient, column: "matter_id" | "lead_id", ids: readonly string[], canSeeMoney: boolean): Promise<unknown[]> {
  if (ids.length === 0) return [];
  const page = (chunk: string[]) => (from: number, to: number) =>
    canSeeMoney
      ? raw.from("crm_custom_value").select(VALUE_SELECT).in(column, chunk).order("id").range(from, to)
      : raw.from("crm_custom_value").select(VALUE_SELECT_NO_MONEY).in(column, chunk).is("value_cents", null).order("id").range(from, to);
  const parts = await Promise.all(chunks(ids).map((chunk) => pages(page(chunk))));
  return parts.flat();
}

export async function loadCustomColumns(db: unknown, matterIds: readonly string[], leadIds: readonly string[], readMerged: ReadMerged, access: CustomReadAccess): Promise<CustomColumnsRead> {
  const raw = db as ReadClient;
  const canSeeMoney = access?.canSeeMoney === true;
  try {
    const fields = visibleFields(await readFields(raw), canSeeMoney);
    if (fields.length === 0) return { status: "ok", fields: [], values: [], mergedInto: {} };
    let merged: ReadonlyMap<string, string>;
    try {
      merged = await readMerged(db as never, leadIds);
    } catch {
      return { status: "unavailable" };
    }
    const allLeads = [...new Set([...leadIds, ...merged.keys()])];
    const [m, l] = await Promise.all([readValues(raw, "matter_id", [...new Set(matterIds)], canSeeMoney), readValues(raw, "lead_id", allLeads, canSeeMoney)]);
    const fieldIds = new Set(fields.map((f) => f.id));
    const byId = new Map<string, CustomValue>();
    for (const r of [...m, ...l]) {
      const v = parseValue(r, fieldIds);
      // A third fence: an amount that reached here for a viewer who may not see money is dropped, never drawn.
      if (v && (canSeeMoney || v.cents === null)) byId.set(v.id, v);
    }
    return { status: "ok", fields, values: [...byId.values()], mergedInto: Object.fromEntries(merged) };
  } catch (e) {
    return e instanceof NotSetUp ? { status: "not-set-up" } : { status: "unavailable" };
  }
}
