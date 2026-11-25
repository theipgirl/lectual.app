import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { layoutStore, type LayoutWriteClient } from "@/lib/views/layout/store";

/** The layout store's calls, and the wiring of the two actions, with a recording fake of the scoped client. */

type Step = unknown[];
function recorder(answer: { data?: unknown; error?: unknown }) {
  const chains: Step[][] = [];
  const client: LayoutWriteClient = {
    from(table: string) {
      const chain: Step[] = [["from", table]];
      chains.push(chain);
      const q: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }).then(res),
      };
      for (const m of ["eq", "select"]) q[m] = (...a: unknown[]) => (chain.push([m, ...a]), q);
      return {
        insert: (row: Record<string, unknown>) => (chain.push(["insert", row]), Promise.resolve({ data: null, error: answer.error ?? null })),
        update: (patch: Record<string, unknown>) => (chain.push(["update", patch]), q as never),
      };
    },
  };
  return { client, chains };
}
const COLS = [{ key: "client", label: null, hidden: false, width: null }];

describe("the layout store", () => {
  it("insert names exactly org_id, view_key and columns: no rev, no stamps, no upsert", async () => {
    const r = recorder({});
    expect(await layoutStore(r.client).insert("review_list_trademarks", "org-1", COLS)).toEqual({ error: null });
    expect(r.chains).toEqual([[["from", "crm_view_layout"], ["insert", { org_id: "org-1", view_key: "review_list_trademarks", columns: COLS }]]]);
  });
  it("update names columns alone, fenced on the view and the rev read, and answers the new rev", async () => {
    const r = recorder({ data: [{ rev: 4 }] });
    expect(await layoutStore(r.client).update("review_list_trademarks", COLS, 3)).toEqual({ error: null, rev: 4 });
    expect(r.chains).toEqual([[["from", "crm_view_layout"], ["update", { columns: COLS }], ["eq", "view_key", "review_list_trademarks"], ["eq", "rev", 3], ["select", "rev"]]]);
  });
  it("update that matched no row answers rev null (the caller says someone else changed it); an error is passed on as it came", async () => {
    expect(await layoutStore(recorder({ data: [] }).client).update("review_list_trademarks", COLS, 3)).toEqual({ error: null, rev: null });
    const err = { code: "42501" };
    expect(await layoutStore(recorder({ error: err }).client).update("review_list_trademarks", COLS, 3)).toEqual({ error: err });
    expect(await layoutStore(recorder({ error: err }).client).insert("review_list_trademarks", "o", COLS)).toEqual({ error: err });
  });
});

