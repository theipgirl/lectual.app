import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalRow, ProposalEventRow } from "@/lib/proposals/types";
import { LinkedProposalPanel } from "@/components/queue/LinkedProposalPanel";
import { buildProposalCard } from "@/lib/proposals/card";
import type { LinkedPanel } from "@/lib/consult-proposal/link";
import { sevetri } from "./fixture";

/**
 * D3/D4: the approver sees the proposal card above the editor, the consult strip
 * when the proposal has a lead (and neither strip nor a made-up one without), and
 * the card inside the queue item's linked-proposal panel.
 */

const ID = "44444444-4444-4444-8444-444444444444";

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: ID,
    org_id: "o",
    family_id: ID,
    version: 1,
    public_token: "t".repeat(43),
    lead_id: "lead-9",
    matter_id: null,
    client_name: "Sevetri Wilson",
    client_email: "s@example.com",
    title: "Trademark Proposal",
    status: "draft",
    content: sevetri(),
    expires_on: "2026-11-10",
    pay_url: "https://pay.example/x",
    source: "agent",
    created_by: null,
    updated_by: null,
    approved_by: null,
    approved_at: null,
    sent_at: null,
    accepted_at: null,
    superseded_at: null,
    withdrawn_at: null,
    accepted_selection: null,
    accepted_snapshot: null,
    created_at: "2026-10-18T12:00:00Z",
    updated_at: "2026-10-18T12:00:00Z",
    ...over,
  };
}

const EVIDENCE: ProposalEventRow = {
  id: "e1",
  org_id: "o",
  proposal_id: ID,
  family_id: ID,
  type: "edited",
  actor: "agent",
  actor_user_id: null,
  payload: { source: "consult-proposal", evidence: [{ path: "p", quote: "a word mark and a logo", verified: true }], notes: "" },
  created_at: "2026-10-18T12:01:00Z",
};

type Extra = {
  role?: string;
  /** The version's step events (Sprint 19); "fail" = the read fails. */
  steps?: Array<Record<string, unknown>> | "fail";
  members?: unknown[];
};

async function render(proposal: ProposalRow, events: ProposalEventRow[], strip: unknown = { status: "none" }, extra: Extra = {}) {
  const stub = (name: string) => {
    const Stub = () => createElement("div", { "data-stub": name });
    Stub.displayName = `Stub(${name})`;
    return Stub;
  };
  const loadStrip = vi.fn(async () => strip);
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: extra.role ?? "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => extra.members ?? []) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events })),
    getProposalSettings: vi.fn(async () => null),
    isCurrentUserApprover: vi.fn(async () => false),
    listProposalStepEvents: vi.fn(async () => (extra.steps === "fail" ? { ok: false } : { ok: true, events: extra.steps ?? [] })),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: loadStrip }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: stub("document") }));
  vi.doMock("@/components/proposal-editor/Lifecycle", () => ({ Lifecycle: stub("lifecycle") }));
  vi.doMock("@/components/proposal-editor/ActionForm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/components/proposal-editor/ActionForm")>()),
    IssueList: stub("issues"),
  }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));
  vi.doMock("@/components/proposal-editor/Sections", () => ({
    AddNameForm: stub("add-name"),
    AdjustmentsForm: stub("adjustments"),
    DetailsForm: stub("details"),
    IncludesForm: stub("includes"),
    MessageForm: stub("message"),
    NameCard: stub("name-card"),
    PricingForm: stub("pricing"),
  }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/[id]/page");
  const html = renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: ID }) })));
  return { html, loadStrip };
}

