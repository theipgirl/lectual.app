import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FIRST_PROBLEM_ID, firstProblem, groupIssues } from "@/lib/proposal-editor/issues";
import { IssueList } from "@/components/proposal-editor/ActionForm";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { DRAFT_EMAIL_SENTENCES } from "@/lib/proposal-editor/draft-email";
import type { ValidationIssue } from "@/lib/proposals/validate";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  draftClientEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
}));

const URL_ = "https://proposals.example.com/p/tok123/";
const life = (over: Partial<Parameters<typeof Lifecycle>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Lifecycle, { proposalId: "p1", status: "draft", version: 1, canWrite: true, isApprover: true, blockingErrors: 0, approverNames: [], clientUrl: null, ...over }),
  );
const page = readFileSync("src/app/dashboard/proposals/[id]/page.tsx", "utf8");

describe("F9: Draft email to client in the editor", () => {
  it("shows the button and the not-emailed sentence once the link is live", () => {
    for (const status of ["sent", "accepted"] as const) {
      const html = life({ status, clientUrl: URL_ }).replaceAll("&#x27;", "'");
      expect(html).toContain("Draft email to client");
      expect(html).toContain(DRAFT_EMAIL_SENTENCES.notEmailed);
    }
    expect(DRAFT_EMAIL_SENTENCES.notEmailed).toBe("The client hasn't been emailed by Lectual.");
  });
  it("has no button for draft or saved versions", () => {
    for (const status of ["draft", "approved"] as const) expect(life({ status, clientUrl: null })).not.toContain("Draft email to client");
  });
  it("a viewer sees the sentence but no button", () => {
    const html = life({ status: "sent", clientUrl: URL_, canWrite: false }).replaceAll("&#x27;", "'");
    expect(html).not.toContain("Draft email to client");
    expect(html).toContain(DRAFT_EMAIL_SENTENCES.notEmailed);
  });
});

describe("F10/P2: Withdraw in a More menu with a confirm", () => {
  it("Withdraw is not a main button", () => {
    const html = life({ status: "sent", clientUrl: URL_ });
    expect(html).toContain(">More<");
    expect(html).not.toContain(">Withdraw<");
  });
  it("the menu is the shared Popover (Esc / outside click) and the confirm has an explicit Cancel", () => {
    const src = readFileSync("src/components/proposal-editor/Lifecycle.tsx", "utf8");
    expect(src).toContain("Popover");
    expect(src).toMatch(/onClick=\{\(\) => setConfirming\(false\)\}[\s\S]*Cancel/);
    expect(src).toContain("Yes, withdraw");
  });
  it("Go to first problem points at the first issue's list item", () => {
    const issues: ValidationIssue[] = [
      { level: "warning", path: "greeting", message: "w" },
      { level: "error", path: "pricing.base_cents", message: "e2" },
      { level: "error", path: "title", message: "e1" },
    ] as ValidationIssue[];
    const first = firstProblem(groupIssues(issues));
    expect(first?.message).toBe("e1"); // errors first, in page order (who before package)
    const html = renderToStaticMarkup(createElement(IssueList, { issues: [{ level: "error", message: "e1", where: "title", anchor: true }, { level: "warning", message: "w", where: "" }] }));
    expect(html.match(new RegExp(`id="${FIRST_PROBLEM_ID}"`, "g"))).toHaveLength(1);
    expect(page).toContain("Go to first problem");
    expect(page).toContain("#${FIRST_PROBLEM_ID}");
  });
  it("no problems, no first problem", () => {
    expect(firstProblem(groupIssues([]))).toBeNull();
  });
});

describe("F10: one totals box, one History card, header links, tab title", () => {
  it("drops the pre-ticked wording and the card's duplicate fees", () => {
    expect(page).not.toContain("pre-ticked offer");
    expect(page).toContain("showFees={false}");
    expect(page.match(/className="lx-card pe-totals"/g)?.length).toBe(2); // the totals box and the accepted record, not a third summary
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
