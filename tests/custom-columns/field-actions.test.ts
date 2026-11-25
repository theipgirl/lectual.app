import { describe, expect, it } from "vitest";
import { MAX_LIVE, createField, createFieldWithId, nextPosition, updateField, type FieldDeps, type UpdateInput } from "@/lib/custom-columns/field-actions";
import { fieldsForSection, type CustomColumnField } from "@/lib/review/sheet-columns";
import * as W from "@/lib/ui/words";
import { ORG, field, fid, makeStore, type FakeField } from "./field-fake";

/** F2-F8, F11, C1 and R2d over the field logic with a recording fake store. Invented names only. */

const SPIES = ["orgId", "readField", "readLiveFields", "readOptionUse", "insertField", "updateField"] as const;
const BAD_ROLES: Array<[string, () => Promise<string | null>]> = [
  ...["admin", "senior_admin", "attorney", "paralegal", "intake", "law_clerk", "clerk", "viewer", "social_media"].map((r) => [r, async () => r] as [string, () => Promise<string | null>]),
  ["null", async () => null],
  ["a role() that throws", async () => Promise.reject(new Error("rpc down"))],
];

const choice = (n: number, options: string[], over: Partial<FakeField> = {}) => field(n, { kind: "choice", options, ...over });
const create = (deps: FieldDeps, over: Record<string, unknown> = {}) => createField(deps, { label: "Priority", section: "trademarks", kind: "choice", choices: "High\nMedium\nLow", ...over });

/* ── F2 ── */

describe("F2: the field actions' role gate", () => {
  const ops: Array<[string, (d: FieldDeps) => Promise<unknown>]> = [
    ["create", (d) => create(d)],
    ["rename", (d) => updateField(d, { op: "rename", id: fid(1), label: "X", updatedAt: "s" })],
    ["options", (d) => updateField(d, { op: "options", id: fid(1), choices: "A", updatedAt: "s" })],
    ["move", (d) => updateField(d, { op: "move", id: fid(1), dir: "up" })],
    ["archive", (d) => updateField(d, { op: "archive", id: fid(1) })],
    ["restore", (d) => updateField(d, { op: "restore", id: fid(1) })],
  ];
  for (const [op, run] of ops)
    for (const [who, role] of BAD_ROLES)
      it(`${op} refuses ${who} before any read`, async () => {
        const s = makeStore([field(1)], { role });
        expect(await run(s.deps)).toEqual({ error: W.COLUMNS_NO_PERMISSION });
        for (const spy of SPIES) expect(s.deps[spy], spy).not.toHaveBeenCalled();
      });

  it("re-resolved on every call: owner, then viewer on the same deps", async () => {
    const answers = ["owner", "viewer"];
    const s = makeStore([], { role: async () => answers.shift() ?? null });
    expect(await create(s.deps)).toEqual({ saved: true });
    const reads = s.calls.length;
    expect(await create(s.deps, { label: "Second" })).toEqual({ error: W.COLUMNS_NO_PERMISSION });
    expect(s.calls.length).toBe(reads);
    expect(s.deps.owner).toHaveBeenCalledTimes(2);
    expect(s.deps.orgId).toHaveBeenCalledTimes(1);
  });

  // Changed on purpose (editable views): lectual 0119 makes field create and change owner-only, so the admin tier is refused here with
  // the owner sentence rather than a raw database refusal. The caller's own membership row decides (`deps.owner`), not a role claim.
  it("only an owner passes; the admin tier and a throwing owner check are refused", async () => {
    expect(await create(makeStore([], { role: "owner" }).deps)).toEqual({ saved: true });
    for (const r of ["admin", "senior_admin"]) expect(await create(makeStore([], { role: r }).deps)).toEqual({ error: W.COLUMNS_NO_PERMISSION });
    const s = makeStore([]);
    s.deps.owner.mockRejectedValue(new Error("down"));
    expect(await create(s.deps)).toEqual({ error: W.COLUMNS_NO_PERMISSION });
  });
  it("the owner sentence says owner", () => {
    expect(W.COLUMNS_NO_PERMISSION).toBe("Only an owner can change columns.");
  });
});

/* ── F3 ── */

