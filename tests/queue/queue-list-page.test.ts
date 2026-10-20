import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueueItem } from "@/lib/queue/api";
import type { QueueLoad } from "@/lib/queue/load";

// next.config.ts sets trailingSlash: true, which <Link> reads from this variable.
process.env.__NEXT_TRAILING_SLASH = "true";

const BODY = "Hi Ana,\n\nThanks for the call today. We will file the application on Monday and send you the receipt as soon as we have it.\n\nBest,\nRebecca";

function item(id: string, minute: number, over: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    org_id: "org-1",
    matter_id: null,
    agent: "post-consult",
    type: "CLIENT_EMAIL",
    headline: `Draft ${id}`,
    summary: null,
    draft_body: BODY,
    final_body: null,
    status: "pending",
    created_at: new Date(Date.parse("2026-10-20T12:00:00Z") + minute * 60_000).toISOString(),
    client_name: "Ana Ruiz",
    recipient: "ana@example.com",
    subject: "Next steps",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

async function render(load: QueueLoad, status = "pending") {
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => load) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  const { default: Page } = await import("../../src/app/dashboard/queue/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ status }) }));
}

/** The table row of one item, so a pill on a neighbour can't satisfy an assertion. */
const row = (html: string, id: string) => {
  const at = html.indexOf(`/dashboard/queue/${id}/`);
  return html.slice(html.lastIndexOf("<tr", at), html.indexOf("</tr>", at));
};

describe("queue list: Possible duplicate (H10)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("two pending near-duplicates: the pill is on the newer one only", async () => {
    const html = await render({ status: "ok", items: [item("new", 4), item("old", 0)] });
    expect(row(html, "new")).toContain("Possible duplicate");
    expect(row(html, "new")).toContain("lx-pill");
    expect(row(html, "old")).not.toContain("Possible duplicate");
    expect(html.match(/Possible duplicate/g)).toHaveLength(1);
  });

  it("two unrelated items: no pill", async () => {
    const other = item("b", 2, { recipient: "bo@example.com", client_name: "Bo", draft_body: "Something else entirely, about a different matter." });
    expect(await render({ status: "ok", items: [item("a", 0), other] })).not.toContain("Possible duplicate");
  });

  it("three near-identical items: the two newer ones are marked", async () => {
    const html = await render({ status: "ok", items: [item("c", 10), item("b", 5), item("a", 0)] });
    expect(row(html, "a")).not.toContain("Possible duplicate");
    expect(row(html, "b")).toContain("Possible duplicate");
    expect(row(html, "c")).toContain("Possible duplicate");
  });

  it("no pill on the Approved and Rejected tabs", async () => {
    for (const status of ["approved", "rejected"] as const) {
      vi.resetModules();
      const items = [item("new", 4, { status }), item("old", 0, { status })];
      expect(await render({ status: "ok", items }, status)).not.toContain("Possible duplicate");
    }
  });

  it("an unavailable or unconfigured queue keeps its own notice and shows no pill", async () => {
    for (const load of [{ status: "unavailable", items: [] }, { status: "unconfigured", reason: "org-key", items: [] }] as QueueLoad[]) {
      vi.resetModules();
      const html = await render(load);
      expect(html).not.toContain("Possible duplicate");
      expect(html).not.toContain("All caught up");
    }
  });

  it("an empty pending queue still says all caught up", async () => {
    expect(await render({ status: "ok", items: [] })).toContain("All caught up");
  });
});
