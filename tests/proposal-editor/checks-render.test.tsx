import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalEventRow, ProposalRow, ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

/**
 * Sprint 5 (F9, I1, I2): the REAL editor page, data layer mocked (no database, no browser), for an assistant draft and a
 * Copilot draft that carry `content.checks`. Set SPRINT5_HTML_DIR to also write the markup for the screenshot harness.
 */

const ID = "77777777-7777-4777-8777-777777777777";
const CONCIERGE = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ESSENTIAL = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const SETTINGS = { pricing: { packages: [CONCIERGE, ESSENTIAL] }, approver_user_ids: ["u9"] };

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content: sevetri(),
    expires_on: "2099-11-10", pay_url: "https://pay.example/x", source: "agent", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", ...over,
  };
}

const EVIDENCE: ProposalEventRow = {
  id: "e1", org_id: "o", proposal_id: ID, family_id: ID, type: "edited", actor: "agent", actor_user_id: null,
  payload: { source: "consult-proposal", evidence: [{ path: "p", quote: "a word mark and a logo", verified: true }], notes: "CHECK FIRST: choose the package before saving.\nCHECK FIRST: confirm the credit.\nCHECK FIRST: add the pay link." },
  created_at: "2026-10-18T12:01:00Z",
};

async function render(proposal: ProposalRow, events: ProposalEventRow[] = []) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u9", displayName: "Rebecca Cole", email: "r@example.com" }]) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events })),
    getProposalSettings: vi.fn(async () => SETTINGS),
    isCurrentUserApprover: vi.fn(async () => true),
    listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [] })),
    listProposalOpens: vi.fn(async () => new Map()),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/proposals/lead-link", () => ({ loadLeadLink: vi.fn(async () => ({ state: "none" })) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [] })) }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: () => createElement("div", { "data-stub": "document" }) }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: ID }) })));
}

function save(name: string, html: string) {
  const dir = process.env.SPRINT5_HTML_DIR;
  if (dir) writeFileSync(`${dir}/${name}.body.html`, html);
}

/** Every `<a class="pe-ready-link" href="#x">` in the checks list: x must be an element id in the same markup. */
function checkTargets(html: string): string[] {
  const block = html.slice(html.indexOf("data-ready-checks"));
  const list = block.slice(0, block.indexOf("</ul>"));
  return [...list.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
}
const hasId = (html: string, id: string) => html.includes(`id="${id}"`);

const assistantContent = (): ProposalContent => {
  const c = sevetri();
  c.made_by = "assistant";
  c.made_from = { consult_date: "2026-10-15" };
  c.packages = [{ ...ESSENTIAL }, { ...CONCIERGE }] as never;
  c.names[0].package_choice = { options: ["Essential", "Concierge"], default: "Concierge" };
  c.adjustments = [{ id: "adj-1", label: "Consult credit", kind: "amount", value: 15_000 }];
  c.checks = [
    { source: "consult", path: "names[0].package_choice", text: "The client can choose among Essential, Concierge, starting on Concierge." },
    { source: "consult", path: "adjustments[0]", text: "The credit \"Consult credit\" of $150 was applied from the call. Check it is what the attorney offered." },
    { source: "consult", path: "pricing.second_mark_discount_pct", text: "The second-mark discount was set to 10% from the call. Check it is what the attorney said." },
  ];
  return c;
};

const copilotContent = (): ProposalContent => {
  const c = sevetri();
  c.made_by = "copilot";
  c.names[0].discount_pct = 10;
  c.checks = [
    { source: "copilot", path: "names[0].discount_pct", text: "A discount on this brand name was applied from your request. Check it." },
    { source: "copilot", path: "pay_url", text: "Add the client's pay link before creating the link." },
  ];
  return c;
};

beforeEach(() => vi.resetModules());

describe("I2 and F9: an assistant draft with the 'client chooses' setting", () => {
  it("shows the choice starting on the recommended package without opening a <details>, the Check these panel, and field-linked checks", async () => {
    const html = await render(row({ content: assistantContent() }), [EVIDENCE]);
    save("assistant-draft", html);
    expect(html).toContain("Made by the assistant from the Oct 15 consult");
    expect(html).toContain("Check these 3 things");
    const targets = checkTargets(html);
    expect(targets).toEqual(["pe-f-brand-0-package", "pe-f-adjustments", "pe-f-pricing-second_mark_discount_pct"]);
    for (const t of targets) expect(hasId(html, t), t).toBe(true);
    // the brand's package choice is in view: its field and its Concierge default are not inside a <details>
    const at = html.indexOf('name="b.0.pkgDefault"');
    expect(at).toBeGreaterThan(-1);
    const before = html.slice(0, at);
    expect((before.match(/<details/g)?.length ?? 0) - (before.match(/<\/details>/g)?.length ?? 0)).toBe(0);
    expect(html).toMatch(/<option value="Concierge" selected/);
  });

  it("only checks: nothing blocks, and Save and create link is not disabled by them", async () => {
    const html = await render(row({ content: assistantContent() }), []);
    expect(html).toContain("None blocks the link");
    expect(html).not.toMatch(/<button[^>]*value="link"[^>]*disabled/);
    expect(html).toContain("Check these 3 things");
  });
});

describe("I1 and F9: a Copilot draft", () => {
  it("shows 'Made with Copilot' and checks linked to the pay-link field and the brand's discount field", async () => {
    const html = await render(row({ content: copilotContent(), pay_url: null }));
    save("copilot-draft", html);
    expect(html).toContain("Made with Copilot");
    const targets = checkTargets(html);
    expect(targets).toEqual(["pe-f-brand-0-discount", "pe-f-payUrl"]);
    for (const t of targets) expect(hasId(html, t), t).toBe(true);
    expect(html).toContain("Check these 2 things");
  });

  it("the checks never reach the client: the public content has none", async () => {
    const { publicContent } = await import("@/lib/proposals/public");
    expect(publicContent(copilotContent())).not.toHaveProperty("checks");
    expect(publicContent(assistantContent())).not.toHaveProperty("checks");
  });
});
