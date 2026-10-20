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

const SIGN = "Rebecca P. Beliard, Esq.";
const AUDIT = { signOff: SIGN, teamSignOff: "The RPB Law Team", memberNames: ["Rebecca Beliard", "Dawn Alvarez"] };

async function render(
  row: QueueItem,
  roles: { approve: boolean; edit: boolean } = { approve: true, edit: true },
  audit: { signOff: string | null; teamSignOff: string | null; memberNames: string[] | null } = AUDIT,
) {
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
  vi.doMock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => audit) }));
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

describe("queue item page: draft hygiene warnings (H8)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const pending = (body: string, over: Partial<QueueItem> = {}) =>
    item({ status: "pending", draft_body: body, resolved_by: null, resolved_at: null, ...over });
  const DIRTY = `⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.\nHi Ana,\nHard Rule 2: no fees.\n\nBest,\n${SIGN}`;
  const CLEAN = `Hi Ana,\n\nThanks for the call.\n\nBest,\n${SIGN}`;

  it("a dirty pending client email shows the warnings and the Remove internal notes button, with the Preview and textarea", async () => {
    const html = await render(pending(DIRTY));
    expect(html).toContain("Fix this before approving");
    expect(html).toContain("banner line");
    expect(html).toContain("internal worksheet text");
    expect(html).toContain("Remove internal notes");
    expect(html).toContain(">Preview<");
    expect(html).toContain("<textarea");
  });

  it("a clean body shows neither the warnings nor the button", async () => {
    const html = await render(pending(CLEAN));
    expect(html).not.toContain("Checks on this draft");
    expect(html).not.toContain("Remove internal notes");
  });

  it("a viewer who can't edit sees the warnings but not the button", async () => {
    const html = await render(pending(DIRTY), { approve: false, edit: false });
    expect(html).toContain("Fix this before approving");
    expect(html).not.toContain("Remove internal notes");
  });

  it("a resolved item shows no warnings and no button", async () => {
    const html = await render(item({ draft_body: DIRTY }));
    expect(html).not.toContain("Checks on this draft");
    expect(html).not.toContain("Remove internal notes");
  });

  it("says so, as a warning, when the signer check could not run", async () => {
    const html = await render(pending("Hi Ana,\n\nBest,\nDawn"), { approve: true, edit: true }, { ...AUDIT, memberNames: null });
    expect(html).toContain("couldn&#x27;t check who signed this");
    expect(html).toContain("Check this draft");
    expect(html).not.toContain("Fix this before approving");
  });

  it("a body signed by another member is a blocking error naming them", async () => {
    const html = await render(pending("Hi Ana,\n\nBest,\nDawn Alvarez"));
    expect(html).toContain("Fix this before approving");
    expect(html).toContain("signed by Dawn Alvarez");
  });

  it("Markdown marks in a client email are a warning, not a block", async () => {
    const html = await render(pending(`Hi **Ana**,\n\nBest,\n${SIGN}`));
    expect(html).toContain("Check this draft");
    expect(html).not.toContain("Fix this before approving");
    expect(html).toContain("formatting marks");
    expect(html).not.toContain("Remove internal notes");
  });

  it("a Document Center letter with a fill-in shows a warning only, and no placeholder button", async () => {
    const html = await render(pending("# Letter DRAFT\n\nClass(es): [confirm from the report]", { type: "OPINION_LETTER" }));
    expect(html).toContain("Check this draft");
    expect(html).not.toContain("Fix this before approving");
    expect(html).not.toContain("Remove internal notes");
  });
});

describe("ReviewPanel: Remove internal notes (H8)", () => {
  it("replaces the text with the cleaned body, which makes it an edit", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/queue/ReviewPanel.tsx", "utf8");
    // The button writes the cleaned text into the same state the textarea reads...
    expect(src).toContain("onClick={() => setBody(cleaned.body)}");
    expect(src).toContain("const cleaned = audit ? removeInternalNotes(body, audit.type) : null;");
    // ...and any difference from the saved text is an edit: the approve label and the posted field follow it.
    expect(src).toContain("const dirty = body !== initialBody;");
    expect(src).toContain('{pending ? "Working…" : dirty ? "Approve with edits" : "Approve"}');
    expect(src).toContain('name={dirty ? "body" : undefined}');
    // The browser bundle only gets the pure module.
    expect(src).toContain('from "@/lib/queue/hygiene"');
    expect(src).not.toMatch(/@\/lib\/queue\/audit-context|server-only/);
  });

  it("the cleaned text differs from a dirty draft, so the label becomes 'Approve with edits'", async () => {
    const { removeInternalNotes } = await import("@/lib/queue/hygiene");
    const dirty = "NOT SENT\nHi Ana,\n\nBest,\nRebecca";
    const cleaned = removeInternalNotes(dirty, "CLIENT_EMAIL");
    expect(cleaned.body).not.toBe(dirty);
    expect(cleaned.moved).toHaveLength(1);
  });
});
