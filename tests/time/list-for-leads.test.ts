import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[][], fail: false }));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => ({
          gte: () => ({
            order: () => {
              state.calls.push(ids);
              return Promise.resolve(
                state.fail && state.calls.length === 2
                  ? { data: null, error: { code: "x" } }
                  : { data: ids.map((id, i) => ({ id: `e-${id}`, lead_id: id, started_at: `2026-11-0${(i % 9) + 1}T00:00:00Z` })), error: null },
              );
            },
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
vi.mock("@/lib/matters", () => ({ logActivitySafe: vi.fn() }));

const { listForLeads, LEAD_ID_CHUNK } = await import("@/lib/time/entries");

beforeEach(() => {
  state.calls = [];
  state.fail = false;
});

describe("listForLeads", () => {
  const ids = Array.from({ length: 310 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

  it("asks in chunks of at most 80 ids and returns every entry, newest first", async () => {
    const out = await listForLeads(ids, "2026-11-02T00:00:00Z");
    expect(state.calls.map((c) => c.length)).toEqual([80, 80, 80, 70]);
    expect(Math.max(...state.calls.map((c) => c.length))).toBeLessThanOrEqual(LEAD_ID_CHUNK);
    expect(out).toHaveLength(310);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].started_at >= out[i].started_at).toBe(true);
  });

  it("de-duplicates ids, reads nothing for none, and a failing chunk fails the whole read (never a partial week)", async () => {
    await listForLeads([ids[0], ids[0], ""], "2026-11-02T00:00:00Z");
    expect(state.calls).toEqual([[ids[0]]]);
    state.calls = [];
    expect(await listForLeads([], "2026-11-02T00:00:00Z")).toEqual([]);
    expect(state.calls).toEqual([]);
    state.fail = true;
    await expect(listForLeads(ids, "2026-11-02T00:00:00Z")).rejects.toBeTruthy();
  });
});
