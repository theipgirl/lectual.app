import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalDetail } from "@/lib/proposals/store";
import type { ProposalRow, ProposalStatus } from "@/lib/proposals/types";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";

/**
 * Editor fixes (2026-11-12). Rendered with the REAL page and components and the data layer mocked (no database,
 * no browser), like one-screen-render.test.tsx.
 *
 * Bug 2: "This save should stay here when you hit save. The open and share link and all of that goes to the bottom
 * of the page." The lifecycle block (the link box with Copy and Open, Turn on the link, Edit again, Start a new
 * version, More) was rendered at the END of the main column, under every form, so after Save and create link the
 * actions jumped from the side column to the bottom of the page. It now sits in the side column for every status.
 *
 * Bug 4: "What the client sees should have an expand button to show full width."
 */

const ID = "66666666-6666-4666-8666-666666666666";
const SETTINGS = { pricing: { packages: [] }, approver_user_ids: ["u9"] };

function row(over: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: ID, org_id: "o", family_id: ID, version: 1, public_token: "t".repeat(43), lead_id: null, matter_id: null,
    client_name: "Sevetri Wilson", client_email: "s@example.com", title: "Trademark Proposal", status: "draft", content: sevetri(),
    expires_on: "2026-12-10", pay_url: "https://pay.example/x", source: "manual", created_by: null, updated_by: null, approved_by: null,
    approved_at: null, sent_at: null, accepted_at: null, superseded_at: null, withdrawn_at: null, accepted_selection: null, accepted_snapshot: null,
    created_at: "2026-10-18T12:00:00Z", updated_at: "2026-10-18T12:00:00Z", ...over,
  };
}

function forStatus(status: ProposalStatus): ProposalRow {
  if (status === "accepted") {
    const c = sevetri();
    const sel = defaultSelection(c);
    return row({ status, sent_at: "2026-11-01T12:00:00Z", accepted_at: "2026-11-02T12:00:00Z", accepted_selection: sel as never, accepted_snapshot: { schema: 1, content: c, selection: sel, quote: quoteProposal(c, sel) } as never });
  }
  if (status === "sent") return row({ status, sent_at: "2026-11-01T12:00:00Z" });
  return row({ status });
}

async function render(proposal: ProposalRow, role = "owner") {
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: vi.fn(async () => undefined), gateStaffAction: vi.fn(async () => null) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", role, org: { id: "o", name: "RPB Law", slug: "rpb" }, user: { id: "u" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => [{ userId: "u9", displayName: "Rebecca Cole", email: "r@example.com" }]) }));
  vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: vi.fn(async () => "https://app.example") }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposal: vi.fn(async (): Promise<ProposalDetail> => ({ proposal, versions: [], events: [] })),
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

/** [start, end) of the side column in the markup. Asides do not nest in this page. */
function sideRange(html: string): [number, number] {
  const start = html.indexOf('<aside class="pe-side"');
  expect(start, "the side column").toBeGreaterThan(-1);
  return [start, html.indexOf("</aside>", start)];
}
const inSide = (html: string, needle: string) => {
  const at = html.indexOf(needle);
  const [s, e] = sideRange(html);
  return at > s && at < e;
};

beforeEach(() => vi.resetModules());

describe("bug 2: the actions and the link box stay in the side column for every status", () => {
  for (const status of ["draft", "approved", "sent", "accepted"] as const) {
    it(status, async () => {
      const html = await render(forStatus(status));
      // the lifecycle buttons (Turn on the link, Edit again, Start a new version, More)
      expect(html).toContain('role="group" aria-label="Proposal actions"');
      expect(inSide(html, 'role="group" aria-label="Proposal actions"'), "lifecycle in the side column").toBe(true);
      // nothing of it is left in the main column
      const forms = html.slice(html.indexOf('<div class="pe-forms">'), sideRange(html)[0]);
      expect(forms).not.toContain('aria-label="Proposal actions"');
      if (status === "sent" || status === "accepted") {
        expect(inSide(html, 'class="pe-link"'), "the link box with Copy and Open").toBe(true);
        expect(html).toContain("Copy client link");
      }
      if (status === "draft" || status === "approved") {
        expect(inSide(html, "data-pe-actions"), "Preview / Save / Save and create link").toBe(true);
        // the lifecycle card follows the one actions card, so the two read as one place
        expect(html.indexOf("data-pe-lifecycle")).toBeGreaterThan(html.indexOf("data-pe-actions"));
      }
      // and both come before the preview, in the same place on every status
      expect(html.indexOf("data-pe-lifecycle")).toBeLessThan(html.indexOf('id="pe-preview"'));
    });
  }

  it("a read-only role still sees the link box in the side column", async () => {
    const html = await render(forStatus("sent"), "viewer");
    expect(inSide(html, 'class="pe-link"')).toBe(true);
  });
});

describe("bug 4: the client preview has an Expand button", () => {
  it("drawn on every status, inside the preview card's head, closed on load", async () => {
    for (const status of ["draft", "sent", "accepted"] as const) {
      const html = await render(forStatus(status));
      const head = html.slice(html.indexOf('class="pe-preview-head"'), html.indexOf('class="pe-preview-body"'));
      expect(head, status).toMatch(/<button type="button"[^>]*aria-haspopup="dialog"[^>]*>Expand<\/button>/);
      expect(html).not.toContain('role="dialog"');
      expect(html.match(/data-stub="document"/g)).toHaveLength(1);
    }
  });
});