describe("proposal detail page", () => {
  beforeEach(() => vi.resetModules());

  it("puts the card above the editor, with both fees under their own labels", async () => {
    const { html } = await render(row(), [EVIDENCE]);
    const card = html.indexOf("Proposal at a glance");
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(html.indexOf('data-stub="details"'));
    expect(html).toContain("At signing (legal fee)");
    expect(html).toContain("At filing (USPTO fees)");
    expect(html).toContain("Heard on the call");
    expect(html).toContain("a word mark and a logo");
  });

  it("shows the consult strip, between the card and the editor, when the proposal has a lead", async () => {
    const { html, loadStrip } = await render(row(), [], { status: "none" });
    expect(loadStrip).toHaveBeenCalledWith("lead-9");
    const strip = html.indexOf("Latest consult");
    expect(strip).toBeGreaterThan(html.indexOf("Proposal at a glance"));
    expect(strip).toBeLessThan(html.indexOf('data-stub="details"'));
    expect(html).toContain("No consult recorded");
  });

  it("shows a failed consult read as such, not as none", async () => {
    const { html } = await render(row(), [], { status: "unavailable", unreadable: false });
    expect(html).toContain("Latest consult couldn&#x27;t be loaded");
    expect(html).not.toContain("No consult recorded");
  });

  it("with no lead there is no strip and no read", async () => {
    const { html, loadStrip } = await render(row({ lead_id: null }), []);
    expect(loadStrip).not.toHaveBeenCalled();
    expect(html).not.toContain("Latest consult");
    expect(html).toContain("Proposal at a glance");
  });

  it("a proposal with no agent event renders its card without receipts", async () => {
    const { html } = await render(row({ source: "manual" }), []);
    expect(html).toContain("Proposal at a glance");
    expect(html).not.toContain("Heard on the call");
  });
});