describe("F3: create", () => {
  it("inserts exactly the six keys, the session's org, the cleaned label and choices, position max live + 1", async () => {
    const s = makeStore([field(1, { position: 4 }), field(2, { position: 9 }), field(3, { position: 50, archived: true })]);
    expect(await create(s.deps, { label: "  Priority\t", choices: "High\r\n Medium \r\n\r\nLow" })).toEqual({ saved: true });
    const row = s.deps.insertField.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["kind", "label", "options", "org_id", "position", "section"]);
    expect(row).toEqual({ org_id: ORG, section: "trademarks", label: "Priority", kind: "choice", options: ["High", "Medium", "Low"], position: 10 });
    expect(Array.isArray(row)).toBe(false);
    expect(s.deps.revalidate).toHaveBeenCalledTimes(1);
  });
  it("a non-choice column always sends []", async () => {
    const s = makeStore([]);
    await create(s.deps, { kind: "money", label: "Quoted fee", choices: "High\nLow" });
    expect((s.deps.insertField.mock.calls[0][0] as { options: unknown }).options).toEqual([]);
  });
  it("position: 0 with none live; capped at 1000, else the lowest free", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 999 }])).toBe(1000);
    expect(nextPosition([{ position: 1000 }, { position: 0 }, { position: 1 }])).toBe(2);
    expect(nextPosition([{ position: 1000 }])).toBe(0);
  });
  it("the new field comes last in the one list", async () => {
    const s = makeStore([field(1, { position: 0 }), field(2, { position: 1 })]);
    await create(s.deps);
    expect(s.live().at(-1)?.label).toBe("Priority");
  });
});

/* ── F4 ── */

describe("F4: label rules", () => {
  const live = [field(1, { label: "Priority", section: "trademarks" }), field(2, { label: "Review", section: "both" })];
  const refused: Array<[string, Record<string, unknown>, string, FakeField[]?]> = [
    ["an empty label", { label: "  " }, W.CUSTOM_LABEL_EMPTY],
    ["61 code points", { label: "x".repeat(61) }, W.CUSTOM_LABEL_TOO_LONG],
    ["status", { label: "status" }, W.labelIsBuiltin("status")],
    [" Status ", { label: " Status " }, W.labelIsBuiltin("Status")],
    ["Trademark Name for Trademarks", { label: "Trademark Name", section: "trademarks" }, W.labelIsBuiltin("Trademark Name")],
    ["Trademark Name for Both", { label: "Trademark Name", section: "both" }, W.labelIsBuiltin("Trademark Name")],
    ["Legal Fee (a money header) for Contracts", { label: "legal fee", section: "contracts", kind: "text" }, W.labelIsBuiltin("legal fee")],
    ["a live Trademarks label again", { label: "priority", section: "trademarks", kind: "text" }, W.labelTaken("priority"), live],
    ["a Both label over a live Trademarks one", { label: "PRIORITY", section: "both", kind: "text" }, W.labelTaken("PRIORITY"), live],
    ["a Contracts label over a live Both one", { label: "review", section: "contracts", kind: "text" }, W.labelTaken("review"), live],
  ];
  for (const [name, over, want, rows] of refused)
    it(`refuses ${name}`, async () => {
      const s = makeStore(rows ?? []);
      expect(await create(s.deps, over)).toEqual({ error: want });
      expect(s.writes()).toEqual([]);
    });

  const accepted: Array<[string, Record<string, unknown>]> = [
    ["Trademark Name for Contracts", { label: "Trademark Name", section: "contracts", kind: "text" }],
    ["Priority (a not-tracked name)", { label: "Priority" }],
    ["the same label in Contracts as a live Trademarks one", { label: "Priority", section: "contracts", kind: "text" }],
  ];
  for (const [name, over] of accepted)
    it(`accepts ${name}`, async () => {
      const s = makeStore(name.startsWith("the same") ? [live[0]] : []);
      expect(await create(s.deps, over)).toEqual({ saved: true });
    });

  it("a rename that would clash is refused, in either direction; a rename to itself in another case is not a clash", async () => {
    const s = makeStore([...live, field(3, { label: "Note", section: "contracts" })]);
    const read = s.rows.find((r) => r.id === fid(3))!;
    expect(await updateField(s.deps, { op: "rename", id: fid(3), label: "Review", updatedAt: read.updated_at })).toEqual({ error: W.labelTaken("Review") });
    const p = s.rows.find((r) => r.id === fid(1))!;
    expect(await updateField(s.deps, { op: "rename", id: fid(1), label: "PRIORITY", updatedAt: p.updated_at })).toEqual({ saved: true });
    expect(await updateField(s.deps, { op: "rename", id: fid(3), label: "Status", updatedAt: read.updated_at })).toEqual({ error: W.labelIsBuiltin("Status") });
  });

  it("a restore that would clash is refused", async () => {
    const s = makeStore([field(1, { label: "Priority" }), field(2, { label: "priority", archived: true })]);
    expect(await updateField(s.deps, { op: "restore", id: fid(2) })).toEqual({ error: W.labelTaken("priority") });
    expect(s.writes()).toEqual([]);
  });
});

