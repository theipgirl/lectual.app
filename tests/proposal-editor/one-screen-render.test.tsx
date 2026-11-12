import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalEventRow, ProposalRow } from "@/lib/proposals/types";
import { PayBox } from "@/components/proposal-editor/EditorSide";
import { UnsavedGuardProvider } from "@/components/proposal-editor/UnsavedGuard";
import { quoteProposal, defaultSelection } from "@/lib/proposals/pricing";
import { targetForPath } from "@/lib/proposal-editor/checklist";
import { faithe } from "../proposals/general-fixture";
import { sevetri } from "../proposals/fixture";

/**
 * Sprint 1: the edit page is five sections, one Save. Rendered with the REAL page and components and the data
 * layer mocked (no database, no browser): the contract's F1, F5, F6, F7 and D1 to D5, V4.
 */

const ID = "66666666-6666-4666-8666-666666666666";
const CONCIERGE = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ESSENTIAL = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const SETTINGS = { pricing: { packages: [CONCIERGE, ESSENTIAL] }, approver_user_ids: ["u9"] };

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content: sevetri(),
    expires_on: "2026-11-10", pay_url: "https://pay.example/x", source: "manual", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", ...over,
  };
}

type Extra = { role?: string; isApprover?: boolean; events?: ProposalEventRow[] };

