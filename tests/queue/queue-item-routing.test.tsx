import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

async function render(row: ReturnType<typeof qitem>, viewer: { userId: string; role: string }, routing: object) {
  vi.resetModules();
  vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => row) }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "rpb") }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/queue/roles", async (orig) => ({ ...(await orig<object>()), resolveQueueRole: vi.fn(async (_s: unknown, allowed: string[]) => (allowed.includes(viewer.role) ? viewer.role : null)) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })) }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ loadLinkedPanel: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: null, teamSignOff: null, memberNames: [] })) }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));
  vi.doMock("@/lib/queue/view-context", () => ({ loadQueueViewContext: vi.fn(async () => ({ viewer, routing, members: MEMBERS, routingFailed: false, dropped: 0 })) }));
  const { default: Page } = await import("../../src/app/dashboard/queue/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: row.id }), searchParams: Promise.resolve({}) })));
}

beforeEach(() => vi.resetModules());

describe("queue item page: owner line and controls", () => {
  const routing = { stalled_followup: U.caitlyn };

  it("shows kind and owner, and the controls for the owner", async () => {
    const html = await render(followup(), { userId: U.caitlyn, role: "paralegal" }, routing);
    expect(html).toContain("Follow-up for a stalled lead · For Caitlyn");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
    expect(html).not.toContain("data-queue-refusal");
  });

  it("hides Approve and Reject, and gives the same sentence the action would, for a caller the rule refuses", async () => {
    const html = await render(followup(), { userId: U.rebecca, role: "attorney" }, routing);
    expect(html).toContain("This one is for Caitlyn. Ask them to approve it, or an owner or admin.");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain(">Reject<");
  });

  it("a paralegal on an attorney-only item sees the attorney sentence", async () => {
    const html = await render(qitem(), { userId: U.caitlyn, role: "paralegal" }, { post_consult_email: U.caitlyn });
    expect(html).toContain("Only an attorney can approve this kind of message.");
    expect(html).not.toContain(">Approve<");
  });
});
