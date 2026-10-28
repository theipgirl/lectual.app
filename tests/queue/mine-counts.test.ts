import { describe, it, expect, vi, beforeEach } from "vitest";
import { mineItems } from "@/lib/queue/mine";
import { followup, qitem, U } from "./routing-fixtures";
import { railCountFor } from "@/lib/nav";

const items = [followup({ id: "f1" }), followup({ id: "f2" }), qitem({ id: "p1" })];
const routing = { stalled_followup: U.caitlyn };

describe("mineItems: what Today and the rail count", () => {
  it("a routed non-approver counts what is routed to them, and an unrouted one has nothing of their own", () => {
    const caitlyn = { userId: U.caitlyn, role: "paralegal" as const };
    expect(mineItems(items, routing, caitlyn).map((i) => i.id)).toEqual(["f1", "f2"]);
    expect(mineItems(items, {}, caitlyn)).toHaveLength(0);
  });

  it("an approver who owns the follow-ups sees them; the others see the rest", () => {
    expect(mineItems(items, { stalled_followup: U.rebecca }, { userId: U.rebecca, role: "attorney" })).toHaveLength(3);
    expect(mineItems(items, routing, { userId: U.rebecca, role: "attorney" }).map((i) => i.id)).toEqual(["p1"]);
  });

  it("with no routing a default approver counts everything (today's number)", () => {
    expect(mineItems(items, {}, { userId: U.rebecca, role: "attorney" })).toHaveLength(3);
  });

  it("a viewer, who holds no work, keeps today's number, not zero", () => {
    expect(mineItems(items, routing, { userId: U.viewer, role: "viewer" })).toHaveLength(3);
  });

  it("a routing read that failed (null) counts every pending item, never zero", () => {
    expect(mineItems(items, null, { userId: U.rebecca, role: "attorney" })).toHaveLength(3);
  });
});

describe("mineQueue keeps the three queue states", () => {
  beforeEach(() => vi.resetModules());

  async function run(load: unknown, routed: unknown) {
    vi.resetModules();
    vi.doMock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => routed) }));
    const { mineQueue } = await import("@/lib/queue/mine-load");
    return mineQueue(load as never, { userId: U.rebecca, role: "attorney" });
  }

  it("unavailable and unconfigured pass through untouched (no number invented)", async () => {
    expect(await run({ status: "unavailable", items: [] }, { status: "ok", routing: {}, members: [] })).toEqual({ status: "unavailable", items: [] });
    expect((await run({ status: "unconfigured", reason: "org-key", items: [] }, { status: "failed" })).status).toBe("unconfigured");
  });

  it("ok narrows to mine; a failed routing read falls back to all", async () => {
    const load = { status: "ok", items };
    expect((await run(load, { status: "ok", routing, members: [] })).items.map((i) => i.id)).toEqual(["p1"]);
    expect((await run(load, { status: "failed" })).items).toHaveLength(3);
  });

  it("the rail badge still shows '!' for unavailable and nothing for unconfigured", async () => {
    const un = await run({ status: "unavailable", items: [] }, { status: "failed" });
    expect(railCountFor("queue", un.status as "unavailable", 0, {})).toBe("!");
    const ok = await run({ status: "ok", items }, { status: "ok", routing, members: [] });
    expect(railCountFor("queue", "ok", ok.items.length, {})).toBe("1");
  });
});
