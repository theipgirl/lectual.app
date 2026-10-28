import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewProposalForm } from "@/components/proposal-editor/NewProposalForm";
import { countChangedFields, editorChangedCount, messageInMoreOptions, moreOptionsSummary, pathInMoreOptions, shouldOpenMore } from "@/lib/proposal-editor/more-options";
import { packageOption } from "@/lib/proposals/package-list";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalRow } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";

vi.mock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));

const CONCIERGE = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ESSENTIAL = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };

describe("More options: the pure rules", () => {
  it("the summary adds ' - N changed' only when N is above zero", () => {
    expect(moreOptionsSummary(0)).toBe("More options");
    expect(moreOptionsSummary(2)).toBe("More options - 2 changed");
  });

  it("counts fields that differ from the defaults, trimmed", () => {
    expect(countChangedFields([{ current: "4950", baseline: "4950" }, { current: " 3 ", baseline: "3" }])).toBe(0);
    expect(countChangedFields([{ current: "5000", baseline: "4950" }, { current: "21", baseline: "20" }, { current: "x", baseline: "x" }])).toBe(2);
  });

  it("the editor's count: 0 at the firm's package, 2 when two numbers differ, and a discount is one more", () => {
    const base = { pricing: { ...CONCIERGE }, firmPackage: CONCIERGE, adjustments: 0, brandPriceOverrides: 0 };
    expect(editorChangedCount(base)).toBe(0);
    expect(editorChangedCount({ ...base, pricing: { ...CONCIERGE, base_cents: 500_000, second_mark_discount_pct: 25 } })).toBe(2);
    expect(editorChangedCount({ ...base, adjustments: 1 })).toBe(1);
    expect(editorChangedCount({ ...base, brandPriceOverrides: 1, pricing: { ...CONCIERGE, reduce_under_included: true } })).toBe(2);
  });

  it("a package that is not on the firm's list has nothing to differ from", () => {
    expect(editorChangedCount({ pricing: { ...CONCIERGE, package: "Custom" }, firmPackage: null, adjustments: 0, brandPriceOverrides: 0 })).toBe(0);
  });

  it("a problem on a field inside More options opens it; one on a step field does not", () => {
    expect(shouldOpenMore(["pricing.second_mark_discount_pct"])).toBe(true);
    expect(shouldOpenMore(["names[0].marks[1].desc"])).toBe(true);
    expect(shouldOpenMore(["adjustments[0].label", "client_email"])).toBe(true);
    expect(shouldOpenMore(["client_email", "pay_url", "pricing.package", "names[0].classes"])).toBe(false);
    expect(pathInMoreOptions("names[0].marks[0].kind")).toBe(false);
  });

  it("a refusal sentence is placed by its label", () => {
    expect(messageInMoreOptions("Second-mark discount: enter a percentage from 0 to 100.")).toBe(true);
    expect(messageInMoreOptions("Expiry date: pick a real date.")).toBe(false);
    expect(messageInMoreOptions("Enter the client's full name.")).toBe(false);
    expect(messageInMoreOptions(undefined)).toBe(false);
  });
});

const DEFAULTS = { leadId: "", matterId: "", fullName: "Ana", firstName: "Ana", company: "", clientEmail: "a@example.com", brandName: "Prosperall", title: "Trademark Proposal", expiresOn: "2026-11-10", payUrl: "" };
const PACKAGES = [packageOption(ESSENTIAL), packageOption(CONCIERGE)];

function renderNew(over: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(NewProposalForm, { defaults: DEFAULTS, hasSettings: true, packages: PACKAGES, consult: createElement("p", null, "consult list"), ...over }));
}

const namesOf = (html: string) => new Set([...html.matchAll(/<(?:input|select|textarea)[^>]*? name="([^"]+)"/g)].map((m) => m[1]));
const at = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  expect(i, `${needle} should be on the page`).toBeGreaterThan(-1);
  return i;
};

