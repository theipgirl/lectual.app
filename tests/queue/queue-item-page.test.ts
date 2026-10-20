import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { QueueItem } from "@/lib/queue/api";

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    org_id: "org-1",
    matter_id: null,
    agent: "post-consult",
    type: "CLIENT_EMAIL",
    headline: "Follow up with Ana",
    summary: null,
    draft_body: "**Approved** text",
    final_body: null,
    status: "approved",
    created_at: "2026-10-01T12:00:00Z",
    client_name: "Ana Ruiz",
    recipient: "ana@example.com",
    subject: "Next steps",
    proposed_send_at: null,
    attachments: null,
    resolved_by: "rebecca@example.com",
    resolved_at: "2026-10-01T13:00:00Z",
    resolution_note: null,
    ...overrides,
  };
}

async function render(row: QueueItem, roles: { approve: boolean; edit: boolean } = { approve: true, edit: true }) {
  vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => row) }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "rpb") }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  // The page asks for the approve role first and the edit role second.
  let call = 0;
  vi.doMock("@/lib/queue/roles", () => ({
    QUEUE_APPROVE_ROLES: ["owner"],
    QUEUE_EDIT_ROLES: ["owner"],
    resolveQueueRole: vi.fn(async () => ((call++ === 0 ? roles.approve : roles.edit) ? "owner" : null)),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })) }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ loadLinkedPanel: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/app/dashboard/queue/actions", () => ({ reviewQueueAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/queue/[id]/page");
  const element = await Page({ params: Promise.resolve({ id: row.id }), searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(createElement("div", null, element));
}

describe("queue item page renders Markdown (F8)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows a resolved body as formatted text", async () => {
    const html = await render(item());
    expect(html).toContain("<strong>Approved</strong>");
    expect(html).not.toContain("**Approved**");
    expect(html).not.toContain("<textarea");
  });

  it("shows the final body, not the original, once edited", async () => {
    const html = await render(item({ final_body: "# Final\n\n- one\n- two" }));
    expect(html).toContain("<h1>Final</h1>");
    expect(html).toContain("Final, as approved");
  });

  it("gives a pending item a labelled Preview with rendered Markdown, and keeps the textarea", async () => {
    const body = "Hi **Ana**,\n\n| Service | Fee |\n|---|---|\n| Filing | $850 |\n\n## Next steps";
    const html = await render(item({ status: "pending", draft_body: body, resolved_by: null, resolved_at: null }));
    const region = html.slice(html.indexOf('aria-labelledby="draft-preview-label"'), html.indexOf("<label"));
    expect(region).toContain(">Preview<");
    expect(region).toContain("<strong>Ana</strong>");
    expect(region).toContain("<table>");
    expect(region).toContain("<h2>Next steps</h2>");
    expect(html).toContain("<textarea");
    // The editable source keeps the raw text.
    expect(html).toContain("Hi **Ana**,");
    expect(html).toContain('class="lx-input lx-draft"');
  });

  it("keeps Approve, Save edit and Reject for an approver", async () => {
    const html = await render(item({ status: "pending", resolved_by: null, resolved_at: null }));
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Save edit</button>");
    expect(html).toContain(">Reject</button>");
  });

  it("behaves as before for a read-only role: preview and a read-only textarea, no buttons", async () => {
    const html = await render(item({ status: "pending", resolved_by: null, resolved_at: null }), { approve: false, edit: false });
    expect(html).toContain("Your role is read-only for the approval queue.");
    expect(html).toContain("readOnly");
    expect(html).not.toContain(">Approve</button>");
    expect(html).not.toContain(">Save edit</button>");
    expect(html).not.toContain(">Reject</button>");
    expect(html).toContain(">Preview<");
  });
});

describe("ReviewPanel preview follows the textarea (F8)", () => {
  it("derives the Preview from the body state", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/queue/ReviewPanel.tsx", "utf8");
    expect(src).toContain("<Markdown text={body} />");
    expect(src).toContain("onChange={(e) => setBody(e.target.value)}");
    expect(src).toContain("className=\"lx-input lx-draft\"");
  });
});
