import { describe, expect, it, vi } from "vitest";
import { setCustomValue, type RecordKind, type ValueDeps } from "@/lib/custom-columns/value-actions";
import type { FieldRow } from "@/lib/custom-columns/field-actions";
import * as W from "@/lib/ui/words";

/** F9, F10, F11 and C1 for the value action, over recording fakes. Invented names only. */

export const VORG = "00000000-0000-4000-8000-0000000000aa";
const F = "00000000-0000-4000-8000-00000000f001";
const LEAD = "00000000-0000-4000-8000-0000000000d1";
const KEEPER = "00000000-0000-4000-8000-0000000000d2";
const MATTER = "00000000-0000-4000-8000-0000000000b1";
const ROW = "00000000-0000-4000-8000-0000000000e1";
const PERSON = "00000000-0000-4000-8000-0000000000c1";

const fieldRow = (over: Partial<FieldRow> = {}): FieldRow => ({ id: F, section: "trademarks", kind: "choice", label: "Priority", options: ["High", "Low"], position: 1, archived: false, updated_at: "2026-11-20T10:00:00+00:00", ...over });

export function valueStore(opts: { field?: FieldRow | null; role?: () => Promise<string>; staff?: () => Promise<boolean>; records?: Record<string, { id: string; org_id: string; type?: string | null }>; existing?: { id: string } | null; members?: string[] } = {}) {
  const records = opts.records ?? { [LEAD]: { id: LEAD, org_id: VORG }, [MATTER]: { id: MATTER, org_id: VORG, type: "TM" } };
  const deps = {
    role: vi.fn(opts.role ?? (async () => "attorney")),
    // A real member session unless a test says otherwise (Lectual staff inside a firm never type money, Nov 23).
    actingAsStaff: vi.fn(opts.staff ?? (async () => false)),
    readField: vi.fn(async (id: string) => (opts.field === undefined ? fieldRow() : opts.field && opts.field.id === id ? opts.field : null)),
    keeper: vi.fn(async (id: string) => id),
    // The real store reads crm_lead for a lead and crm_matter for a matter: a matter carries `type`, a lead never does.
    readRecord: vi.fn(async (kind: RecordKind, id: string) => {
      const r = records[id];
      return r && ("type" in r) === (kind === "matter") ? r : null;
    }),
    readMembers: vi.fn(async () => (opts.members ?? [PERSON]).map((userId) => ({ userId }))),
    readValueRow: vi.fn<ValueDeps["readValueRow"]>(async () => (opts.existing === undefined ? null : opts.existing)),
    insertValue: vi.fn<ValueDeps["insertValue"]>(async () => {}),
    updateValue: vi.fn<ValueDeps["updateValue"]>(async () => 1),
    deleteValue: vi.fn<ValueDeps["deleteValue"]>(async () => 1),
    revalidate: vi.fn(),
  } satisfies ValueDeps;
  const writes = () => deps.insertValue.mock.calls.length + deps.updateValue.mock.calls.length + deps.deleteValue.mock.calls.length;
  const reads = () => deps.readField.mock.calls.length + deps.keeper.mock.calls.length + deps.readRecord.mock.calls.length + deps.readMembers.mock.calls.length + deps.readValueRow.mock.calls.length;
  return { deps, writes, reads };
}

const post = (deps: ValueDeps, over: Record<string, unknown> = {}) => setCustomValue(deps, { fieldId: F, kind: "lead", id: LEAD, value: "High", ...over });