describe("the layout actions' source", () => {
  const src = readFileSync("src/lib/views/layout/actions.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("is a use-server file whose every export is wrapped in previewSafe, and uses the scoped client only", () => {
    expect(src).toMatch(/^"use server"/);
    expect([...src.matchAll(/export const (\w+) = previewSafe\(/g)].map((m) => m[1]).sort()).toEqual(["addColumnAction", "changeLayoutAction", "firmColumnAction"]);
    expect(src).not.toMatch(/\bexport (async )?function\b/);
    expect(src).not.toMatch(/db\/admin|service[-_ ]?role|\.upsert\(/);
  });
  it("the store never upserts and never reads the service role", () => {
    const store = readFileSync("src/lib/views/layout/store.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(store).not.toMatch(/upsert|onConflict|db\/admin/);
  });
});

const h = vi.hoisted(() => ({ owner: "owner" as string, inserts: [] as unknown[], updates: [] as unknown[], read: { status: "ok", layout: null, rev: null } as unknown }));
describe("the actions, wired", () => {
  beforeEach(() => {
    vi.resetModules();
    h.owner = "owner";
    h.inserts = [];
    h.updates = [];
    h.read = { status: "ok", layout: null, rev: null };
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/views/preview-safe", () => ({ previewSafe: (fn: unknown) => fn }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", org: { id: "org-1" } }) }));
    vi.doMock("@/lib/views/layout/owner-load", () => ({ loadOwnerState: async () => h.owner }));
    vi.doMock("@/lib/views/layout/load", () => ({ readViewLayout: async () => h.read }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [{ userId: "11111111-1111-4111-8111-111111111111", displayName: "Amy", email: null, role: "paralegal" }] }));
    vi.doMock("@/lib/custom-columns/store", () => ({
      fieldStore: () => ({ readLiveFields: async () => [] }),
    }));
    vi.doMock("@/lib/views/layout/store", () => ({
      layoutStore: () => ({
        insert: async (...a: unknown[]) => (h.inserts.push(a), { error: null }),
        update: async (...a: unknown[]) => (h.updates.push(a), { error: null, rev: 9 }),
      }),
    }));
  });

  it("a non-owner is refused before anything is read or written", async () => {
    h.owner = "not-owner";
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("review_list_trademarks", { op: "hide", key: "mark" }, null)).toEqual({ ok: false, error: "Only an owner can change this view." });
    expect(h.inserts).toEqual([]);
  });
  it("the first change writes an insert with the session's org; the Board's base is every member's lane", async () => {
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("review_list_trademarks", { op: "hide", key: "mark" }, null)).toEqual({ ok: true, rev: 1 });
    const [view, org, cols] = h.inserts[0] as [string, string, { key: string; hidden: boolean }[]];
    expect([view, org]).toEqual(["review_list_trademarks", "org-1"]);
    expect(cols.find((c) => c.key === "mark")!.hidden).toBe(true);
    h.inserts = [];
    expect(await changeLayoutAction("review_board", { op: "rename", key: "unassigned", label: "Nobody yet" }, null)).toEqual({ ok: true, rev: 1 });
    const board = (h.inserts[0] as [string, string, { key: string; label: string | null }[]])[2];
    expect(board.map((c) => c.key)).toEqual(["u11111111111141118111111111111111", "unassigned"]);
    expect(board[1].label).toBe("Nobody yet");
  });
  it("the Matters and Contracts Lists write their own layout over their own columns (built-ins; a firm column only when it fits)", async () => {
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("matters_list", { op: "hide", key: "notes" }, null)).toEqual({ ok: true, rev: 1 });
    const [view, org, cols] = h.inserts[0] as [string, string, { key: string; hidden: boolean }[]];
    expect([view, org]).toEqual(["matters_list", "org-1"]);
    expect(cols.map((c) => c.key)).toEqual(["matter", "type", "stage", "in_stage", "owner", "next_step", "notes"]);
    expect(cols.find((c) => c.key === "notes")!.hidden).toBe(true);
    // a column the List doesn't have is refused, and the pinned one can't be hidden
    h.inserts = [];
    expect((await changeLayoutAction("contracts_list", { op: "hide", key: "serial" }, null)).ok).toBe(false);
    expect((await changeLayoutAction("contracts_list", { op: "hide", key: "matter" }, null)).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
  it("the Matters and Contracts Boards save only what the stage columns can have: a hide of a real stage column", async () => {
    vi.doMock("@/lib/matters/stages", () => ({
      loadMatterStages: async () => ({ status: "ok", stages: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", label: "Open it", is_open: true }, { id: "aaaaaaaa-0000-4000-8000-000000000002", label: "Done", is_open: false }] }),
    }));
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("matters_board", { op: "hide", key: "st_aaaaaaaa000040008000000000000001" }, null)).toEqual({ ok: true, rev: 1 });
    const cols = (h.inserts[0] as [string, string, { key: string; hidden: boolean }[]])[2];
    // the two fixed columns and one per OPEN stage (a closed stage is folded into Closed and has no column of its own)
    expect(cols.map((c) => c.key)).toEqual(["not_on_docket", "st_aaaaaaaa000040008000000000000001", "closed"]);
    expect(cols.find((c) => c.key.startsWith("st_"))!.hidden).toBe(true);
    h.inserts = [];
    expect((await changeLayoutAction("contracts_board", { op: "hide", key: "st_ffffffff000040008000000000000009" }, null)).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
  it("a failed stage read refuses a Board change with a sentence and writes nothing", async () => {
    vi.doMock("@/lib/matters/stages", () => ({ loadMatterStages: async () => ({ status: "unavailable", error: new Error("x") }) }));
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect((await changeLayoutAction("matters_board", { op: "hide", key: "closed" }, null)).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
  it("the Leads List writes its own layout over the Leads columns (built-ins first); a column it doesn't have is refused, the pinned one can't be hidden", async () => {
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("leads_list", { op: "hide", key: "source" }, null)).toEqual({ ok: true, rev: 1 });
    const [view, org, cols] = h.inserts[0] as [string, string, { key: string; hidden: boolean }[]];
    expect([view, org]).toEqual(["leads_list", "org-1"]);
    expect(cols.map((c) => c.key)).toEqual(["lead", "stage", "temp", "source", "owner", "assistant", "touch", "next"]);
    expect(cols.find((c) => c.key === "source")!.hidden).toBe(true);
    h.inserts = [];
    expect((await changeLayoutAction("leads_list", { op: "hide", key: "x" }, null)).ok).toBe(false);
    expect((await changeLayoutAction("leads_list", { op: "hide", key: "lead" }, null)).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
  it("the Leads Board saves only what its stage columns can have: a hide of a real intake stage column, nothing else", async () => {
    vi.doMock("@/lib/pipeline/stages", () => ({
      listStages: async () => [
        { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "New", category: "open", order_index: 1 },
        { id: "aaaaaaaa-0000-4000-8000-000000000004", name: "Consult", category: "open", order_index: 2 },
        { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Signed LOE", category: "won", order_index: 5 },
        { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Lost", category: "lost", order_index: 9 },
      ],
    }));
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("leads_board", { op: "hide", key: "st_aaaaaaaa000040008000000000000001" }, null)).toEqual({ ok: true, rev: 1 });
    const cols = (h.inserts[0] as [string, string, { key: string; hidden: boolean }[]])[2];
    // one per INTAKE stage (open or nurture, before the first won stage); a won or lost stage has no column of its own
    expect(cols.map((c) => c.key)).toEqual(["st_aaaaaaaa000040008000000000000001", "st_aaaaaaaa000040008000000000000004"]);
    h.inserts = [];
    expect((await changeLayoutAction("leads_board", { op: "hide", key: "st_aaaaaaaa000040008000000000000003" }, null)).ok).toBe(false);
    // the Board's order and names are the stages' own: a rename or a move is refused
    expect((await changeLayoutAction("leads_board", { op: "rename", key: "st_aaaaaaaa000040008000000000000001", label: "X" }, null)).ok).toBe(false);
    expect(h.inserts).toEqual([]);
  });
  it("a failed stage read refuses a Leads Board change with a sentence and writes nothing", async () => {
    vi.doMock("@/lib/pipeline/stages", () => ({ listStages: async () => Promise.reject(new Error("down")) }));
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("leads_board", { op: "hide", key: "st_aaaaaaaa000040008000000000000001" }, null)).toEqual({ ok: false, error: "Couldn't read this view's saved columns, so nothing was changed. Refresh to try again." });
    expect(h.inserts).toEqual([]);
  });
});
