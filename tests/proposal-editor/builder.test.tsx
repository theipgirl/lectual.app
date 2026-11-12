import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { countChangedFields, messageInMoreOptions, moreOptionsSummary } from "@/lib/proposal-editor/more-options";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalRow } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

vi.mock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));


describe("More options: the pure rules", () => {
  it("the summary adds ' - N changed' only when N is above zero", () => {
    expect(moreOptionsSummary(0)).toBe("More options");
    expect(moreOptionsSummary(2)).toBe("More options - 2 changed");
  });

  it("counts fields that differ from the defaults, trimmed", () => {
    expect(countChangedFields([{ current: "4950", baseline: "4950" }, { current: " 3 ", baseline: "3" }])).toBe(0);
    expect(countChangedFields([{ current: "5000", baseline: "4950" }, { current: "21", baseline: "20" }, { current: "x", baseline: "x" }])).toBe(2);
  });

  it("a refusal sentence is placed by its label", () => {
    expect(messageInMoreOptions("Second-mark discount: enter a percentage from 0 to 100.")).toBe(true);
    expect(messageInMoreOptions("Expiry date: pick a real date.")).toBe(false);
    expect(messageInMoreOptions("Enter the client's full name.")).toBe(false);
    expect(messageInMoreOptions(undefined)).toBe(false);
  });
});

const namesOf = (html: string) => new Set([...html.matchAll(/<(?:input|select|textarea)[^>]*? name="([^"]+)"/g)].map((m) => m[1]));
const at = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  expect(i, `${needle} should be on the page`).toBeGreaterThan(-1);
  return i;
};

/*
Sprint 3 removed the New proposal form (the three steps, the create button and its More options) that the tests here pinned.
Where its coverage went: create-proposal-one-step.test.ts (the one-step action and 'no brand, package or pay-link field on any page
under proposals/new'), new-proposal-picker.test.ts (the picker, Start blank, the one-button page), draft-spec.test.ts (packages and
offers), and the editor tests below (which carry the same fields, the More options rules and the pay link).
*/

const ID = "55555555-5555-4555-8555-555555555555";

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: "lead-9", matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content: sevetri(),
    expires_on: "2026-11-10", pay_url: "https://pay.example/x", source: "manual", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", ...over,
  };
}

