import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ inserts: [] as unknown[], dirCalls: 0, orgCalls: 0, self: "u-1", members: ["u-1"] }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: s.self } } }) },
    rpc: vi.fn(async () => {
      s.orgCalls += 1;
      return { data: "org-1", error: null };
    }),
    from: () => ({ insert: async (rows: unknown) => (s.inserts.push(rows), { error: null }) }),
  })),
}));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: vi.fn(async () => {
    s.dirCalls += 1;
    return s.members.map((userId) => ({ userId }));
  }),
}));
const { notifyOwnMany } = await import("@/lib/notifications/core");

beforeEach(() => {
  s.inserts = [];
  s.dirCalls = 0;
  s.orgCalls = 0;
  s.self = "u-1";
  s.members = ["u-1"];
});

describe("notifyOwnMany (review item 3): one directory read, one org read, ONE insert, self only", () => {
  it("writes every notice in one statement", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ kind: "mentioned" as const, matterId: `m${i}`, payload: { source: "deadline_window" } }));
    expect(await notifyOwnMany("u-1", items)).toBe(5);
    expect(s.inserts).toHaveLength(1);
    expect((s.inserts[0] as unknown[]).length).toBe(5);
    expect(s.dirCalls).toBe(1);
    expect(s.orgCalls).toBe(1);
    expect((s.inserts[0] as Array<{ user_id: string; org_id: string; actor_id: null }>).every((r) => r.user_id === "u-1" && r.org_id === "org-1" && r.actor_id === null)).toBe(true);
  });

  it("refuses anyone but the signed-in person, and a non-member", async () => {
    expect(await notifyOwnMany("u-2", [{ kind: "mentioned" }])).toBe(0);
    s.members = [];
    expect(await notifyOwnMany("u-1", [{ kind: "mentioned" }])).toBe(0);
    expect(s.inserts).toEqual([]);
  });
});
