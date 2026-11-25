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
    expect(await layoutStore(r.client).insert("review_list", "org-1", COLS)).toEqual({ error: null });
    expect(r.chains).toEqual([[["from", "crm_view_layout"], ["insert", { org_id: "org-1", view_key: "review_list", columns: COLS }]]]);
  });
  it("update names columns alone, fenced on the view and the rev read, and answers the new rev", async () => {
    const r = recorder({ data: [{ rev: 4 }] });
    expect(await layoutStore(r.client).update("review_list", COLS, 3)).toEqual({ error: null, rev: 4 });
    expect(r.chains).toEqual([[["from", "crm_view_layout"], ["update", { columns: COLS }], ["eq", "view_key", "review_list"], ["eq", "rev", 3], ["select", "rev"]]]);
  });
  it("update that matched no row answers rev null (the caller says someone else changed it); an error is passed on as it came", async () => {
    expect(await layoutStore(recorder({ data: [] }).client).update("review_list", COLS, 3)).toEqual({ error: null, rev: null });
    const err = { code: "42501" };
    expect(await layoutStore(recorder({ error: err }).client).update("review_list", COLS, 3)).toEqual({ error: err });
    expect(await layoutStore(recorder({ error: err }).client).insert("review_list", "o", COLS)).toEqual({ error: err });
  });
});

describe("the layout actions' source", () => {
  const src = readFileSync("src/lib/views/layout/actions.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("is a use-server file whose every export is wrapped in previewSafe, and uses the scoped client only", () => {
    expect(src).toMatch(/^"use server"/);
    expect([...src.matchAll(/export const (\w+) = previewSafe\(/g)].map((m) => m[1]).sort()).toEqual(["addColumnAction", "changeLayoutAction"]);
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
    expect(await changeLayoutAction("review_list", { op: "hide", key: "mark" }, null)).toEqual({ ok: false, error: "Only an owner can change this view." });
    expect(h.inserts).toEqual([]);
  });
  it("the first change writes an insert with the session's org; the Board's base is every member's lane", async () => {
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("review_list", { op: "hide", key: "mark" }, null)).toEqual({ ok: true, rev: 1 });
    const [view, org, cols] = h.inserts[0] as [string, string, { key: string; hidden: boolean }[]];
    expect([view, org]).toEqual(["review_list", "org-1"]);
    expect(cols.find((c) => c.key === "mark")!.hidden).toBe(true);
    h.inserts = [];
    expect(await changeLayoutAction("review_board", { op: "rename", key: "unassigned", label: "Nobody yet" }, null)).toEqual({ ok: true, rev: 1 });
    const board = (h.inserts[0] as [string, string, { key: string; label: string | null }[]])[2];
    expect(board.map((c) => c.key)).toEqual(["u11111111111141118111111111111111", "unassigned"]);
    expect(board[1].label).toBe("Nobody yet");
  });
  it("a view with no columns to change yet answers a sentence, writes nothing", async () => {
    const { changeLayoutAction } = await import("@/lib/views/layout/actions");
    expect(await changeLayoutAction("matters_list", { op: "hide", key: "x" }, null)).toEqual({ ok: false, error: "Couldn't read this view's saved columns, so nothing was changed. Refresh to try again." });
    expect(h.inserts).toEqual([]);
  });
});
