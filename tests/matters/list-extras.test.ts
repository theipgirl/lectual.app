import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Matters List's two extra reads: three-state each, scoped client only, never "nothing" for a failure. */
const h = vi.hoisted(() => ({ client: "ok" as "ok" | "throws", custom: { status: "ok", fields: [], values: [], mergedInto: {} } as unknown, notes: { status: "ok", byKey: new Map() } as unknown, customArgs: [] as unknown[], notesArgs: [] as unknown[] }));

async function load(opts: { withNotes: boolean; canSeeMoney: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: async () => {
      if (h.client === "throws") throw new Error("no session");
      return { scoped: true };
    },
  }));
  vi.doMock("@/lib/custom-columns/load", () => ({ loadCustomColumns: async (...a: unknown[]) => (h.customArgs.push(a), h.custom) }));
  vi.doMock("@/lib/review/load", () => ({ readMergedChildren: async () => new Map() }));
  vi.doMock("@/lib/review/sheet-notes-load", () => ({ readSheetNotes: async (...a: unknown[]) => (h.notesArgs.push(a), h.notes) }));
  const { loadMatterListExtras } = await import("@/lib/matters/list-extras");
  return loadMatterListExtras({ matters: [{ id: "m1", lead_id: "l1" }, { id: "m2", lead_id: null }, { id: "m3", lead_id: "l1" }], timeZone: "America/New_York", ...opts });
}

beforeEach(() => {
  h.client = "ok";
  h.custom = { status: "ok", fields: [], values: [], mergedInto: {} };
  h.notes = { status: "ok", byKey: new Map() };
  h.customArgs = [];
  h.notesArgs = [];
});

describe("loadMatterListExtras", () => {
  it("reads the firm's columns for the shown matters and their leads (once each), and says which lead each matter has", async () => {
    const r = await load({ withNotes: true, canSeeMoney: true });
    const [, matterIds, leadIds, , access] = h.customArgs[0] as [unknown, string[], string[], unknown, { canSeeMoney: boolean }];
    expect(matterIds).toEqual(["m1", "m2", "m3"]);
    expect(leadIds).toEqual(["l1"]);
    expect(access).toEqual({ canSeeMoney: true });
    expect(r.custom).toMatchObject({ status: "ok", leadOfMatter: { m1: "l1", m3: "l1" } });
    expect(r.notes).toMatchObject({ status: "ok" });
  });
  it("a hidden Notes column asks for no notes", async () => {
    const r = await load({ withNotes: false, canSeeMoney: false });
    expect(r.notes).toBeNull();
    expect(h.notesArgs).toEqual([]);
  });
  it("a non-owner's state never carries a Money field or amount, whatever the read returned", async () => {
    h.custom = {
      status: "ok",
      fields: [
        { id: "f1", section: "trademarks", label: "Priority", kind: "text", position: 1, options: [] },
        { id: "f2", section: "trademarks", label: "Fee", kind: "money", position: 2, options: [] },
      ],
      values: [{ id: "v1", fieldId: "f2", leadId: null, matterId: "m1", text: null, date: null, cents: 5000, choice: null, userId: null, updatedAt: "x" }],
      mergedInto: {},
    };
    const r = await load({ withNotes: false, canSeeMoney: false });
    expect(JSON.stringify(r.custom)).not.toContain("Fee");
    expect(JSON.stringify(r.custom)).not.toContain("5000");
  });
  it("not set up and unavailable are passed on as they are, never as an empty state", async () => {
    h.custom = { status: "not-set-up" };
    expect((await load({ withNotes: false, canSeeMoney: false })).custom).toEqual({ status: "not-set-up" });
    h.custom = { status: "unavailable" };
    expect((await load({ withNotes: false, canSeeMoney: false })).custom).toEqual({ status: "unavailable" });
  });
  it("no scoped client (no session) is unavailable for both reads, and a throwing read is too", async () => {
    h.client = "throws";
    const r = await load({ withNotes: true, canSeeMoney: true });
    expect(r).toEqual({ custom: { status: "unavailable" }, notes: { status: "unavailable" } });
  });
});