describe("LinkedProposalPanel (queue item page)", () => {
  const summary = (card: ReturnType<typeof buildProposalCard> | undefined) =>
    ({
      status: "ok",
      proposal: { id: ID, version: 1, status: "draft", clientName: "Sevetri Wilson", legalCents: 1, govCents: 2, errorCount: 0, warningCount: 1, ...(card ? { card } : {}) },
    }) as LinkedPanel;
  const panel = (p: LinkedPanel) => renderToStaticMarkup(createElement(LinkedProposalPanel, { panel: p, pending: true }));

  it("contains the card's two fees under 'At signing' and 'At filing'", () => {
    const html = panel(summary(buildProposalCard(row(), [EVIDENCE])));
    expect(html).toContain("At signing");
    expect(html).toContain("At filing");
    expect(html).toContain("Heard on the call");
    expect(html).toContain("Open proposal");
    expect(html.toLowerCase()).not.toContain("total");
    // The card carries the fees, so the older two-line figures are not repeated.
    expect(html).not.toContain(">Legal fee<");
  });

  it("says receipts couldn't be loaded when the events read failed, never an empty list", () => {
    const html = panel(summary(buildProposalCard(row(), null)));
    expect(html).toContain("Receipts couldn&#x27;t be loaded");
    expect(html).not.toContain("Heard on the call");
    expect(html).toContain("At signing");
  });

  it("still shows the original figures when no card was read", () => {
    const html = panel(summary(undefined));
    expect(html).toContain("Legal fee");
    expect(html).toContain("USPTO fees");
    expect(html).not.toContain("Proposal at a glance");
  });

  it("says the right next step for draft, saved and link live", () => {
    const at = (status: string) => panel({ status: "ok", proposal: { ...(summary(undefined) as { proposal: object }).proposal, status } } as LinkedPanel).replace(/&#x27;/g, "'");
    expect(at("draft")).toContain("click Save and create link.");
    expect(at("draft")).not.toMatch(/click Approve/i);
    expect(at("approved")).toContain("The proposal is saved. Approving this email turns its link on and puts the email in your mailbox as a draft. Nothing is sent.");
    expect(at("sent")).toContain("The proposal's link is live. Approving this email puts it in your mailbox as a draft. Nothing is sent.");
  });

  it("is unchanged for none and unavailable", () => {
    expect(panel({ status: "none" })).toBe("");
    expect(panel({ status: "unavailable" })).toContain("couldn&#x27;t be loaded");
  });
});


/* ─────────────────────────── Sprint 19: payment and follow-up ─────────────────────────── */

describe("proposal detail page: the payment panel on an accepted version", () => {
  beforeEach(() => vi.resetModules());

  const accepted = (over: Partial<ProposalRow> = {}) => row({ status: "accepted", accepted_at: "2026-10-21T15:00:00Z", ...over });
  const step = (stepName: string, outcome: string, at: string, extra: Record<string, unknown> = {}, reason?: string) => ({
    proposal_id: ID,
    type: "edited",
    actor: "staff",
    actor_user_id: "u-dawn",
    created_at: at,
    payload: { step: stepName, outcome, ...(reason ? { reason } : {}), ...extra },
  });
  const MARKED = step("paid_marked", "marked", "2026-10-21T16:00:00Z");
  const DAWN = [{ userId: "u-dawn", displayName: "Dawn Reyes", email: "dawn@example.com", role: "intake" }];
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

  it.each(["draft", "approved", "sent", "superseded", "withdrawn"] as const)("a %s version has no payment panel and no step read", async (status) => {
    const { html } = await render(row({ status }), []);
    expect(html).not.toContain("Payment and follow-up");
    expect(html).not.toContain("Mark paid");
  });

  it("an accepted version, not yet paid, offers Mark paid to an owner and says it is by hand", async () => {
    const { html } = await render(accepted(), [], undefined, { steps: [] });
    expect(html).toContain("Payment and follow-up");
    expect(html).toContain("Not paid");
    expect(buttons(html)).toContain("Mark paid");
    expect(html).toContain("Marked by hand. LawPay isn&#x27;t connected to proposals yet.");
  });

  it("paid: 'Paid · marked by Dawn · Oct 21' (first name from the member directory) and Undo", async () => {
    const { html } = await render(accepted(), [], undefined, { steps: [MARKED], members: DAWN, role: "intake" });
    expect(html).toContain("Paid · marked by Dawn · Oct 21");
    expect(buttons(html)).toContain("Undo");
    expect(buttons(html)).not.toContain("Mark paid");
  });

  it("a teammate who can't be named is left out of 'marked by', never shown as an id", async () => {
    const { html } = await render(accepted(), [], undefined, { steps: [MARKED], members: [] });
    expect(html).toContain("Paid · Oct 21");
    expect(html).not.toContain("u-dawn");
    expect(html).not.toContain("A teammate");
  });

  it("paid then undone: back to Not paid, Mark paid offered again", async () => {
    const { html } = await render(accepted(), [], undefined, { steps: [MARKED, step("paid_undone", "undone", "2026-10-21T17:00:00Z")], members: DAWN });
    expect(html).toContain("Not paid");
    expect(buttons(html)).toContain("Mark paid");
  });

  it("an unreadable step history says so, offers no Mark paid, and never says Not paid", async () => {
    const { html } = await render(accepted(), [], undefined, { steps: "fail" });
    expect(html).toContain("Paid status couldn&#x27;t be read");
    expect(html).not.toContain("Not paid");
    expect(buttons(html)).not.toContain("Mark paid");
    expect(buttons(html)).not.toContain("Undo");
  });

  it.each(["paralegal", "attorney", "viewer", "social_media"])("a %s sees the state but no buttons", async (role) => {
    const { html } = await render(accepted(), [], undefined, { steps: [MARKED], members: DAWN, role });
    expect(html).toContain("Paid · marked by Dawn");
    expect(buttons(html)).not.toContain("Undo");
    expect(buttons(html)).not.toContain("Mark paid");
    expect(buttons(html)).not.toContain("Retry");
  });

  it("walks the whole story: queued letter with a queue link, then approved and uploaded", async () => {
    const queued = step("loe_draft", "queued", "2026-10-21T16:01:00Z", { queue_item_id: "q_abc-1" });
    const before = await render(accepted(), [], undefined, { steps: [MARKED, queued], members: DAWN });
    expect(before.html).toContain("Engagement letter draft queued for approval.");
    expect(before.html).toContain('href="/dashboard/queue/q_abc-1/"');
    expect(before.html).toContain("Waiting for approval in the queue");

    vi.resetModules();
    const after = await render(accepted(), [], undefined, { steps: [MARKED, queued, step("loe_file_upload", "uploaded", "2026-10-21T18:00:00Z")], members: DAWN });
    expect(after.html).toContain("LOE file uploaded to Lawmatics.");
    expect(after.html).not.toContain("Waiting for approval in the queue");
  });

  it("the unknown-package case shows 'Choose the LOE template' linking to the LOE form (matter linked)", async () => {
    const blocked = step("loe_draft", "blocked", "2026-10-21T16:01:00Z", { code: "unknown_package" }, "This package isn't on the firm's current package list, so no engagement letter was drafted.");
    const { html } = await render(accepted({ matter_id: "matter-7" }), [], undefined, { steps: [MARKED, blocked] });
    expect(html).toContain("Choose the LOE template");
    expect(html).toContain('href="/dashboard/documents/new/matter-7/loe/"');
  });

  it("no matter: 'Open the matter to draft the LOE.'", async () => {
    const blocked = step("loe_draft", "blocked", "2026-10-21T16:01:00Z", { code: "no_matter" }, "Open the matter to draft the LOE.");
    const { html } = await render(accepted({ matter_id: null }), [], undefined, { steps: [MARKED, blocked] });
    expect(html).toContain("Open the matter to draft the LOE.");
  });

  it("the history lists accepted, the firm notice, the note, marked paid (by whom), the LOE draft and an undo, in words and newest first", async () => {
    const at = (m: number) => `2026-10-21T16:${String(m).padStart(2, "0")}:00Z`;
    const ev = (id: string, type: string, actor: string, payload: Record<string, unknown>, m: number) =>
      ({ id, org_id: "o", proposal_id: ID, family_id: ID, type, actor, actor_user_id: actor === "staff" ? "u-dawn" : null, payload, created_at: at(m) }) as ProposalEventRow;
    const events = [
      ev("e7", "edited", "staff", { step: "paid_undone", outcome: "undone" }, 7),
      ev("e6", "edited", "staff", { step: "loe_draft", outcome: "queued" }, 6),
      ev("e5", "edited", "staff", { step: "paid_marked", outcome: "marked" }, 5),
      ev("e4", "edited", "system", { step: "lawmatics_note", outcome: "added" }, 4),
      ev("e3", "edited", "system", { step: "accept_notice", outcome: "sent" }, 3),
      ev("e2", "accepted", "client", {}, 2),
    ];
    const { html } = await render(accepted(), events, undefined, { steps: [], members: DAWN });
    const order = ["accepted the proposal", "sent the firm an in-app notice", "added a note to Lawmatics", "<strong>Dawn</strong> marked it paid by hand", "queued the engagement letter draft", "undid the paid mark"].map((t) => html.indexOf(t));
    expect(order.every((n) => n > -1)).toBe(true);
    // Newest first: the undo is listed before the acceptance.
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(html).not.toContain("edited the proposal");
  });
});

describe("proposal detail page: Change pay link (lectual 0100)", () => {
  beforeEach(() => vi.resetModules());

  it("a link-live version offers Change pay link to a proposal-writing role, prefilled with the current link", async () => {
    const { html } = await render(row({ status: "sent", sent_at: "2026-10-19T12:00:00Z" }), [], undefined, { role: "paralegal" });
    expect(html).toContain("Change pay link");
    expect(html).toContain('name="payUrl"');
    expect(html).toContain('value="https://pay.example/x"');
    expect(html).toContain("except its pay link (below)");
  });

  it.each(["draft", "approved", "accepted", "superseded", "withdrawn"] as const)("a %s version has no Change pay link", async (status) => {
    const { html } = await render(row({ status }), [], undefined, { steps: [] });
    expect(html).not.toContain("Change pay link");
  });

  it.each(["viewer", "social_media"])("a %s never sees it, even on a live link", async (role) => {
    const { html } = await render(row({ status: "sent", sent_at: "2026-10-19T12:00:00Z" }), [], undefined, { role });
    expect(html).not.toContain("Change pay link");
    expect(html).not.toContain("except its pay link");
  });
});
