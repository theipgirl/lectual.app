import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F13 / R13: no action takes an org, a user, a role or a stamp from the browser. A source scan of the three action files, then the
 * behavioural proof through the real `"use server"` wrappers: the store, the session and the role are mocked; the form posts every
 * forged field; the payloads are exactly what the server decided.
 */

const ROOT = path.resolve(__dirname, "../..");
const code = (f: string) => readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILES = ["src/lib/custom-columns/actions.ts", "src/lib/custom-columns/field-actions.ts", "src/lib/custom-columns/value-actions.ts"];

describe("F13: the source scan", () => {
  for (const f of FILES)
    it(f, () => {
      const src = code(f);
      expect(src).not.toMatch(/formData\.get\(\s*["'`][^"'`]*(?:org|user_id|updated_by|created_by|role)/i);
      expect(src).not.toMatch(/Object\.fromEntries\(\s*formData/);
      expect(src).not.toMatch(/\.\.\.\s*formData/);
      expect(src).not.toMatch(/\.\.\.\s*\[?\s*\.\.\.\s*formData/);
      expect(src).not.toMatch(/formData\.(entries|values)\(\)/);
    });
  it("actions.ts reads exactly the named fields", () => {
    const names = [...code("src/lib/custom-columns/actions.ts").matchAll(/formData\.get\(["'`](\w+)["'`]\)/g)].map((m) => m[1]).sort();
    expect([...new Set(names)]).toEqual(["choices", "dir", "fieldId", "id", "kind", "label", "op", "section", "updatedAt", "value"].sort());
  });
});

/* ── Behaviour through the wrappers ── */

const ORG = "00000000-0000-4000-8000-0000000000aa";
const FORGED_ORG = "00000000-0000-4000-8000-0000000000ff";
const F1 = "00000000-0000-4000-8000-00000000f001";
const F2 = "00000000-0000-4000-8000-00000000f002";
const LEAD = "00000000-0000-4000-8000-0000000000d1";
const STAMP = "2026-11-20T10:00:00.123456+00:00";

const h = vi.hoisted(() => ({
  fields: [] as Array<Record<string, unknown>>,
  updates: [] as unknown[][],
  inserts: [] as unknown[],
  valueInserts: [] as unknown[],
  valueUpdates: [] as unknown[][],
  /** The value action's role and session (Nov 23 follow-up: the actingAsStaff wiring). Undefined = the defaults below. */
  role: undefined as string | undefined,
  session: undefined as unknown,
  ownerState: "owner" as string,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
// The field actions ask the caller's own membership row (an owner), not the role claim.
vi.mock("@/lib/views/layout/owner-load", () => ({ loadOwnerState: async () => h.ownerState }));
vi.mock("@/lib/pipeline/leads", () => ({ resolveCurrentRole: async () => h.role ?? "attorney" }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => h.session ?? { kind: "ok", role: "owner", org: { id: "00000000-0000-4000-8000-0000000000aa" } } }));
vi.mock("@/lib/leads/live", () => ({ keeperForWrite: async (_db: unknown, id: string) => id }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
vi.mock("@/lib/custom-columns/store", () => ({
  fieldStore: () => ({
    readField: async (id: string) => h.fields.find((f) => f.id === id) ?? null,
    readLiveFields: async () => h.fields.filter((f) => !f.archived).sort((a, b) => Number(a.position) - Number(b.position)),
    readOptionUse: async (_id: string, options: string[]) => Object.fromEntries(options.map((o) => [o, 0])),
    insertField: async (row: unknown) => {
      h.inserts.push(row);
      return null;
    },
    updateField: async (...args: unknown[]) => {
      h.updates.push(args);
      return 1;
    },
  }),
  valueStore: () => ({
    readRecord: async (kind: string, id: string) => (kind === "lead" && id === LEAD ? { id: LEAD, org_id: ORG } : null),
    readValueRow: async () => null,
    insertValue: async (row: unknown) => {
      h.valueInserts.push(row);
    },
    updateValue: async (...args: unknown[]) => {
      h.valueUpdates.push(args);
      return 1;
    },
    deleteValue: async () => 1,
  }),
}));

const FORGED: Record<string, string> = {
  org_id: FORGED_ORG,
  orgId: FORGED_ORG,
  created_by: "00000000-0000-4000-8000-0000000000c9",
  updated_by: "00000000-0000-4000-8000-0000000000c9",
  position: "999",
  archived: "true",
  role: "owner",
  user_id: "00000000-0000-4000-8000-0000000000c9",
};
const form = (fields: Record<string, string>, forgeKindSection = true) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...FORGED, ...(forgeKindSection ? { kind: "person", section: "both" } : {}), ...fields })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  h.fields = [
    { id: F1, section: "trademarks", kind: "choice", label: "Priority", options: ["High", "Low"], position: 1, archived: false, updated_at: STAMP },
    { id: F2, section: "contracts", kind: "text", label: "Signed on", options: [], position: 2, archived: false, updated_at: STAMP },
    { id: "00000000-0000-4000-8000-00000000f003", section: "both", kind: "text", label: "Old flag", options: [], position: 0, archived: true, updated_at: STAMP },
  ];
  h.updates = [];
  h.inserts = [];
  h.valueInserts = [];
  h.valueUpdates = [];
  h.role = undefined;
  h.session = undefined;
  h.ownerState = "owner";
});

describe("F3 / F7 / F8 / F13: forged fields change no payload", () => {
  it("create: the six keys, the session's org; kind and section are the real inputs, validated", async () => {
    const { createFieldAction } = await import("@/lib/custom-columns/actions");
    expect(await createFieldAction({}, form({ label: "Quoted fee", kind: "money", section: "trademarks" }, false))).toEqual({ saved: true });
    expect(h.inserts).toEqual([{ org_id: ORG, section: "trademarks", label: "Quoted fee", kind: "money", options: [], position: 3 }]);
    expect(await createFieldAction({}, form({ label: "Bad", kind: "number", section: "trademarks" }, false))).toEqual({ error: "Choose Text, Date, Money, Choice or Person." });
    expect(await createFieldAction({}, form({ label: "Bad", kind: "text", section: "all" }, false))).toEqual({ error: "Choose Trademarks, Contracts or Both." });
    expect(h.inserts).toHaveLength(1);
  });

  it("the field actions refuse a caller whose membership row isn't an owner (the admin tier included): nothing is read or written", async () => {
    const { createFieldAction, updateFieldAction } = await import("@/lib/custom-columns/actions");
    for (const state of ["not-owner", "unreadable"]) {
      h.ownerState = state;
      expect(await createFieldAction({}, form({ label: "Quoted fee", kind: "text", section: "trademarks" }, false))).toEqual({ error: "Only an owner can change columns." });
      expect(await updateFieldAction({}, form({ op: "archive", id: F1 }))).toEqual({ error: "Only an owner can change columns." });
    }
    expect(h.inserts).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  for (const [op, fields, want] of [
    ["rename", { op: "rename", id: F1, label: "Urgency", updatedAt: STAMP }, [[F1, { label: "Urgency" }, { updated_at: STAMP }]]],
    ["options", { op: "options", id: F1, choices: "High\nLow\nMedium", updatedAt: STAMP }, [[F1, { options: ["High", "Low", "Medium"] }, { updated_at: STAMP }]]],
    ["archive", { op: "archive", id: F1 }, [[F1, { archived: true }, { archived: false }]]],
    ["restore", { op: "restore", id: "00000000-0000-4000-8000-00000000f003" }, [["00000000-0000-4000-8000-00000000f003", { archived: false, position: 3 }, { archived: true }]]],
    ["move (a forged neighbour id and position are ignored)", { op: "move", id: F2, dir: "up", neighbour: F1, neighbourId: F1 }, [[F2, { position: 1 }, { position: 2 }], [F1, { position: 2 }, { position: 1 }]]],
  ] as const)
    it(`${op}: exact patch keys and guards`, async () => {
      const { updateFieldAction } = await import("@/lib/custom-columns/actions");
      expect(await updateFieldAction({}, form(fields as Record<string, string>))).toEqual({ saved: true });
      expect(h.updates).toEqual(want);
    });

  it("the value action: the insert's org is the RECORD's; the record kind is a real input", async () => {
    const { setCustomValueAction } = await import("@/lib/custom-columns/actions");
    const fd = form({ fieldId: F1, kind: "lead", id: LEAD, value: "High" }, false);
    fd.set("section", "contracts");
    expect(await setCustomValueAction({}, fd)).toEqual({ saved: true });
    expect(h.valueInserts).toEqual([{ org_id: ORG, field_id: F1, lead_id: LEAD, value_choice: "High" }]);
    const wrongKind = form({ fieldId: F1, kind: "matter", id: LEAD, value: "High" }, false);
    expect(await setCustomValueAction({}, wrongKind)).toEqual({ error: "That record couldn't be found. It may have been removed." });
    expect(h.valueInserts).toHaveLength(1);
  });
});

/* ── Nov 23 follow-up: valueDeps().actingAsStaff, through the real wrapper, on a Money field typed by an owner role ── */

describe("the value action's actingAsStaff wiring (a Money field, owner role)", () => {
  const MONEY = "00000000-0000-4000-8000-00000000f009";
  const post = async () => {
    const { setCustomValueAction } = await import("@/lib/custom-columns/actions");
    return setCustomValueAction({}, form({ fieldId: MONEY, kind: "lead", id: LEAD, value: "1250" }, false));
  };
  beforeEach(() => {
    h.fields.push({ id: MONEY, section: "trademarks", kind: "money", label: "Quoted fee", options: [], position: 3, archived: false, updated_at: STAMP });
    h.role = "owner";
  });

  it("a session that isn't ok reads as staff (true): refused, nothing written", async () => {
    h.session = { kind: "signed-out", redirectTo: "/" };
    expect(await post()).toEqual({ error: "Only the firm's owner can see or change money in the firm's own columns." });
    expect(h.valueInserts).toEqual([]);
  });

  it("actingAsStaff: true reads as staff (true): refused, nothing written", async () => {
    h.session = { kind: "ok", role: "owner", org: { id: ORG }, actingAsStaff: true };
    expect(await post()).toEqual({ error: "Only the firm's owner can see or change money in the firm's own columns." });
    expect(h.valueInserts).toEqual([]);
  });

  it("a real member (actingAsStaff: false) reads as not staff (false): the owner's amount is written", async () => {
    h.session = { kind: "ok", role: "owner", org: { id: ORG }, actingAsStaff: false };
    expect(await post()).toEqual({ saved: true });
    expect(h.valueInserts).toEqual([{ org_id: ORG, field_id: MONEY, lead_id: LEAD, value_cents: 125000 }]);
  });

  it("a session with no actingAsStaff flag at all fails closed (staff)", async () => {
    h.session = { kind: "ok", role: "owner", org: { id: ORG } };
    expect(await post()).toEqual({ error: "Only the firm's owner can see or change money in the firm's own columns." });
  });
});