/* ── F5 ── */

describe("F5: the 40-column limit", () => {
  const forty = Array.from({ length: MAX_LIVE }, (_, i) => field(i + 1));
  it("create and restore refuse at 40 live and write nothing", async () => {
    const s = makeStore([...forty, field(99, { archived: true, label: "Old flag" })]);
    expect(await create(s.deps)).toEqual({ error: W.CUSTOM_LIMIT });
    expect(await updateField(s.deps, { op: "restore", id: fid(99) })).toEqual({ error: W.CUSTOM_LIMIT });
    expect(s.writes()).toEqual([]);
  });
  it("an unreadable live list refuses and never counts as 0", async () => {
    const s = makeStore([field(99, { archived: true })]);
    s.deps.readLiveFields.mockRejectedValue({ code: "XX000", message: "boom" });
    expect(await create(s.deps)).toEqual({ error: W.CUSTOM_SAVE_FAILED_READ });
    expect(await updateField(s.deps, { op: "restore", id: fid(99) })).toEqual({ error: W.CUSTOM_SAVE_FAILED_READ });
    expect(s.writes()).toEqual([]);
  });
});

/* ── F6 ── */

describe("F6: Edit choices", () => {
  const opts = (s: ReturnType<typeof makeStore>, choices: string, over: Record<string, unknown> = {}) =>
    updateField(s.deps, { op: "options", id: fid(1), choices, updatedAt: s.rows[0].updated_at, ...over });
  for (const [name, choices, want] of [
    ["0 choices", "\n \n", W.CUSTOM_CHOICES_COUNT],
    ["31 choices", Array.from({ length: 31 }, (_, i) => `c${i}`).join("\n"), W.CUSTOM_CHOICES_COUNT],
    ["a 41-code-point choice", "High\n" + "x".repeat(41), W.CUSTOM_CHOICE_TOO_LONG],
    ["High and high", "High\nhigh\nLow", W.choiceRepeated("high")],
  ] as const)
    it(`refuses ${name}`, async () => {
      const s = makeStore([choice(1, ["High", "Low"])]);
      expect(await opts(s, choices)).toEqual({ error: want });
      expect(s.writes()).toEqual([]);
    });

  it("a removed choice still in use is named with its count; singular and plural; nothing written", async () => {
    const s = makeStore([choice(1, ["High", "Medium", "Low"])], { use: { High: 3, Low: 1 } });
    expect(await opts(s, "Medium")).toEqual({ error: `${W.optionInUse("High", 3)} ${W.optionInUse("Low", 1)}` });
    expect(W.optionInUse("High", 3)).toBe("High is still used on 3 records.");
    expect(W.optionInUse("Low", 1)).toBe("Low is still used on 1 record.");
    expect(s.deps.readOptionUse).toHaveBeenCalledWith(fid(1), ["High", "Low"]);
    expect(s.writes()).toEqual([]);
  });
  it("an unreadable count refuses", async () => {
    const s = makeStore([choice(1, ["High", "Low"])]);
    s.deps.readOptionUse.mockRejectedValue(new Error("down"));
    expect(await opts(s, "High")).toEqual({ error: W.CUSTOM_SAVE_FAILED_READ });
    expect(s.writes()).toEqual([]);
  });
  it("a reorder and an add write { options } only, fenced on the read updated_at; no count read when nothing is removed", async () => {
    const s = makeStore([choice(1, ["High", "Low"])]);
    const read = s.rows[0].updated_at;
    expect(await opts(s, "Low\nHigh\nMedium")).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls[0]).toEqual([fid(1), { options: ["Low", "High", "Medium"] }, { updated_at: read }]);
    expect(s.deps.readOptionUse).not.toHaveBeenCalled();
  });
  it("N3: a stored choice with a tab is kept verbatim on save, so it never counts as removed", async () => {
    const s = makeStore([choice(1, ["High\t", "Low"])], { use: { "High\t": 2 } });
    expect(await opts(s, "High\t\r\nLow\r\nMedium")).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls[0][1]).toEqual({ options: ["High\t", "Low", "Medium"] });
    expect(s.deps.readOptionUse).not.toHaveBeenCalled();
  });
  it("Edit choices on a non-choice column is refused", async () => {
    const s = makeStore([field(1)]);
    expect(await opts(s, "A")).toEqual({ error: W.CUSTOM_BAD_KIND });
  });
});