async function render(proposal: ProposalRow, extra: Extra = {}) {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: extra.role ?? "owner", org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u9", displayName: "Rebecca Cole", email: "r@example.com" }]) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events: extra.events ?? [] })),
    getProposalSettings: vi.fn(async () => SETTINGS),
    isCurrentUserApprover: vi.fn(async () => extra.isApprover ?? true),
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

/** How many `<details>` are open around the character at `index`. */
function detailsDepth(html: string, index: number): number {
  const before = html.slice(0, index);
  return (before.match(/<details/g)?.length ?? 0) - (before.match(/<\/details>/g)?.length ?? 0);
}
const indexOfName = (html: string, name: string) => {
  const i = html.search(new RegExp(`name="${name.replace(/\./g, "\\.")}"`));
  expect(i, `${name} should be in the page`).toBeGreaterThan(-1);
  return i;
};
const buttons = (html: string, label: string) => (html.match(new RegExp(`<button[^>]*>${label}</button>`, "g")) ?? []).length;

beforeEach(() => vi.resetModules());

describe("F1: one Save, one Save and create link, no per-section Save", () => {
  it("a two-brand trademark draft", async () => {
    const html = await render(row());
    expect(buttons(html, "Save")).toBe(1);
    expect(buttons(html, "Save and create link")).toBe(1);
    expect(html.match(/<button[^>]*>Save[^<]*<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain("data-more-save");
    expect(html).not.toMatch(/Save (client|wording|package|discounts|included|this brand|Prosperall|Tech4PublicGood)/);
    expect(html).not.toMatch(/<summary[^>]*>More options/);
    expect(html).not.toContain("More options");
    expect(html.match(/<form /g)?.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(html.match(/id="pe-draft"/g)).toHaveLength(1);
  });

  it("both buttons submit the one form through the form attribute", async () => {
    const html = await render(row());
    expect(html).toMatch(/<button type="submit" form="pe-draft" value="save"/);
    expect(html).toMatch(/<button type="submit" form="pe-draft" value="link"/);
  });
});

describe("D1: the common choices are in view, not inside a <details>", () => {
  it("package choice (all three modes), per-mark choice, Selected to start and the brand discount", async () => {
    const c = sevetri();
    c.names[0].package_choice = { options: ["Essential", "Concierge"], default: "Essential" };
    c.names[1].marks[0].package_choice = { options: ["Concierge"], default: "Concierge" };
    c.packages = [
      { ...ESSENTIAL, includes: [] },
      { ...CONCIERGE, includes: [] },
    ] as never;
    const html = await render(row({ content: c }));
    for (const n of ["b.0.pkgMode", "b.1.pkgMode", "b.0.discountPct", "b.0.pkgChoice", "b.0.pkgDefault", "b.0.mark.0.preselected", "b.0.class.0.preselected", "b.1.mark.0.pkgChoice", "b.1.mark.0.pkgDefault", "b.0.applyAll"]) {
      expect(detailsDepth(html, indexOfName(html, n)), n).toBe(0);
    }
    expect(html).toContain("Selected to start");
    expect(html).toContain("Package for this brand");
    expect(html).toContain("Use these package options for every brand");
    expect(html).toContain("Discount on this brand");
    // all three modes are offered
    expect(html).toContain("One package");
    expect(html).toContain("The client chooses");
    expect(html).toContain("A different package for each mark");
    expect(html).not.toContain("Starts ticked");
    expect(html).toContain("Let the client describe this");
  });

  it("the greeting and the first name are not inside a <details>", async () => {
    const html = await render(row());
    for (const n of ["greeting", "firstName", "fullName", "clientEmail", "payUrl"]) expect(detailsDepth(html, indexOfName(html, n)), n).toBe(0);
  });

  it("the Advanced sections are closed and hold the rarely used fields", async () => {
    const html = await render(row());
    expect(html).toContain("Advanced for this brand");
    expect(html).toContain("Advanced pricing");
    expect(html).not.toMatch(/<details[^>]* open/);
    for (const n of ["b.0.overrideBase", "b.0.note", "base", "reduceUnderIncluded"]) expect(detailsDepth(html, indexOfName(html, n)), n).toBe(1);
  });
});

describe("D2: Ready to send? lists what blocks the link, from the first load", () => {
  it("a draft with no pay link lists 'Add the pay link' with a link to the pay-link input", async () => {
    const html = await render(row({ pay_url: null }));
    expect(html).toContain("Ready to send?");
    expect(html).toMatch(/<a class="pe-ready-link" href="#pe-f-payUrl">[\s\S]*Add the pay link/);
    expect(html).toContain('id="pe-f-payUrl"');
  });

  it("every item's target id exists in the same render", async () => {
    const c = sevetri();
    c.names[0].classes = [];
    c.greeting = "";
    const html = await render(row({ pay_url: null, client_email: null, expires_on: null, title: "T", content: c }));
    const hrefs = [...html.matchAll(/class="pe-ready-link" href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const h of hrefs) expect(html, h).toContain(`id="${h}"`);
  });

  it("a draft that passes approval validation shows nothing blocking and no items", async () => {
    const html = await render(row());
    expect(html).toContain("Nothing is blocking the link.");
    expect(html).not.toContain("pe-ready-list");
  });

  it("every validation path maps to a field id the editor draws", () => {
    for (const p of ["pay_url", "expires_on", "client_email", "title", "client.full_name", "greeting", "names[0].classes", "names[1].marks[0].desc", "pricing.base_cents", "adjustments[0].label", "includes[0].label", "general.fee_cents", "names", "content"]) {
      expect(targetForPath(p)).toMatch(/^pe-(f|sec)-/);
    }
  });
});

describe("D3: What the client pays comes from the saved prices", () => {
  const quote = quoteProposal(sevetri(), defaultSelection(sevetri()));
  const box = (dirty: boolean) => renderToStaticMarkup(createElement(UnsavedGuardProvider, { initial: { dirty } }, createElement(PayBox, { quote, general: false, valueOverFee: null })));
  it("shows the note while there are unsaved changes, and not otherwise", () => {
    expect(box(true)).toContain("Prices update when you save");
    expect(box(false)).not.toContain("Prices update when you save");
    expect(box(false)).toContain("Legal fee, due when accepted");
  });
});

describe("D5: an assistant's draft shows 'Check these N things'", () => {
  const EVENT = {
    id: "e1", org_id: "o", proposal_id: ID, family_id: ID, type: "edited", actor: "agent", actor_user_id: null,
    payload: { source: "consult-proposal", evidence: [{ path: "p", quote: "a word mark and a logo", verified: true }], notes: "CHECK FIRST: confirm the package. CHECK FIRST: the second mark." },
    created_at: "2026-10-18T12:01:00Z",
  } as ProposalEventRow;

  it("lists the CHECK FIRST flags and the quote, at the top, with no glance card", async () => {
    const html = await render(row({ source: "agent" }), { events: [EVENT] });
    expect(html).toContain("Check these 3 things");
    const panel = html.slice(html.indexOf("data-check-first"), html.indexOf("</ol>"));
    expect(panel.match(/<li>/g)).toHaveLength(3);
    expect(html.indexOf("Check these")).toBeLessThan(html.indexOf('id="pe-sec-who"'));
    expect(html).not.toContain("Proposal at a glance");
  });

  it("a person's own draft shows neither", async () => {
    const html = await render(row({ source: "manual" }), { events: [EVENT] });
    expect(html).not.toContain("Check these");
    expect(html).not.toContain("Proposal at a glance");
  });
});

describe("F5: gates", () => {
  it("a read-only role sees no Save and no Save and create link, and the fields are disabled", async () => {
    const html = await render(row(), { role: "viewer" });
    expect(buttons(html, "Save")).toBe(0);
    expect(buttons(html, "Save and create link")).toBe(0);
    expect(html).not.toContain("Remove brand name");
    expect(html).toContain("Your role can view proposals but not change them.");
    expect(html).toMatch(/<fieldset class="pe-fieldset" disabled/);
  });

  it("a non-approver who can write sees Save and the 'Ask ... to create the link' wording, and no create button", async () => {
    const html = await render(row(), { isApprover: false });
    expect(buttons(html, "Save")).toBe(1);
    expect(buttons(html, "Save and create link")).toBe(0);
    expect(html).toContain("Ask Rebecca to create the link.");
  });
});

describe("F6: a flat-fee draft uses the same shell", () => {
  it("one Save, one Save and create link, the checklist and side column, and no trademark-only sections", async () => {
    const html = await render(row({ content: faithe(), client_name: "Faithe Williams" }));
    expect(buttons(html, "Save")).toBe(1);
    expect(buttons(html, "Save and create link")).toBe(1);
    expect(html).toContain("Ready to send?");
    expect(html).toContain("What the client pays");
    expect(html).toContain("Matter and flat fee");
    expect(html).toContain('name="fee"');
    expect(html).not.toContain("What we&#x27;re protecting");
    expect(html).not.toContain('id="pe-sec-brands"');
    expect(html).not.toContain("Advanced pricing");
    expect(html).not.toContain('name="b.0.nameId"');
    expect(html).not.toMatch(/<summary[^>]*>More options/);
  });
});

describe("F7: live, accepted, replaced and withdrawn versions keep today's behaviour", () => {
  for (const status of ["sent", "accepted", "superseded", "withdrawn"] as const) {
    it(`${status}: read-only fields, no Save, Change pay link on a live link only`, async () => {
      const html = await render(row({ status }));
      expect(buttons(html, "Save")).toBe(0);
      expect(buttons(html, "Save and create link")).toBe(0);
      expect(html).toMatch(/<fieldset class="pe-fieldset" disabled/);
      expect(html.includes("Change pay link")).toBe(status === "sent");
      expect(html).toContain("What the client pays");
      expect(html).not.toContain("Ready to send?");
    });
  }

  it("a live link keeps the Withdraw menu; an accepted version gets its paid panel", async () => {
    // The menu is named for what it holds: the owner can withdraw or delete.
    expect(await render(row({ status: "sent" }))).toContain(">Withdraw or delete<");
    vi.resetModules();
    expect(await render(row({ status: "sent" }), { role: "paralegal" })).toContain(">Withdraw<");
    vi.resetModules();
    expect(await render(row({ status: "accepted" }))).toMatch(/Mark paid|Paid/);
  });

  it("a saved (approved) version can still be edited with Save, and Turn on the link stays", async () => {
    const html = await render(row({ status: "approved" }));
    expect(buttons(html, "Save")).toBe(1);
    expect(buttons(html, "Save and create link")).toBe(0);
    expect(html).toContain("Turn on the link");
  });
});

describe("V4: the Engagement letter slot renders nothing", () => {
  it("no heading, card or text for it in the five-section render", async () => {
    for (const content of [sevetri(), faithe()]) {
      const html = await render(row({ content }));
      expect(html).not.toContain("Engagement letter");
      expect(html).not.toMatch(/engagement/i);
    }
  });
});
