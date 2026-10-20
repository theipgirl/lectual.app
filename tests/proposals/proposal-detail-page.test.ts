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

async function render(proposal: ProposalRow, events: ProposalEventRow[], strip: unknown = { status: "none" }) {
  const stub = (name: string) => {
    const Stub = () => createElement("div", { "data-stub": name });
    Stub.displayName = `Stub(${name})`;
    return Stub;
  };
  const loadStrip = vi.fn(async () => strip);
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events })),
    getProposalSettings: vi.fn(async () => null),
    isCurrentUserApprover: vi.fn(async () => false),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: loadStrip }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: stub("document") }));
  vi.doMock("@/components/proposal-editor/Lifecycle", () => ({ Lifecycle: stub("lifecycle") }));
  vi.doMock("@/components/proposal-editor/ActionForm", () => ({ IssueList: stub("issues") }));
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

  it("is unchanged for none and unavailable", () => {
    expect(panel({ status: "none" })).toBe("");
    expect(panel({ status: "unavailable" })).toContain("couldn&#x27;t be loaded");
  });
});