describe("F9: refusals, each with its sentence and nothing written", () => {
  for (const [who, role] of [
    ["viewer", async () => "viewer"],
    ["social_media", async () => "social_media"],
    ["a role() that throws", async () => Promise.reject(new Error("no role"))],
  ] as const)
    it(`${who}: refused before any read`, async () => {
      const s = valueStore({ role });
      expect(await post(s.deps)).toEqual({ error: W.RECORD_CARD_NO_PERMISSION });
      expect(s.reads()).toBe(0);
      expect(s.writes()).toBe(0);
    });

  it("re-resolved on every call: attorney, then viewer on the same deps", async () => {
    const answers = ["attorney", "viewer"];
    const s = valueStore({ role: async () => answers.shift() ?? "viewer" });
    expect(await post(s.deps)).toEqual({ saved: true });
    const reads = s.reads();
    expect(await post(s.deps)).toEqual({ error: W.RECORD_CARD_NO_PERMISSION });
    expect(s.reads()).toBe(reads);
    expect(s.deps.role).toHaveBeenCalledTimes(2);
  });

  it("every staff role writes", async () => {
    for (const r of ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"]) expect(await post(valueStore({ role: async () => r }).deps), r).toEqual({ saved: true });
  });

  const cases: Array<[string, Parameters<typeof valueStore>[0], Record<string, unknown>, string]> = [
    ["a malformed field id", {}, { fieldId: "x" }, W.RECORD_CARD_GONE],
    ["a malformed record id", {}, { id: "x" }, W.RECORD_CARD_GONE],
    ["an unknown record kind", {}, { kind: "contact" }, W.RECORD_CARD_GONE],
    ["a Contracts field on a lead", { field: fieldRow({ section: "contracts" }) }, {}, W.CUSTOM_WRONG_SECTION],
    ["a Trademarks field on a BL matter", { records: { [MATTER]: { id: MATTER, org_id: VORG, type: "BL" } } }, { kind: "matter", id: MATTER }, W.CUSTOM_WRONG_SECTION],
    ["an archived field", { field: fieldRow({ archived: true }) }, {}, W.CUSTOM_COLUMN_ARCHIVED],
    ["a field not found (another firm's id reads the same)", { field: null }, {}, W.CUSTOM_FIELD_GONE],
    ["a record not found (another firm's id reads the same)", { records: {} }, {}, W.RECORD_CARD_GONE],
    ["a record kind that doesn't match the id", {}, { kind: "matter" }, W.RECORD_CARD_GONE],
    ["a person not in the directory", { field: fieldRow({ kind: "person", options: [] }), members: [] }, { value: PERSON }, W.CUSTOM_PERSON_NOT_MEMBER],
    ["a person value that isn't an id", { field: fieldRow({ kind: "person", options: [] }) }, { value: "Rebecca" }, W.CUSTOM_PERSON_NOT_MEMBER],
    ["a malformed money string", { field: fieldRow({ kind: "money", options: [] }), role: async () => "owner" }, { value: "1,25" }, W.CUSTOM_MONEY_BAD],
    ["too much money", { field: fieldRow({ kind: "money", options: [] }), role: async () => "owner" }, { value: "99999999999999999999" }, W.CUSTOM_MONEY_TOO_BIG],
    ["a bad date", { field: fieldRow({ kind: "date", options: [] }) }, { value: "2026-02-30" }, W.CUSTOM_DATE_BAD],
    ["a choice not in the current options", {}, { value: "Urgent (old)" }, W.CUSTOM_CHOICE_BAD],
    ["text over 500 code points", { field: fieldRow({ kind: "text", options: [] }) }, { value: "x".repeat(501) }, W.CUSTOM_TEXT_TOO_LONG],
  ];
  for (const [name, opts, over, want] of cases)
    it(name, async () => {
      const s = valueStore(opts);
      expect(await post(s.deps, over)).toEqual({ error: want });
      expect(s.writes()).toBe(0);
    });

  it("an unreadable directory refuses", async () => {
    const s = valueStore({ field: fieldRow({ kind: "person", options: [] }) });
    s.deps.readMembers.mockRejectedValue(new Error("down"));
    expect(await post(s.deps, { value: PERSON })).toEqual({ error: W.CUSTOM_TEAM_UNREADABLE });
    expect(s.writes()).toBe(0);
  });

  it("N2: a stored option with a tab can be picked (exact match), and a member is checked, not trusted", async () => {
    const s = valueStore({ field: fieldRow({ options: ["High\t", "Low"] }) });
    expect(await post(s.deps, { value: "High\t" })).toEqual({ saved: true });
    expect(s.deps.insertValue.mock.calls[0][0]).toMatchObject({ value_choice: "High\t" });
  });
});

describe("F10: writes, one row per request", () => {
  it("a new value inserts exactly org_id (from the record row), field_id, the record column and the kind's column", async () => {
    const s = valueStore({ records: { [LEAD]: { id: LEAD, org_id: "00000000-0000-4000-8000-0000000000bb" } } });
    expect(await post(s.deps)).toEqual({ saved: true });
    const row = s.deps.insertValue.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["field_id", "lead_id", "org_id", "value_choice"]);
    expect(row).toEqual({ org_id: "00000000-0000-4000-8000-0000000000bb", field_id: F, lead_id: LEAD, value_choice: "High" });
    expect(s.deps.revalidate).toHaveBeenCalledWith("lead", LEAD);
  });
  it("an existing value updates only the kind's column, by id; 0 rows is CUSTOM_VALUE_CHANGED", async () => {
    const s = valueStore({ existing: { id: ROW } });
    expect(await post(s.deps)).toEqual({ saved: true });
    expect(s.deps.updateValue.mock.calls).toEqual([[ROW, { value_choice: "High" }]]);
    s.deps.updateValue.mockResolvedValue(0);
    expect(await post(s.deps)).toEqual({ error: W.CUSTOM_VALUE_CHANGED });
  });
  it("money is whole cents, a date its day, a person the id", async () => {
    const money = valueStore({ field: fieldRow({ kind: "money", options: [] }), role: async () => "owner" });
    await post(money.deps, { value: "$1,250.5" });
    expect(money.deps.insertValue.mock.calls[0][0]).toMatchObject({ value_cents: 125050 });
    const date = valueStore({ field: fieldRow({ kind: "date", options: [] }) });
    await post(date.deps, { value: "2028-02-29" });
    expect(date.deps.insertValue.mock.calls[0][0]).toMatchObject({ value_date: "2028-02-29" });
    const person = valueStore({ field: fieldRow({ kind: "person", options: [] }) });
    await post(person.deps, { value: PERSON });
    expect(person.deps.insertValue.mock.calls[0][0]).toMatchObject({ value_user_id: PERSON });
  });
  it("a blank with a row: one delete by id; 0 rows deleted is CUSTOM_VALUE_CHANGED, not saved (R6)", async () => {
    const s = valueStore({ existing: { id: ROW } });
    expect(await post(s.deps, { value: "  " })).toEqual({ saved: true });
    expect(s.deps.deleteValue.mock.calls).toEqual([[ROW]]);
    s.deps.deleteValue.mockResolvedValue(0);
    expect(await post(s.deps, { value: "" })).toEqual({ error: W.CUSTOM_VALUE_CHANGED });
  });
  it("a blank with no row: nothing written, saved", async () => {
    const s = valueStore({ existing: null });
    expect(await post(s.deps, { value: "" })).toEqual({ saved: true });
    expect(s.writes()).toBe(0);
  });
  it("a 23505 on the one-per-record key: one insert, one re-read, one update; that update at 0 rows is CUSTOM_VALUE_CHANGED", async () => {
    const s = valueStore({ existing: null });
    s.deps.insertValue.mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "crm_custom_value_one_per_record"' });
    s.deps.readValueRow.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: ROW });
    expect(await post(s.deps)).toEqual({ saved: true });
    expect(s.deps.insertValue).toHaveBeenCalledTimes(1);
    expect(s.deps.readValueRow).toHaveBeenCalledTimes(2);
    expect(s.deps.updateValue.mock.calls).toEqual([[ROW, { value_choice: "High" }]]);
    const t = valueStore({ existing: null });
    t.deps.insertValue.mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "crm_custom_value_one_per_record"' });
    t.deps.readValueRow.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: ROW });
    t.deps.updateValue.mockResolvedValue(0);
    expect(await post(t.deps)).toEqual({ error: W.CUSTOM_VALUE_CHANGED });
    expect(t.deps.updateValue).toHaveBeenCalledTimes(1);
  });
  it("another insert error goes through the mapper, with no retry", async () => {
    const s = valueStore({ existing: null });
    s.deps.insertValue.mockRejectedValue({ code: "23514", message: "custom_value_merged_lead: this lead was merged; its values are kept but not changed" });
    expect(await post(s.deps)).toEqual({ error: W.CUSTOM_VALUE_MERGED });
    expect(s.deps.readValueRow).toHaveBeenCalledTimes(1);
    expect(s.deps.updateValue).not.toHaveBeenCalled();
  });
  it("a merged lead writes to its keeper; an unreadable pointer refuses", async () => {
    const s = valueStore({ records: { [KEEPER]: { id: KEEPER, org_id: VORG } } });
    s.deps.keeper.mockResolvedValue(KEEPER);
    expect(await post(s.deps)).toEqual({ saved: true });
    expect(s.deps.insertValue.mock.calls[0][0]).toMatchObject({ lead_id: KEEPER });
    expect(s.deps.revalidate).toHaveBeenCalledWith("lead", KEEPER);
    const t = valueStore();
    t.deps.keeper.mockRejectedValue(new Error("pointer"));
    expect(await post(t.deps)).toEqual({ error: W.MERGE_POINTER_UNREADABLE });
    expect(t.writes()).toBe(0);
  });
  it("a 'From the lead' cell on a matter writes the MATTER's own value", async () => {
    const s = valueStore();
    expect(await post(s.deps, { kind: "matter", id: MATTER })).toEqual({ saved: true });
    expect(s.deps.readValueRow).toHaveBeenCalledWith(F, "matter", MATTER);
    expect(s.deps.insertValue.mock.calls[0][0]).toEqual({ org_id: VORG, field_id: F, matter_id: MATTER, value_choice: "High" });
    expect(s.deps.keeper).not.toHaveBeenCalled();
  });
});

