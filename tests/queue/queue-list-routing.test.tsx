import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueueLoad } from "@/lib/queue/load";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

process.env.__NEXT_TRAILING_SLASH = "true";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const old = new Date(NOW - 9 * 86_400_000).toISOString();
const items = [followup({ id: "f1", created_at: old }), followup({ id: "f2", created_at: old, headline: "Follow-up for a stalled lead: Cy" }), qitem({ id: "p1" })];

async function render(load: QueueLoad, view: Partial<{ viewer: unknown; routing: object; members: unknown; routingFailed: boolean }> = {}, params: { status?: string; who?: string } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => load) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ dismissStaleFollowupsAction: vi.fn() }));
  vi.doMock("@/lib/queue/view-context", () => ({
    loadQueueViewContext: vi.fn(async () => ({ viewer: { userId: U.rebecca, role: "attorney" }, routing: {}, members: MEMBERS, routingFailed: false, dropped: 0, now: NOW, ...view })),
  }));
  const { default: Page } = await import("../../src/app/dashboard/queue/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}
const rows = (html: string) => [...html.matchAll(/\/dashboard\/queue\/(f1|f2|p1)\//g)].map((m) => m[1]);
const ok = (i = items): QueueLoad => ({ status: "ok", items: i });

beforeEach(() => vi.setSystemTime(NOW));

describe("Approvals page: person switch", () => {
  it("defaults to Mine and shows the counts", async () => {
    const html = await render(ok(), { routing: { stalled_followup: U.caitlyn } });
    expect(html).toContain("Mine (1)");
    expect(html).toContain("Caitlyn (2)");
    expect(html).toContain("Taylor (1)");
    expect(html).toContain("Everyone (3)");
    expect(rows(html)).toEqual(["p1"]);
  });

  it("?who=<id> and all filter, and the links keep the status tab", async () => {
    const routing = { stalled_followup: U.caitlyn };
    expect(rows(await render(ok(), { routing }, { who: U.caitlyn }))).toEqual(["f1", "f2"]);
    const all = await render(ok(), { routing }, { who: "all" });
    expect(rows(all)).toEqual(["f1", "f2", "p1"]);
    expect(all).toContain("status=pending&amp;who=me");
    expect(all).toMatch(/aria-current="page"[^>]*>Everyone \(3\)/);
  });

  it("unrouted items sit under the usual approvers", async () => {
    const html = await render(ok(), {}, {});
    expect(html).toContain("Mine (3)");
    expect(html).toContain("Taylor (3)");
  });

  it("rows show the kind and the owner", async () => {
    const html = await render(ok(), { routing: { stalled_followup: U.caitlyn } }, { who: "all" });
    expect(html).toContain("Follow-up for a stalled lead · For Caitlyn");
    expect(html).toContain("Post-consult and proposal emails · For the usual approvers");
  });

  it("an unknown who falls back to Mine; a viewer starts on Everyone with no Mine pill", async () => {
    expect(rows(await render(ok(), { routing: { stalled_followup: U.caitlyn } }, { who: "bogus" }))).toEqual(["p1"]);
    const viewer = await render(ok(), { viewer: { userId: U.viewer, role: "viewer" } });
    expect(viewer).not.toContain("Mine (");
    expect(rows(viewer)).toEqual(["f1", "f2", "p1"]);
  });

  it("an empty Mine explains how many are waiting on others, not 'All caught up'", async () => {
    const html = await render(ok([items[0], items[1]]), { routing: { stalled_followup: U.caitlyn } });
    expect(html).toContain("Nothing is waiting on you. 2 are waiting on others.");
    expect(html).toContain("who=all");
    expect(html).not.toContain("All caught up");
  });

  it("a genuinely empty queue still says all caught up", async () => {
    expect(await render(ok([]))).toContain("All caught up");
  });

  it("an unavailable or unconfigured queue renders its own state: no counts, no switch", async () => {
    for (const status of ["unavailable", "unconfigured"] as const) {
      const html = await render({ status, items: [], ...(status === "unconfigured" ? { reason: "org-key" as const } : {}) });
      expect(html).not.toContain("Mine (");
      expect(html).not.toContain("Everyone (");
      expect(html).not.toContain("All caught up");
      expect(html).not.toContain("data-queue-who");
    }
  });

  it("a routing read that failed says so and shows everything to the usual approvers", async () => {
    const html = await render(ok(), { routing: {}, members: null, routingFailed: true });
    expect(html).toContain("Assignments couldn&#x27;t be loaded. Showing everything to the usual approvers.");
    expect(rows(html)).toEqual(["f1", "f2", "p1"]);
  });
});

describe("Approvals page: dismiss follow-ups", () => {
  it("is drawn on the pending tab for an owner when stale follow-ups exist", async () => {
    const html = await render(ok(), {}, {});
    expect(html).toContain("Dismiss follow-ups older than 7 days");
  });

  it("is not drawn for a non-owner, on other tabs, or when nothing is stale", async () => {
    expect(await render(ok(), { routing: { stalled_followup: U.caitlyn } })).not.toContain("Dismiss follow-ups");
    expect(await render(ok([items[2]]))).not.toContain("Dismiss follow-ups");
    expect(await render(ok(items.map((i) => ({ ...i, status: "approved" as const }))), {}, { status: "approved" })).not.toContain("Dismiss follow-ups");
  });
});
