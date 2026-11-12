import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { MANUAL_EMAIL_LABEL, NOT_EMAILED } from "@/lib/consult-proposal/manual-email";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
  resetAcceptanceAction: vi.fn(),
  deleteProposalAction: vi.fn(),
}));

const URL_ = "https://proposals.example.com/p/tok123/";
const life = (over: Partial<Parameters<typeof Lifecycle>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Lifecycle, { proposalId: "p1", status: "draft", version: 1, canWrite: true, clientUrl: null, ...over }),
  );
const page = readFileSync("src/app/dashboard/proposals/[id]/page.tsx", "utf8");

describe("F9 + PR #4: the one client-email button in the editor", () => {
  it("shows the button and the not-emailed sentence once the link is live", () => {
    for (const status of ["sent", "accepted"] as const) {
      const html = life({ status, clientUrl: URL_ }).replaceAll("&#x27;", "'");
      expect(html).toContain(MANUAL_EMAIL_LABEL);
      expect(html).toContain(NOT_EMAILED);
    }
    expect(NOT_EMAILED).toBe("The client hasn't been emailed by Lectual.");
  });
  it("has no button for draft or saved versions", () => {
    for (const status of ["draft", "approved"] as const) expect(life({ status, clientUrl: null })).not.toContain(MANUAL_EMAIL_LABEL);
  });
  it("a viewer sees the sentence but no button", () => {
    const html = life({ status: "sent", clientUrl: URL_, canWrite: false }).replaceAll("&#x27;", "'");
    expect(html).not.toContain(MANUAL_EMAIL_LABEL);
    expect(html).toContain(NOT_EMAILED);
  });
});

describe("F10/P2: Withdraw in a More menu with a confirm", () => {
  it("Withdraw is a menu with a confirm, not a main button", () => {
    const html = life({ status: "sent", clientUrl: URL_ });
    // Sprint 1: the menu is named for what it holds; the confirm stays closed until it is chosen.
    expect(html).toContain(">Withdraw<");
    expect(html).not.toContain("Withdraw this version?");
  });
  it("the menu is the shared Popover (Esc / outside click) and the confirm has an explicit Cancel", () => {
    const src = readFileSync("src/components/proposal-editor/Lifecycle.tsx", "utf8");
    expect(src).toContain("Popover");
    expect(src).toMatch(/onClick=\{\(\) => setConfirming\(null\)\}[\s\S]*Cancel/);
    expect(src).toContain("Yes, withdraw");
  });
});

describe("F10: one totals box, one History card, header links, tab title", () => {
  it("drops the pre-ticked wording and the card's duplicate fees", () => {
    expect(page).not.toContain("pre-ticked offer");
    // Sprint 1: the glance card is gone and the totals box (PayBox) is the one place the fees are listed.
    expect(page).not.toContain("<ProposalCard");
    expect(page).not.toContain("components/proposal-editor/ProposalCard");
    expect(page).toContain("<PayBox");
    expect(page.match(/className="lx-card pe-totals"/g)?.length).toBe(1); // the accepted record, not a second summary
  });
  it("merges Versions and Activity into History", () => {
    expect(page).toContain('aria-label="History"');
    expect(page).not.toContain('aria-label="Versions"');
    expect(page).not.toContain('aria-label="Activity"');
    expect(page).toContain(">History<");
  });
  it("tab title is the client name with the Proposal fallback", () => {
    expect(page).toContain("generateMetadata");
    expect(page).toMatch(/client_name\?\.trim\(\) \|\| null, "Proposal"/);
  });
  it("uses one name for the area", () => {
    expect(page).toContain("← {PROPOSALS_NAME}");
    expect(page).not.toContain("Client proposals");
  });
});