/* ── F7 ── */

describe("F7: rename, archive, restore", () => {
  it("rename writes { label } fenced on the read updated_at", async () => {
    const s = makeStore([field(1, { label: "Priority" })]);
    const read = s.rows[0].updated_at;
    expect(await updateField(s.deps, { op: "rename", id: fid(1), label: " Urgency ", updatedAt: read })).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls).toEqual([[fid(1), { label: "Urgency" }, { updated_at: read }]]);
  });
  it("archive writes { archived: true } guarded archived = false", async () => {
    const s = makeStore([field(1)]);
    expect(await updateField(s.deps, { op: "archive", id: fid(1) })).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls).toEqual([[fid(1), { archived: true }, { archived: false }]]);
  });
  it("restore writes { archived: false, position } guarded archived = true; it comes back last", async () => {
    const s = makeStore([field(1, { position: 3 }), field(2, { position: 7 }), field(3, { position: 0, archived: true })]);
    expect(await updateField(s.deps, { op: "restore", id: fid(3) })).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls).toEqual([[fid(3), { archived: false, position: 8 }, { archived: true }]]);
    expect(s.live().at(-1)?.id).toBe(fid(3));
  });
  it("restore with 1000 taken goes to the lowest free; never 1001", async () => {
    const s = makeStore([field(1, { position: 1000 }), field(2, { position: 0 }), field(3, { position: 5, archived: true })]);
    await updateField(s.deps, { op: "restore", id: fid(3) });
    expect(s.deps.updateField.mock.calls[0][1]).toEqual({ archived: false, position: 1 });
  });
  it("0 rows on each guarded update is CUSTOM_FIELD_CHANGED", async () => {
    for (const [op, extra] of [["rename", { label: "X" }], ["archive", {}], ["restore", {}], ["options", { choices: "A" }]] as const) {
      const s = makeStore([op === "options" ? choice(1, ["A"]) : field(1, { archived: op === "restore" })]);
      s.deps.updateField.mockResolvedValue(0);
      expect(await updateField(s.deps, { op, id: fid(1), updatedAt: s.rows[0].updated_at, ...extra }), op).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
      expect(s.deps.revalidate).not.toHaveBeenCalled();
    }
  });

  describe("R4: the field read first, each answer with 0 writes", () => {
    const cases: Array<[string, (s: ReturnType<typeof makeStore>) => void, Record<string, unknown>, string]> = [
      ["42P01", (s) => s.deps.readField.mockRejectedValue({ code: "42P01", message: 'relation "public.crm_custom_field" does not exist' }), { op: "archive" }, W.CUSTOM_COLUMNS_NOT_READY],
      ["PGRST205", (s) => s.deps.readField.mockRejectedValue({ code: "PGRST205", message: "x" }), { op: "rename", label: "X", updatedAt: "s" }, W.CUSTOM_COLUMNS_NOT_READY],
      ["not found (another firm's id reads the same)", (s) => s.deps.readField.mockResolvedValue(null), { op: "archive" }, W.CUSTOM_FIELD_GONE],
      ["another error: the mapper", (s) => s.deps.readField.mockRejectedValue({ code: "40P01", message: "deadlock detected" }), { op: "archive" }, W.CUSTOM_BUSY],
      ["options on a text field", () => {}, { op: "options", choices: "A", updatedAt: "s" }, W.CUSTOM_BAD_KIND],
    ];
    for (const [name, arrange, input, want] of cases)
      it(name, async () => {
        const s = makeStore([field(1)]);
        arrange(s);
        expect(await updateField(s.deps, { id: fid(1), ...input } as UpdateInput)).toEqual({ error: want });
        expect(s.writes()).toEqual([]);
        expect(s.deps.readLiveFields).not.toHaveBeenCalled();
      });
    for (const op of ["rename", "options", "move"] as const)
      it(`${op} on an archived field`, async () => {
        const s = makeStore([choice(1, ["A"], { archived: true })]);
        expect(await updateField(s.deps, { op, id: fid(1), label: "X", choices: "A\nB", dir: "up", updatedAt: s.rows[0].updated_at })).toEqual({ error: W.CUSTOM_COLUMN_ARCHIVED });
        expect(s.writes()).toEqual([]);
      });
    it("restore on a live field and archive on an archived one", async () => {
      const a = makeStore([field(1)]);
      expect(await updateField(a.deps, { op: "restore", id: fid(1) })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
      const b = makeStore([field(1, { archived: true })]);
      expect(await updateField(b.deps, { op: "archive", id: fid(1) })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
      expect([...a.writes(), ...b.writes()]).toEqual([]);
    });
    it("a malformed id is gone and an unknown op or dir fails, with no read", async () => {
      const s = makeStore([field(1)]);
      expect(await updateField(s.deps, { op: "archive", id: "not-a-uuid" })).toEqual({ error: W.CUSTOM_FIELD_GONE });
      expect(await updateField(s.deps, { op: "delete", id: fid(1) })).toEqual({ error: W.CUSTOM_SAVE_FAILED });
      expect(await updateField(s.deps, { op: "move", id: fid(1), dir: "sideways" })).toEqual({ error: W.CUSTOM_SAVE_FAILED });
      expect(s.calls).toEqual([]);
    });
  });

  describe("R5: no silent lost update of names or choices", () => {
    it("(a) another admin's change lands between the read and the write: the fenced update affects 0 rows", async () => {
      const s = makeStore([choice(1, ["High", "Low"])]);
      const read = s.rows[0].updated_at;
      s.deps.readOptionUse.mockImplementation(async () => {
        s.rows[0].options = ["High", "Low", "Medium"];
        s.rows[0].updated_at = "2026-11-21T00:00:00.000001+00:00";
        return { Low: 0 };
      });
      expect(await updateField(s.deps, { op: "options", id: fid(1), choices: "High", updatedAt: read })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
      expect(s.deps.updateField).toHaveBeenCalledTimes(1);
      expect(s.rows[0].options).toEqual(["High", "Low", "Medium"]);
    });
    it("(b) a stale rendered stamp and (c) a missing one: 0 writes", async () => {
      for (const updatedAt of ["2026-01-01T00:00:00+00:00", undefined, ""]) {
        const s = makeStore([choice(1, ["High"], { label: "Priority" })]);
        expect(await updateField(s.deps, { op: "rename", id: fid(1), label: "Urgency", updatedAt })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
        expect(await updateField(s.deps, { op: "options", id: fid(1), choices: "High\nLow", updatedAt })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
        expect(s.writes()).toEqual([]);
      }
    });
    it("N1: the stamp is compared as the exact string read (microseconds count)", async () => {
      const s = makeStore([field(1, { updated_at: "2026-11-20T10:00:00.123456+00:00" })]);
      expect(await updateField(s.deps, { op: "rename", id: fid(1), label: "X", updatedAt: "2026-11-20T10:00:00.123+00:00" })).toEqual({ error: W.CUSTOM_FIELD_CHANGED });
    });
    it("N4: two Renames in a row in the same tab both succeed with the re-read stamp", async () => {
      const s = makeStore([field(1, { label: "Priority" })]);
      expect(await updateField(s.deps, { op: "rename", id: fid(1), label: "Urgency", updatedAt: s.rows[0].updated_at })).toEqual({ saved: true });
      expect(await updateField(s.deps, { op: "rename", id: fid(1), label: "Importance", updatedAt: s.rows[0].updated_at })).toEqual({ saved: true });
      expect(s.rows[0].label).toBe("Importance");
    });
  });
});

/* ── F8 ── */

describe("F8: Move in the one list", () => {
  it("a swap: two guarded single-row writes, in order; revalidate once", async () => {
    const s = makeStore([field(1, { position: 2 }), field(2, { position: 5 }), field(3, { position: 9 })]);
    expect(await updateField(s.deps, { op: "move", id: fid(2), dir: "up" })).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls).toEqual([
      [fid(2), { position: 2 }, { position: 5 }],
      [fid(1), { position: 5 }, { position: 2 }],
    ]);
    expect(s.live().map((f) => f.id)).toEqual([fid(2), fid(1), fid(3)]);
    expect(s.deps.revalidate).toHaveBeenCalledTimes(1);
  });
  it("down at the end, or up at the top, is CUSTOM_ORDER_CHANGED with no write", async () => {
    const s = makeStore([field(1, { position: 0 }), field(2, { position: 1 })]);
    expect(await updateField(s.deps, { op: "move", id: fid(1), dir: "up" })).toEqual({ error: W.CUSTOM_ORDER_CHANGED });
    expect(await updateField(s.deps, { op: "move", id: fid(2), dir: "down" })).toEqual({ error: W.CUSTOM_ORDER_CHANGED });
    expect(s.writes()).toEqual([]);
  });
  it("the neighbour is the adjacent row AS RETURNED (C collation puts B before a), never a localeCompare re-sort", async () => {
    const s = makeStore([field(1, { position: 4, label: "a" }), field(2, { position: 4, label: "B" }), field(3, { position: 0 })]);
    expect(s.live().map((f) => f.label)).toEqual(["Column 3", "B", "a"]);
    expect(["a", "B"].sort((x, y) => x.localeCompare(y, "en"))).toEqual(["a", "B"]);
    // "a" up: its neighbour as returned is "B" (equal positions), so only "a" is written, to 3.
    expect(await updateField(s.deps, { op: "move", id: fid(1), dir: "up" })).toEqual({ saved: true });
    expect(s.deps.updateField.mock.calls).toEqual([[fid(1), { position: 3 }, { position: 4 }]]);
    expect(s.live().map((f) => f.label)).toEqual(["Column 3", "a", "B"]);
  });
  it("a stale first write: CUSTOM_ORDER_CHANGED, no second call, no revalidate", async () => {
    const s = makeStore([field(1, { position: 1 }), field(2, { position: 2 })]);
    s.deps.updateField.mockResolvedValueOnce(0);
    expect(await updateField(s.deps, { op: "move", id: fid(2), dir: "up" })).toEqual({ error: W.CUSTOM_ORDER_CHANGED });
    expect(s.deps.updateField).toHaveBeenCalledTimes(1);
    expect(s.deps.revalidate).not.toHaveBeenCalled();
  });
  for (const how of ["errors", "affects 0 rows"])
    it(`a second write that ${how}: one compensation guarded on the new position, CUSTOM_MOVE_FAILED, revalidate once`, async () => {
      const s = makeStore([field(1, { position: 1 }), field(2, { position: 2 })]);
      const real = s.deps.updateField.getMockImplementation()!;
      let n = 0;
      s.deps.updateField.mockImplementation(async (...a) => {
        n += 1;
        if (n === 2) {
          if (how === "errors") throw { code: "40P01", message: "deadlock detected" };
          return 0;
        }
        return real(...a);
      });
      expect(await updateField(s.deps, { op: "move", id: fid(2), dir: "up" })).toEqual({ error: W.CUSTOM_MOVE_FAILED });
      expect(s.deps.updateField.mock.calls).toEqual([
        [fid(2), { position: 1 }, { position: 2 }],
        [fid(1), { position: 2 }, { position: 1 }],
        [fid(2), { position: 2 }, { position: 1 }],
      ]);
      expect(s.deps.revalidate).toHaveBeenCalledTimes(1);
      expect(s.rows.map((r) => r.position).sort()).toEqual([1, 2]);
    });
  for (const how of ["errors", "affects 0 rows"])
    it(`a compensation that ${how}: still CUSTOM_MOVE_FAILED, no further call, no throw`, async () => {
      const s = makeStore([field(1, { position: 1 }), field(2, { position: 2 })]);
      let n = 0;
      s.deps.updateField.mockImplementation(async () => {
        n += 1;
        if (n === 1) return 1;
        if (n === 3 && how === "errors") throw new Error("down");
        return 0;
      });
      await expect(updateField(s.deps, { op: "move", id: fid(2), dir: "up" })).resolves.toEqual({ error: W.CUSTOM_MOVE_FAILED });
      expect(s.deps.updateField).toHaveBeenCalledTimes(3);
      expect(s.deps.revalidate).toHaveBeenCalledTimes(1);
    });

  describe("equal positions (R2c)", () => {
    it("the target is free: one write", async () => {
      const s = makeStore([field(1, { position: 5, label: "A" }), field(2, { position: 5, label: "B" })]);
      expect(await updateField(s.deps, { op: "move", id: fid(1), dir: "down" })).toEqual({ saved: true });
      expect(s.deps.updateField.mock.calls).toEqual([[fid(1), { position: 6 }, { position: 5 }]]);
    });
    it("the target is taken: CUSTOM_MOVE_FAILED, nothing written", async () => {
      const s = makeStore([field(1, { position: 5, label: "A" }), field(2, { position: 5, label: "B" }), field(3, { position: 6 })]);
      expect(await updateField(s.deps, { op: "move", id: fid(1), dir: "down" })).toEqual({ error: W.CUSTOM_MOVE_FAILED });
      expect(s.writes()).toEqual([]);
    });
    it("out of range: 0 up and 1000 down", async () => {
      const lo = makeStore([field(1, { position: 0, label: "A" }), field(2, { position: 0, label: "B" })]);
      expect(await updateField(lo.deps, { op: "move", id: fid(2), dir: "up" })).toEqual({ error: W.CUSTOM_MOVE_FAILED });
      const hi = makeStore([field(1, { position: 1000, label: "A" }), field(2, { position: 1000, label: "B" })]);
      expect(await updateField(hi.deps, { op: "move", id: fid(1), dir: "down" })).toEqual({ error: W.CUSTOM_MOVE_FAILED });
      expect([...lo.writes(), ...hi.writes()]).toEqual([]);
    });
    it("a third field shares the tie: CUSTOM_MOVE_FAILED", async () => {
      const s = makeStore([field(1, { position: 5, label: "A" }), field(2, { position: 5, label: "B" }), field(3, { position: 5, label: "C" })]);
      expect(await updateField(s.deps, { op: "move", id: fid(3), dir: "up" })).toEqual({ error: W.CUSTOM_MOVE_FAILED });
      expect(s.writes()).toEqual([]);
    });
  });

  it("R1: a Trademarks field moved above a Both field is first among Trademarks' custom columns; both sections follow the Settings order", async () => {
    const s = makeStore([field(1, { position: 1, section: "contracts", label: "Signed on" }), field(2, { position: 2, section: "both", label: "Quoted fee" }), field(3, { position: 3, section: "trademarks", label: "Priority" })]);
    expect(await updateField(s.deps, { op: "move", id: fid(3), dir: "up" })).toEqual({ saved: true });
    const settings = s.live();
    expect(settings.map((f) => f.label)).toEqual(["Signed on", "Priority", "Quoted fee"]);
    const asFields = settings as unknown as CustomColumnField[];
    expect(fieldsForSection(asFields, "trademarks").map((f) => f.label)).toEqual(settings.filter((f) => f.section !== "contracts").map((f) => f.label));
    expect(fieldsForSection(asFields, "contracts").map((f) => f.label)).toEqual(settings.filter((f) => f.section !== "trademarks").map((f) => f.label));
    expect(fieldsForSection(asFields, "trademarks")[0].label).toBe("Priority");
  });
});

/* ── R2d: two admins' moves, statement by statement ── */

describe("R2d: interleaved moves never lose a field or leave a position outside 0..1000", () => {
  type Scenario = { name: string; a: { id: number; dir: "up" | "down" }; b: { id: number; dir: "up" | "down" } };
  const scenarios: Scenario[] = [
    { name: "opposite moves of one pair", a: { id: 2, dir: "up" }, b: { id: 1, dir: "down" } },
    { name: "overlapping pairs (A moves 2 up, B moves 3 up)", a: { id: 2, dir: "up" }, b: { id: 3, dir: "up" } },
  ];
  const orders: string[][] = [
    ["A", "B", "A", "B"],
    ["A", "A", "B", "B"],
    ["B", "A", "B", "A"],
  ];
  for (const sc of scenarios)
    for (const order of orders)
      it(`${sc.name}, order ${order.map((x, i) => `${x}${order.slice(0, i + 1).filter((y) => y === x).length}`).join(", ")}`, async () => {
        const s = makeStore([field(1, { position: 1 }), field(2, { position: 2 }), field(3, { position: 3 })]);
        const queue = [...order];
        const waiters: Array<() => void> = [];
        const wake = () => waiters.splice(0).forEach((w) => w());
        const real = s.deps.updateField.getMockImplementation()!;
        const payloads: unknown[] = [];
        const gate = (who: string) => async () => {
          while (queue.includes(who) && queue[0] !== who) await new Promise<void>((r) => waiters.push(r));
        };
        const depsFor = (who: string): FieldDeps => ({
          ...s.deps,
          updateField: async (id, patch, guards) => {
            await gate(who)();
            payloads.push(patch);
            const out = await real(id, patch, guards);
            if (queue[0] === who) queue.shift();
            wake();
            return out;
          },
        });
        // Both read first (the reads of a request happen before its writes), then the writes interleave in `order`.
        const ra = updateField(depsFor("A"), { op: "move", id: fid(sc.a.id), dir: sc.a.dir }).finally(() => {
          while (queue.includes("A")) queue.splice(queue.indexOf("A"), 1);
          wake();
        });
        const rb = updateField(depsFor("B"), { op: "move", id: fid(sc.b.id), dir: sc.b.dir }).finally(() => {
          while (queue.includes("B")) queue.splice(queue.indexOf("B"), 1);
          wake();
        });
        const answers = await Promise.all([ra, rb]);
        expect(s.rows.map((r) => r.id).sort()).toEqual([fid(1), fid(2), fid(3)]);
        for (const r of s.rows) expect(r.position >= 0 && r.position <= 1000, String(r.position)).toBe(true);
        for (const a of answers) expect([JSON.stringify({ saved: true }), JSON.stringify({ error: W.CUSTOM_ORDER_CHANGED }), JSON.stringify({ error: W.CUSTOM_MOVE_FAILED })]).toContain(JSON.stringify(a));
        for (const p of payloads) expect(Object.keys(p as object)).toEqual(["position"]);
      });
});

/* ── F11 ── */

describe("F11: before 0115, with valid inputs", () => {
  for (const code of ["42P01", "PGRST205"]) {
    it(`${code}: create answers not-ready after the one live read; nothing else is called`, async () => {
      const s = makeStore([]);
      s.deps.readLiveFields.mockRejectedValue({ code, message: "x" });
      await expect(create(s.deps)).resolves.toEqual({ error: W.CUSTOM_COLUMNS_NOT_READY });
      expect(s.deps.insertField).not.toHaveBeenCalled();
      expect(s.deps.readField).not.toHaveBeenCalled();
    });
    for (const input of [
      { op: "rename", label: "Urgency", updatedAt: "s" },
      { op: "options", choices: "High", updatedAt: "s" },
      { op: "move", dir: "up" },
      { op: "archive" },
      { op: "restore" },
    ])
      it(`${code}: ${input.op} answers not-ready after the field read`, async () => {
        const s = makeStore([]);
        s.deps.readField.mockRejectedValue({ code, message: "x" });
        await expect(updateField(s.deps, { id: fid(1), ...input })).resolves.toEqual({ error: W.CUSTOM_COLUMNS_NOT_READY });
        for (const spy of ["readLiveFields", "readOptionUse", "insertField", "updateField"] as const) expect(s.deps[spy]).not.toHaveBeenCalled();
        expect(s.deps.revalidate).not.toHaveBeenCalled();
      });
  }
  it("R20: an empty label answers its own sentence before any read", async () => {
    const s = makeStore([]);
    s.deps.readLiveFields.mockRejectedValue({ code: "42P01" });
    expect(await create(s.deps, { label: "" })).toEqual({ error: W.CUSTOM_LABEL_EMPTY });
    expect(s.deps.readLiveFields).not.toHaveBeenCalled();
  });
  it("a database error on the write goes through the mapper (context field)", async () => {
    const s = makeStore([]);
    s.deps.insertField.mockRejectedValue({ code: "23514", message: "custom_field_limit: a firm has at most 40 live columns" });
    expect(await create(s.deps)).toEqual({ error: W.CUSTOM_LIMIT });
    expect(s.deps.revalidate).not.toHaveBeenCalled();
  });
});

/* ── C1: write counts ── */

describe("C1: one write per op (Move: two plus at most one compensation), never an array", () => {
  it("each op's write calls", async () => {
    const counts: Record<string, number> = {};
    const run = async (op: string, rows: FakeField[], input: Record<string, unknown>) => {
      const s = makeStore(rows);
      await (op === "create" ? create(s.deps) : updateField(s.deps, { op, id: fid(1), updatedAt: s.rows[0]?.updated_at, ...input }));
      counts[op] = s.writes().length;
      for (const w of s.writes()) for (const a of w.args) expect(Array.isArray(a)).toBe(false);
    };
    await run("create", [], {});
    await run("rename", [field(1)], { label: "X" });
    await run("options", [choice(1, ["A"])], { choices: "A\nB" });
    await run("archive", [field(1)], {});
    await run("restore", [field(1, { archived: true })], {});
    await run("move", [field(1, { position: 2 }), field(2, { position: 1 })], { dir: "up" });
    expect(counts).toEqual({ create: 1, rename: 1, options: 1, archive: 1, restore: 1, move: 2 });
  });
});


describe("createFieldWithId (the column menu's Add a column)", () => {
  it("answers the new field's id when the store returns one, and null for a refusal", async () => {
    const s = makeStore([]);
    s.deps.insertField.mockResolvedValue(fid(77));
    expect(await createFieldWithId(s.deps, { label: "Priority", section: "trademarks", kind: "text", choices: "" })).toEqual({ state: { saved: true }, id: fid(77) });
    const none = makeStore([]);
    expect(await createFieldWithId(none.deps, { label: "Second", section: "trademarks", kind: "text", choices: "" })).toEqual({ state: { saved: true }, id: null });
    const refused = makeStore([], { role: "admin" });
    expect(await createFieldWithId(refused.deps, { label: "Third", section: "trademarks", kind: "text", choices: "" })).toEqual({ state: { error: W.COLUMNS_NO_PERMISSION }, id: null });
  });
});