describe("New proposal: three steps, the button, then one closed More options", () => {
  const html = renderNew();

  it("the DOM order is Who, Brand names and classes, Package and pay link, the create button, More options", () => {
    const order = [
      at(html, "Who</span>"),
      at(html, "Brand names and classes</span>"),
      at(html, "Package and pay link</span>"),
      at(html, ">Create draft</button>"),
      at(html, 'class="pe-more"'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("has exactly one details element, it is More options, and it is closed", () => {
    expect(html.match(/<details/g)).toHaveLength(1);
    expect(html).toMatch(/<details class="pe-more"><summary class="pe-more-sum">More options<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
  });

  it("the who step has the client; the package step has the package and pay link; the rest is in More options", () => {
    const more = html.slice(at(html, 'class="pe-more"'));
    const before = html.slice(0, at(html, 'class="pe-more"'));
    for (const n of ["fullName", "clientEmail", "brandName", "useConsult", "package", "payUrl"]) expect(namesOf(before)).toContain(n);
    for (const n of ["firstName", "company", "title", "base", "includedClasses", "perClass", "secondMarkPct", "govPerClass"]) {
      expect(namesOf(more)).toContain(n);
      expect(namesOf(before)).not.toContain(n);
    }
    // the expiry date sits in Step 3 beside the pay link, not in More options
    expect(namesOf(before)).toContain("expiresOn");
    expect(namesOf(more)).not.toContain("expiresOn");
    expect(before.indexOf('name="payUrl"')).toBeLessThan(before.indexOf('name="expiresOn"'));
  });

  it("every field that existed before the redesign is still rendered under its old name", () => {
    const before = ["leadId", "matterId", "fullName", "firstName", "company", "clientEmail", "title", "expiresOn", "brandName", "useConsult", "package", "base", "includedClasses", "perClass", "secondMarkPct", "govPerClass", "payUrl"];
    const now = namesOf(html);
    for (const n of before) expect(now, n).toContain(n);
  });

  it("with the defaults nothing has changed, so the summary has no count", () => {
    expect(html).toContain("More options</summary>");
    expect(html).not.toContain("changed</summary>");
  });

  it("without packages the five price fields and the dropdown are not drawn, and the page says why", () => {
    const bare = renderNew({ packages: null });
    for (const n of ["package", "base", "perClass"]) expect(namesOf(bare)).not.toContain(n);
    expect(bare).toContain("couldn&#x27;t be loaded");
  });
});

/* ───────────── the editor, rendered with the real section forms ───────────── */

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

describe("the proposal editor: three steps, the button, then one closed More options", () => {
  beforeEach(() => vi.resetModules());

  it("the DOM order is the three steps, then Save and create link, then More options", async () => {
    const html = await renderEditor(row());
    const order = [at(html, "Who</span>"), at(html, "Brand names and classes</span>"), at(html, "Package and pay link</span>"), at(html, "Save and create link"), at(html, 'class="pe-more"')];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.match(/<details class="pe-more"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details class="pe-more"[^>]* open/);
    expect(html).toContain("More options</summary>");
  });

  it("every field the editor had before still renders, with the same names", async () => {
    const html = await renderEditor(row());
    const names = namesOf(html);
    const before = [
      "fullName", "firstName", "company", "clientEmail", "title", "expiresOn", "payUrl",
      "greeting", "recommendation", "officeActionNote",
      "package", "base", "includedClasses", "perClass", "secondMarkPct", "govPerClass",
      "name", "what", "note", "overrideBase", "overridePerClass",
      "mark.0.id", "mark.0.kind", "mark.0.desc", "mark.0.preselected", "class.0.id", "class.0.label", "class.0.preselected",
    ];
    for (const n of before) expect(names, n).toContain(n);
    expect([...names].some((n) => n.startsWith("inc."))).toBe(true);
    expect(names.has("reduceUnderIncluded")).toBe(true);
    // the rarely-changed ones are inside More options, the step ones are not
    const more = html.slice(at(html, 'class="pe-more"'));
    for (const n of ["firstName", "company", "title", "base", "secondMarkPct", "greeting", "recommendation", "officeActionNote", "what", "note", "overrideBase", "mark.0.desc"]) expect(namesOf(more), n).toContain(n);
    const steps = html.slice(0, at(html, 'class="pe-more"'));
    for (const n of ["fullName", "clientEmail", "package", "payUrl", "expiresOn", "class.0.label"]) expect(namesOf(steps), n).toContain(n);
  });

  it("More options fields belong to their step's form through the form attribute", async () => {
    const html = await renderEditor(row());
    expect(html).toContain(`id="pe-details-${ID}"`);
    expect(html).toContain(`id="pe-pricing-${ID}"`);
    expect(html).toMatch(new RegExp(`<input[^>]*name="title"[^>]*form="pe-details-${ID}"|<input[^>]*form="pe-details-${ID}"[^>]*name="title"`));
    expect(html).toMatch(new RegExp(`name="secondMarkPct"[^>]*form="pe-pricing-${ID}"|form="pe-pricing-${ID}"[^>]*name="secondMarkPct"`));
  });

  it("the expiry date belongs to the package form, beside the pay link, and is not in More options", async () => {
    const html = await renderEditor(row());
    const more = html.slice(at(html, 'class="pe-more"'));
    expect(namesOf(more)).not.toContain("expiresOn");
    const pkg = html.slice(at(html, `id="pe-pricing-${ID}"`), at(html, 'class="pe-more"'));
    expect(pkg).toContain('name="expiresOn"');
    expect(pkg).toContain('value="2026-11-10"');
    expect(pkg.indexOf('name="payUrl"')).toBeLessThan(pkg.indexOf('name="expiresOn"'));
  });

  it("a stored non-default value inside More options is still in the markup", async () => {
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

  it("counts what differs from the firm's package, and is closed when nothing is wrong", async () => {
    const settings = { pricing: { packages: [CONCIERGE] }, approver_user_ids: [] };
    const c = sevetri();
    c.pricing = { ...c.pricing, second_mark_discount_pct: 25 };
    c.adjustments = [{ id: "a1", label: "Credit", kind: "amount", value: 15_000 }];
    const html = await renderEditor(row({ content: c }), { settings });
    expect(html).toContain("More options - 2 changed</summary>");
  });

  it("opens More options when a problem is inside it (second-mark percent out of range)", async () => {
    const c = sevetri();
    c.pricing = { ...c.pricing, second_mark_discount_pct: 150 };
    const html = await renderEditor(row({ content: c }));
    expect(html).toMatch(/<details class="pe-more" open="">/);
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
    expect(html).toContain('<input type="hidden" name="class.0.preselected" value="on"/>');
    expect(html).toMatch(/<input type="checkbox" (?:checked="" disabled=""|disabled="" checked="")\/><span>Starts ticked<\/span><span class="pe-lock">Included/);
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
