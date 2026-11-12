import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ dealtAt: vi.fn(), meta: {} as Record<string, unknown> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => ({ kind: "ok", role: "owner", user: { id: "u1", email: "o@firm.test", user_metadata: h.meta } }),
}));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: async () => ({ status: "ok", items: [] }) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: async () => ({ status: "ok", routing: {}, members: [] }) }));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: async () => ({ status: "ok", events: [] }) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));
vi.mock("@/lib/deal/times", async (orig) => {
  const actual = await orig<typeof import("@/lib/deal/times")>();
  return {
    ...actual,
    dealtAt: (...a: Parameters<typeof actual.dealtAt>) => {
      h.dealtAt(...a);
      return actual.dealtAt(...a);
    },
  };
});

describe("the lists view deals by the person's own times", () => {
  beforeEach(() => h.dealtAt.mockReset());

  it("passes the person's saved times to dealtAt", async () => {
    h.meta = { lectual_deal_times: { v: 1, times: ["09:00", "15:30"] } };
    const { DeckListsView } = await import("@/app/dashboard/queue/deck/lists-view");
    await DeckListsView({ list: "decided" });
    expect(h.dealtAt).toHaveBeenCalledTimes(1);
    expect(h.dealtAt.mock.calls[0][2]).toEqual(["09:00", "15:30"]);
  });

  it("with no saved times it uses the defaults (as the deck does)", async () => {
    h.meta = {};
    const { DeckListsView } = await import("@/app/dashboard/queue/deck/lists-view");
    await DeckListsView({ list: "later" });
    expect(h.dealtAt.mock.calls[0][2]).toEqual(["07:00", "14:00"]);
  });
});
