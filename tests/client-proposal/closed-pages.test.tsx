import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

/**
 * Sprint 28 A/B: a closed version offers no way to add a class. Withdrawn and expired links are `closed`, which the
 * /p/ page turns into notFound() (nothing rendered, so no add-class control). A superseded version's token is the
 * family's token, so it resolves to the live or accepted view (the latter read-only). The superseded half of the
 * read is also covered against the real reader in tests/proposals/public.test.ts.
 */

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/proposals/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proposals/public")>()),
  readPublicProposal: mocks.read,
  recordProposalViewed: vi.fn(async () => {}),
}));
vi.mock("@/lib/proposals/staff-view", () => ({ isSignedInFirmMember: vi.fn(async () => true) }));
vi.mock("../../src/app/p/[token]/actions", () => ({ acceptProposalAction: vi.fn() }));

import { sevetri } from "../proposals/fixture";
import { acceptedSnapshot } from "../proposals/accepted-fixture";

const FIRM = { name: "RPB Law", slug: "rpb-law", timeZone: "America/New_York" };
const TOKEN = "t".repeat(43);

async function renderPage() {
  const { default: Page } = await import("../../src/app/p/[token]/page");
  return renderToStaticMarkup(createElement("div", null, await Page({ params: Promise.resolve({ token: TOKEN }) })));
}

beforeEach(() => {
  mocks.read.mockReset();
  mocks.notFound.mockClear();
  vi.resetModules();
});

describe("closed client proposal pages carry no add-class control", () => {
  for (const reason of ["withdrawn", "expired", "module_off"] as const) {
    it(`a ${reason} link answers notFound() and renders nothing`, async () => {
      mocks.read.mockResolvedValue({ status: "closed", reason, firm: FIRM });
      await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.notFound).toHaveBeenCalledTimes(1);
    });
  }

  it("a token with no live or withdrawn version answers notFound()", async () => {
    mocks.read.mockResolvedValue({ status: "not_found" });
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a superseded version's token resolves to the family's live view, which offers add-class", async () => {
    const content = sevetri();
    content.names[0].client_add = { max: 2 };
    mocks.read.mockResolvedValue({
      status: "ok",
      handle: { orgId: "o", proposalId: "p2" },
      view: { status: "sent", version: 2, title: "Trademark Proposal", clientName: "Sevetri Wilson", expiresOn: "2026-12-01", firm: FIRM, content, payUrl: null },
    });
    const html = await renderPage();
    expect(html).toContain("cp-add-btn");
  });

  it("the accepted view is read-only: no add-class control", async () => {
    const snap = acceptedSnapshot();
    mocks.read.mockResolvedValue({
      status: "ok",
      handle: { orgId: "o", proposalId: "p1" },
      view: { status: "accepted", version: 1, title: "Trademark Proposal", clientName: "Sevetri Wilson", expiresOn: "2026-12-01", firm: FIRM, content: snap.content, acceptedSelection: snap.selection, acceptedQuote: snap.quote, payUrl: null },
    });
    const html = await renderPage();
    expect(html).not.toContain("Add a class");
    expect(html).not.toContain("cp-add-input");
  });
});
