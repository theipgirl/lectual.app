import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MEMBERS, U, qitem } from "../queue/routing-fixtures";

/**
 * View as: the Approvals pages decide "who is looking" from the VIEWER (loadQueueViewContext over resolveViewSession), so
 * Mine, the deck, Handed to you and Ready to draft are computed for the teammate with the very functions their own session
 * runs, on the same inputs.
 */
const teammate = { userId: U.caitlyn, role: "paralegal" as const };
vi.mock("@/lib/views/view-as", () => ({
  resolveViewSession: async () => ({ kind: "ok", user: { id: teammate.userId, user_metadata: {} }, role: teammate.role, member: { role: teammate.role, org_id: "o1" }, org: { id: "o1" } }),
}));
const routing = { follow_up: U.caitlyn } as Record<string, string>;
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: async () => ({ status: "ok", routing, members: MEMBERS, dropped: 0, drafter: U.caitlyn }) }));

import { loadQueueViewContext } from "@/lib/queue/view-context";
import { mineItems } from "@/lib/queue/mine";

describe("the Approvals view context while previewing", () => {
  it("the viewer is the teammate", async () => {
    const view = await loadQueueViewContext();
    expect(view.viewer).toEqual(teammate);
    expect(view.drafter).toBe(U.caitlyn);
  });

  it("Mine equals what the teammate's own session computes, and differs from the owner's", async () => {
    const view = await loadQueueViewContext();
    const items = [qitem({ id: "a", agent: "morning-brief", headline: "Follow-up for a stalled lead: Bo" }), qitem({ id: "b" })];
    const asTeammate = mineItems(items, view.routing, view.viewer).map((i) => i.id);
    expect(asTeammate).toEqual(mineItems(items, view.routing, teammate).map((i) => i.id));
    expect(asTeammate).not.toEqual(mineItems(items, view.routing, { userId: U.taylor, role: "owner" }).map((i) => i.id));
  });

  it("the list, the item page and the deck take 'who is looking' from the viewer, never the session", () => {
    const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
    expect(read("src/app/dashboard/queue/page.tsx")).toMatch(/loadQueueViewContext\(\)/);
    expect(read("src/app/dashboard/queue/[id]/page.tsx")).toMatch(/loadQueueViewContext\(\)/);
    expect(read("src/app/dashboard/queue/[id]/page.tsx")).toMatch(/viewerQueueRole\(QUEUE_EDIT_ROLES\)/);
    const deck = read("src/app/dashboard/queue/deck/deck-view.tsx");
    expect(deck).toMatch(/resolveViewSession\(/);
    expect(deck).toMatch(/const viewer = \{ userId: session\.user\.id, role: session\.role \};/);
    expect(deck).toMatch(/loadReadyToDraft\(\{ viewerId: viewer\.userId/);
    expect(read("src/lib/queue/view-context.ts")).not.toMatch(/resolveFirmSession/);
  });
});