async function renderEditor(proposal: ProposalRow, extra: { lead?: unknown; settings?: unknown } = {}) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events: [] })),
    getProposalSettings: vi.fn(async () => extra.settings ?? null),
    isCurrentUserApprover: vi.fn(async () => true),
    listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [] })),
  }));
  vi.doMock("@/lib/consult-proposal/link", () => ({ GOES_LIVE_ON_APPROVAL: "x", proposalSendBlock: vi.fn(async () => ({ blocked: false })) }));
  vi.doMock("@/lib/proposals/consult-strip-load", () => ({ loadConsultStrip: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/proposals/lead-link", () => ({ loadLeadLink: vi.fn(async () => extra.lead ?? { state: "linked", id: "lead-9", name: "Sevetri Wilson · Prosperall" }) }));
  vi.doMock("@/lib/proposals/lead-options", () => ({ loadLeadOptions: vi.fn(async () => ({ status: "ok", leads: [{ id: "l1", label: "Ana Ruiz" }] })) }));
  vi.doMock("@/components/client-proposal/ProposalDocument", () => ({ ProposalDocument: () => createElement("div", { "data-stub": "document" }) }));
  vi.doMock("@/app/dashboard/proposals/[id]/paid-actions", () => ({ markPaidAction: vi.fn(), undoPaidAction: vi.fn(), retryUploadAction: vi.fn() }));
  const { default: Page } = await import("../../src/app/dashboard/proposals/[id]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ id: ID }) })));
}

describe("the proposal editor: five sections, one Save (Sprint 1)", () => {
  beforeEach(() => vi.resetModules());

  it("the DOM order is Who, What we're protecting, Fees and payment, Message; no More options", async () => {
    const html = await renderEditor(row());
    const order = [at(html, 'id="pe-sec-who"'), at(html, 'id="pe-sec-brands"'), at(html, 'id="pe-sec-fees"'), at(html, 'id="pe-sec-message"')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("More options");
    expect(html).not.toContain("pe-more-sum");
  });

  it("every field the editor had before still renders (brand fields under b.<n>.), in the form that saves them all", async () => {
    const html = await renderEditor(row());
    const names = namesOf(html);
    const before = [
      "fullName", "firstName", "company", "clientEmail", "title", "expiresOn", "payUrl",
      "greeting", "recommendation", "officeActionNote",
      "package", "base", "includedClasses", "perClass", "secondMarkPct", "govPerClass",
      "b.0.name", "b.0.what", "b.0.note", "b.0.overrideBase", "b.0.overridePerClass", "b.0.nameId",
      "b.0.mark.0.id", "b.0.mark.0.kind", "b.0.mark.0.desc", "b.0.mark.0.preselected", "b.0.class.0.id", "b.0.class.0.label", "b.0.class.0.preselected",
      "b.0.discountPct", "b.0.clientAddMax", "adjFields", "incFields",
    ];
    for (const n of before) expect(names, n).toContain(n);
    expect([...names].some((n) => n.startsWith("inc."))).toBe(true);
    expect(names.has("reduceUnderIncluded")).toBe(true);
  });

  it("the pay link and the expiry date sit together in Fees and payment", async () => {
    const html = await renderEditor(row());
    const fees = html.slice(at(html, 'id="pe-sec-fees"'), at(html, 'id="pe-sec-message"'));
    expect(fees).toContain('name="expiresOn"');
    expect(fees).toContain('value="2026-11-10"');
    expect(fees.indexOf('name="payUrl"')).toBeLessThan(fees.indexOf('name="expiresOn"'));
  });

  it("a stored non-default value inside Advanced is still in the markup", async () => {
    const c = sevetri();
    c.pricing = { ...c.pricing, second_mark_discount_pct: 17.5, reduce_under_included: true };
    c.adjustments = [{ id: "a1", label: "Event credit", kind: "amount", value: 15_000 }];
    c.names[0].price_override = { base_cents: 450_000 };
    const html = await renderEditor(row({ content: c }));
    expect(html).toMatch(/name="secondMarkPct"[^>]*value="17.5"|value="17.5"[^>]*name="secondMarkPct"/);
    expect(html).toContain('value="Event credit"');
    expect(html).toContain('value="4500.00"');
    expect(html).toMatch(/name="reduceUnderIncluded"[^>]*checked|checked[^>]*name="reduceUnderIncluded"/);
  });

  it("the custom-package switch is labelled with the per-class amount and shows both prices", async () => {
    const html = await renderEditor(row());
    expect(html).toContain("Custom package: $825 less per class under the package&#x27;s included classes");
    expect(html).toContain("a flat $4,950 for one class");
    expect(html).toContain("On: one class is $3,300");
  });
});

describe("the editor header: whose proposal this is", () => {
  beforeEach(() => vi.resetModules());

  it("with a lead: 'Open lead' linking to the lead's page", async () => {
    const html = await renderEditor(row());
    expect(html).toMatch(/href="\/dashboard\/leads\/lead-9"[^>]*>Open lead →<\/a>/);
  });

  it("with a matter as well: a link to the matter", async () => {
    const html = await renderEditor(row({ matter_id: "matter-3" }));
    expect(html).toContain('href="/dashboard/matters/matter-3"');
    expect(html).toContain("Open matter →");
  });

  it("a lead that could not be read says so, and is not 'not linked'", async () => {
    const html = await renderEditor(row(), { lead: { state: "unreadable", id: "lead-9" } });
    expect(html).toContain("Lead couldn&#x27;t be loaded");
    expect(html).not.toContain("Not linked to a lead");
  });

  it("no lead: 'Not linked to a lead' with the picker to link one", async () => {
    const html = await renderEditor(row({ lead_id: null }), { lead: { state: "none" } });
    expect(html).toContain("Not linked to a lead");
    expect(html).toContain("Link to a lead");
    expect(html).toContain("Ana Ruiz");
    expect(html).toContain("Link lead");
  });
});

describe("the editor's class rows: one class is always included", () => {
  beforeEach(() => vi.resetModules());

  it("a brand name with one class shows it ticked and disabled with 'Included', and still posts it", async () => {
    const c = sevetri();
    c.names[0].classes = [c.names[0].classes[0]];
    const html = await renderEditor(row({ content: c }));
    expect(html).toContain('<span class="pe-lock">Included</span>');
    expect(html).toContain('<input type="hidden" name="b.0.class.0.preselected" value="on"/>');
    expect(html).toMatch(/<input type="checkbox" (?:checked="" disabled=""|disabled="" checked="")\/><span>Selected to start<\/span><span class="pe-lock">Included/);
  });

  it("with several classes and one left ticked, that one says 'At least one class is included'", async () => {
    const c = sevetri();
    c.names[0].classes[1].preselected = false;
    const html = await renderEditor(row({ content: c }));
    expect(html).toContain('<span class="pe-lock">At least one class is included</span>');
    expect(html.match(/class="pe-lock"/g)?.length).toBe(1);
  });

  it("with two ticked, nothing is disabled", async () => {
    const html = await renderEditor(row());
    expect(html).not.toContain("pe-lock");
  });
});