describe("F11: before 0115 the value action answers not-ready and nothing throws", () => {
  for (const code of ["42P01", "PGRST205"])
    it(code, async () => {
      const s = valueStore();
      s.deps.readField.mockRejectedValue({ code, message: "x" });
      await expect(post(s.deps)).resolves.toEqual({ error: W.CUSTOM_COLUMNS_NOT_READY });
      for (const spy of ["keeper", "readRecord", "readMembers", "readValueRow", "insertValue", "updateValue", "deleteValue"] as const) expect(s.deps[spy]).not.toHaveBeenCalled();
    });
});

describe("C1: at most one write per call (plus the one retry update), never an array", () => {
  it("counts", async () => {
    for (const existing of [null, { id: ROW }]) {
      for (const value of ["High", ""]) {
        const s = valueStore({ existing });
        await post(s.deps, { value });
        expect(s.writes()).toBeLessThanOrEqual(1);
        for (const c of s.deps.insertValue.mock.calls) for (const a of c as unknown[]) expect(Array.isArray(a)).toBe(false);
      }
    }
  });
});

describe("Money columns are owner-only (Taylor, Nov 23)", () => {
  const money = () => fieldRow({ kind: "money", options: [] });
  for (const r of ["admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"])
    it(`${r}: a Money value is refused before the record or the value is read, nothing written`, async () => {
      const s = valueStore({ field: money(), role: async () => r });
      expect(await post(s.deps, { value: "1250" })).toEqual({ error: W.CUSTOM_MONEY_OWNER_ONLY });
      expect(s.deps.readRecord).not.toHaveBeenCalled();
      expect(s.deps.readValueRow).not.toHaveBeenCalled();
      expect(s.writes()).toBe(0);
    });

  it("a non-owner can't clear a Money value either (blank is a delete)", async () => {
    const s = valueStore({ field: money(), role: async () => "admin", existing: { id: ROW } });
    expect(await post(s.deps, { value: "" })).toEqual({ error: W.CUSTOM_MONEY_OWNER_ONLY });
    expect(s.writes()).toBe(0);
  });

  it("the owner writes it; a non-money column is unchanged for everyone else", async () => {
    const owner = valueStore({ field: money(), role: async () => "owner" });
    expect(await post(owner.deps, { value: "1250" })).toEqual({ saved: true });
    expect(owner.deps.insertValue.mock.calls[0][0]).toMatchObject({ value_cents: 125000 });
    expect(await post(valueStore({ role: async () => "paralegal" }).deps)).toEqual({ saved: true });
  });
});

describe("Lectual staff acting inside a firm never write custom money, even with an owner role claim (Nov 23)", () => {
  const money = () => fieldRow({ kind: "money", options: [] });
  it("owner role + actingAsStaff true: refused, nothing read past the field, nothing written", async () => {
    const s = valueStore({ field: money(), role: async () => "owner", staff: async () => true });
    expect(await post(s.deps, { value: "1250" })).toEqual({ error: W.CUSTOM_MONEY_OWNER_ONLY });
    expect(s.deps.readRecord).not.toHaveBeenCalled();
    expect(s.writes()).toBe(0);
  });
  it("a staff check that throws counts as staff (fail closed)", async () => {
    const s = valueStore({ field: money(), role: async () => "owner", staff: async () => Promise.reject(new Error("no session")) });
    expect(await post(s.deps, { value: "1250" })).toEqual({ error: W.CUSTOM_MONEY_OWNER_ONLY });
    expect(s.writes()).toBe(0);
  });
  it("staff still write a non-money column as before (the staff check is asked only for money)", async () => {
    const s = valueStore({ role: async () => "owner", staff: async () => true });
    expect(await post(s.deps)).toEqual({ saved: true });
    expect(s.deps.actingAsStaff).not.toHaveBeenCalled();
  });
});
