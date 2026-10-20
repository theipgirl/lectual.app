import { describe, it, expect, vi, beforeEach } from "vitest";

/** A scoped-client stand-in for crm_notification: filters on read_at, orders newest first, honours range(). */
type Row = { id: string; read_at: string | null; created_at: string };
const calls: Array<{ unreadOnly: boolean; from: number; to: number }> = [];
let table: Row[] = [];
let failWith: string | null = null;

function query() {
  const state = { unreadOnly: false, from: 0, to: Infinity };
  const builder: Record<string, unknown> = {
    select: () => builder,
    is: () => {
      state.unreadOnly = true;
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      state.from = from;
      state.to = to;
      calls.push({ ...state });
      return builder;
    },
    then: (resolve: (v: unknown) => void) => {
      if (failWith) return resolve({ data: null, error: new Error(failWith) });
      const sorted = [...table].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const rows = sorted.filter((r) => !state.unreadOnly || r.read_at === null).slice(state.from, state.to + 1);
      return resolve({ data: rows, error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ from: () => query() }) }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn() }));

const mk = (n: number, read: boolean): Row => ({
  id: `n${n}`,
  read_at: read ? "2026-10-20T00:00:00Z" : null,
  created_at: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(),
});

beforeEach(() => {
  calls.length = 0;
  failWith = null;
  table = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("listMinePage (F4 paging)", () => {
  it("asks for one row more than the page so a 51st row means a next page", async () => {
    const { listMinePage, PAGE_SIZE } = await import("@/lib/notifications/core");
    expect(PAGE_SIZE).toBe(50);
    table = Array.from({ length: 51 }, (_, i) => mk(i, false));
    const page = await listMinePage();
    expect(calls[0]).toMatchObject({ from: 0, to: 50 });
    expect(page.rows).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });

  it("has no next page at exactly 50 rows, and pages by offset", async () => {
    const { listMinePage } = await import("@/lib/notifications/core");
    table = Array.from({ length: 50 }, (_, i) => mk(i, false));
    expect((await listMinePage()).hasMore).toBe(false);
    table = Array.from({ length: 70 }, (_, i) => mk(i, false));
    const second = await listMinePage({ offset: 50 });
    expect(calls.at(-1)).toMatchObject({ from: 50, to: 100 });
    expect(second.rows).toHaveLength(20);
    expect(second.hasMore).toBe(false);
  });

  it("filters to read_at null for the Unread tab", async () => {
    const { listMinePage } = await import("@/lib/notifications/core");
    table = [mk(1, true), mk(2, false), mk(3, false)];
    const page = await listMinePage({ unreadOnly: true });
    expect(page.rows.map((r) => r.id).sort()).toEqual(["n2", "n3"]);
  });

  it("throws on a failed read instead of returning an empty page", async () => {
    const { listMinePage } = await import("@/lib/notifications/core");
    failWith = "permission denied";
    await expect(listMinePage()).rejects.toThrow("permission denied");
  });
});

describe("loadBell list (F3 panel)", () => {
  it("shows at most 10 rows, unread first then read", async () => {
    const { loadBell } = await import("@/lib/notifications/core");
    table = [
      ...Array.from({ length: 3 }, (_, i) => mk(100 + i, false)),
      ...Array.from({ length: 20 }, (_, i) => mk(200 + i, true)),
    ];
    const bell = await loadBell();
    expect(bell.list.status).toBe("ok");
    if (bell.list.status !== "ok") return;
    expect(bell.list.data).toHaveLength(10);
    expect(bell.list.data.slice(0, 3).every((r) => r.read_at === null)).toBe(true);
    expect(bell.list.data.slice(3).every((r) => r.read_at !== null)).toBe(true);
  });

  it("is unavailable, not empty and not 0, when the read fails", async () => {
    const { loadBell } = await import("@/lib/notifications/core");
    failWith = "boom";
    const bell = await loadBell();
    expect(bell.list).toEqual({ status: "unavailable" });
  });
});
