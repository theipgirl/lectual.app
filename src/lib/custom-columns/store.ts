import "server-only";
import { FIELD_READ_LIMIT } from "./load";
import type { FieldGuard, FieldInsert, FieldPatch, FieldRow, LiveField } from "./field-actions";
import type { RecordKind, RecordRow, ValueColumn, ValueInsert } from "./value-actions";

/**
 * The scoped-client implementations of the custom-column actions' dependencies. Takes the caller's SCOPED client as a parameter and
 * never creates or imports one (RLS on the active firm bounds every row; nothing here touches the service role). The ONLY file under
 * `src/lib/custom-columns/` that writes: one row per call, filtered by id, never an array and never an upsert. Every select names its
 * columns. Each function throws the database's error object as it came; the action logic turns it into words.
 */

type Answer = { data: unknown; error: unknown };
type Q = PromiseLike<Answer> & {
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  in(column: string, values: readonly string[]): Q;
  order(column: string): Q;
  range(from: number, to: number): Q;
  limit(n: number): Q;
  select(columns: string): Q;
  maybeSingle(): PromiseLike<Answer>;
};
type Table = {
  select(columns: string): Q;
  insert(row: Record<string, unknown>): Q;
  update(patch: Record<string, unknown>): Q;
  delete(): Q;
};
export type StoreClient = { from(table: string): Table };

export const FIELD_ROW_SELECT = "id, section, kind, label, options, position, archived, updated_at";
export const LIVE_FIELD_SELECT = "id, section, label, kind, options, position";
export const OPTION_USE_PAGE = 1000;
export const OPTION_USE_MAX_PAGES = 10;

/** A read that came back in a shape it can't trust, or cut short: never "nothing there". */
const cutShort = () => new Error("custom-columns read cut short");

const rowsOf = (data: unknown): number => (Array.isArray(data) ? data.length : 0);

export function fieldStore(db: StoreClient) {
  return {
    async readField(id: string): Promise<FieldRow | null> {
      const { data, error } = await db.from("crm_custom_field").select(FIELD_ROW_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as FieldRow | null) ?? null;
    },

    /** In the order the database returned (position, label, id). A read that hits the limit fails. */
    async readLiveFields(): Promise<LiveField[]> {
      const { data, error } = await db.from("crm_custom_field").select(LIVE_FIELD_SELECT).eq("archived", false).order("position").order("label").order("id").limit(FIELD_READ_LIMIT);
      if (error) throw error;
      if (!Array.isArray(data) || data.length >= FIELD_READ_LIMIT) throw cutShort();
      return data as LiveField[];
    },

    /** How many values hold each of `options`, paged; a page budget that runs out fails the read. */
    async readOptionUse(fieldId: string, options: string[]): Promise<Record<string, number>> {
      const counts: Record<string, number> = Object.fromEntries(options.map((o) => [o, 0]));
      for (let i = 0; i < OPTION_USE_MAX_PAGES; i++) {
        const from = i * OPTION_USE_PAGE;
        const { data, error } = await db.from("crm_custom_value").select("id, value_choice").eq("field_id", fieldId).in("value_choice", options).order("id").range(from, from + OPTION_USE_PAGE - 1);
        if (error) throw error;
        if (!Array.isArray(data)) throw cutShort();
        for (const r of data as { value_choice?: unknown }[]) if (typeof r.value_choice === "string" && r.value_choice in counts) counts[r.value_choice] += 1;
        if (data.length < OPTION_USE_PAGE) return counts;
      }
      throw cutShort();
    },

    async insertField(row: FieldInsert): Promise<void> {
      const { error } = await db.from("crm_custom_field").insert({ ...row }).select("id");
      if (error) throw error;
    },

    async updateField(id: string, patch: FieldPatch, guards: FieldGuard): Promise<number> {
      let q = db.from("crm_custom_field").update({ ...patch }).eq("id", id);
      for (const [column, value] of Object.entries(guards)) q = q.eq(column, value);
      const { data, error } = await q.select("id");
      if (error) throw error;
      return rowsOf(data);
    },
  };
}

export function valueStore(db: StoreClient) {
  return {
    async readRecord(kind: RecordKind, id: string): Promise<RecordRow | null> {
      // live-guard: an existence and firm read for the value's record; the action already followed a merged lead to its keeper.
      const { data, error } =
        kind === "lead" ? await db.from("crm_lead").select("id, org_id").eq("id", id).maybeSingle() : await db.from("crm_matter").select("id, org_id, type").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as RecordRow | null) ?? null;
    },

    async readValueRow(fieldId: string, kind: RecordKind, recordId: string): Promise<{ id: string } | null> {
      const base = db.from("crm_custom_value").select("id").eq("field_id", fieldId);
      const q = kind === "lead" ? base.eq("lead_id", recordId).is("matter_id", null) : base.eq("matter_id", recordId).is("lead_id", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null) ?? null;
    },

    async insertValue(row: ValueInsert): Promise<void> {
      const { error } = await db.from("crm_custom_value").insert({ ...row });
      if (error) throw error;
    },

    async updateValue(id: string, patch: Partial<Record<ValueColumn, string | number>>): Promise<number> {
      const { data, error } = await db.from("crm_custom_value").update({ ...patch }).eq("id", id).select("id");
      if (error) throw error;
      return rowsOf(data);
    },

    async deleteValue(id: string): Promise<number> {
      const { data, error } = await db.from("crm_custom_value").delete().eq("id", id).select("id");
      if (error) throw error;
      return rowsOf(data);
    },
  };
}
