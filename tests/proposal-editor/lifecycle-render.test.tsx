import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { SettingsForm } from "@/components/proposal-editor/SettingsForm";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
}));
vi.mock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn() }));

const URL_ = "https://proposals.example.com/p/tok123/";
const render = (over: Partial<Parameters<typeof Lifecycle>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Lifecycle, {
      proposalId: "p1",
      status: "draft",
      version: 1,
      canWrite: true,
      isApprover: true,
      blockingErrors: 0,
      approverNames: ["Rebecca", "Taylor"],
      clientUrl: null,
      ...over,
    }),
  );

describe("Lifecycle", () => {
  it("draft + approver: one primary button, no old words, no link", () => {
    const html = render();
    expect(html).toContain("Save and create link");
    expect(html).not.toMatch(/Approve|Mark as sent|Back to draft|Client link/);
    // Withdraw lives in the More menu (closed in a static render), never as a main button.
    expect(html).toContain(">More<");
    expect(html).not.toContain(">Withdraw<");
  });

  it("draft + approver is held back while problems remain", () => {
    expect(render({ blockingErrors: 2 })).toMatch(/<button[^>]*disabled[^>]*>Save and create link/);
  });

  it("draft + non-approver names who to ask", () => {
    const html = render({ isApprover: false });
    expect(html).toContain("Ask Rebecca or Taylor to create the link");
    expect(html).not.toContain("Save and create link");
  });

  it("approved (the send step failed): Turn on the link and Edit again, no URL", () => {
    const html = render({ status: "approved" });
    expect(html).toContain("Turn on the link");
    expect(html).toContain("isn&#x27;t live yet. Turn on the link to finish.");
    expect(html).toContain("Edit again");
    expect(html).not.toMatch(/\/p\/|Client link|Copy client link/);
  });

  it("sent: link box with Copy and Open, Start a new version, Withdraw", () => {
    const html = render({ status: "sent", clientUrl: URL_ });
    expect(html).toContain("Copy client link");
    expect(html).toMatch(/<a [^>]*href="https:\/\/proposals\.example\.com\/p\/tok123\/"[^>]*>\s*Open/);
    expect(html).toContain(`value="${URL_}"`);
    expect(html).toContain("Start a new version");
    expect(html).toContain(">More<");
    expect(html).not.toContain(">Withdraw<");
    expect(html).not.toMatch(/Revise|Turn on the link|Edit again/);
  });

  it("accepted: the link box is still shown, with no lifecycle buttons", () => {
    const html = render({ status: "accepted", clientUrl: URL_ });
    expect(html).toContain("Copy client link");
    expect(html).not.toMatch(/Withdraw|Start a new version|>More</);
  });

  it("a link is never drawn for a status that is not live, even if one is passed", () => {
    for (const status of ["draft", "approved"] as const) expect(render({ status, clientUrl: URL_ })).not.toContain("Copy client link");
  });

  it("queue note: shown with a real link, no Turn on the link button", () => {
    const html = render({ status: "approved", queueNote: { text: "Goes live with its email.", queueId: "q 1" } });
    expect(html).toContain("Goes live with its email.");
    expect(html).toContain('href="/dashboard/queue/q 1"');
    expect(html).not.toContain("Turn on the link");
    const unknown = render({ status: "approved", queueNote: { text: "x", queueId: null } });
    expect(unknown).toMatch(/href="\/dashboard\/queue\/?"/);
  });
});

describe("Settings", () => {
  it("says Who may create client links", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        members: [],
        values: { approverUserIds: [], notifyEmail: "", includes: [] } as never,
      }),
    );
    expect(html).toContain("Who may create client links");
    expect(html).not.toMatch(/Who can approve|Who may approve/);
  });
});
