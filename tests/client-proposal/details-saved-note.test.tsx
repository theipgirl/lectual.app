import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { detailsSavedNote } from "@/lib/loe/client-words";
import { showsSavedNote } from "@/components/client-proposal/loe-flow";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * Step 2 on the live page says, in one line, that Continue saves the address to the firm's file, ONLY when the public read says the
 * firm has an active Lawmatics connection (`firm.savesAddressToLawmatics`). Nowhere else, and nothing more.
 */

const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };
const esc = (s: string) => s.replace(/'/g, "&#x27;");

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law", displayName: "RPB Law Firm", savesAddressToLawmatics: true }}
      mode="live"
      letter={LETTER}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      initialLoe={{ step: 2, details: TEST_DETAILS }}
      {...over}
    />,
  );
}

const NO_CONNECTION = { name: "RPB Law", slug: "rpb-law", displayName: "RPB Law Firm", savesAddressToLawmatics: false };

describe("the line under Your details", () => {
  it("is drawn on the live page with the firm's display name when the firm has an active connection and the page can save", () => {
    const html = render({ onSaveDetails: async () => {} });
    expect(html).toContain(esc(detailsSavedNote("RPB Law Firm")));
    expect(html).toContain("cp-details-note");
  });

  it("is drawn on a flat-fee proposal's details step too", () => {
    const html = render({ content: generalWithLoe(), onSaveDetails: async () => {} });
    expect(html).toContain(esc(detailsSavedNote("RPB Law Firm")));
  });

  it("is NOT drawn when the firm has no active Lawmatics connection (or it couldn't be read), on either kind of proposal", () => {
    expect(render({ firm: NO_CONNECTION, onSaveDetails: async () => {} })).not.toContain("cp-details-note");
    expect(render({ firm: { name: "RPB Law", slug: "rpb-law" }, onSaveDetails: async () => {} })).not.toContain("cp-details-note");
    expect(render({ content: generalWithLoe(), firm: NO_CONNECTION, onSaveDetails: async () => {} })).not.toContain("cp-details-note");
  });

  it("is not drawn where nothing saves the details (the staff preview, any page without the action)", () => {
    expect(render()).not.toContain("cp-details-note");
    expect(render({ mode: "preview", onSaveDetails: async () => {} })).not.toContain("cp-details-note");
  });

  it("the rule: live page, a save action, and the flag exactly true", () => {
    const save = async () => {};
    expect(showsSavedNote("live", { savesAddressToLawmatics: true }, save)).toBe(true);
    expect(showsSavedNote("live", { savesAddressToLawmatics: false }, save)).toBe(false);
    expect(showsSavedNote("live", {}, save)).toBe(false);
    expect(showsSavedNote("preview", { savesAddressToLawmatics: true }, save)).toBe(false);
    expect(showsSavedNote("live", { savesAddressToLawmatics: true }, undefined)).toBe(false);
  });

  it("the public page passes the save action for a letter proposal and the firm's flag, a boolean, from the read", () => {
    const page = readFileSync(join(process.cwd(), "src/app/p/[token]/page.tsx"), "utf8");
    expect(page).toMatch(/onSaveDetails=\{view\.letter \? saveDetailsAction\.bind\(null, token\) : undefined\}/);
    expect(page).toMatch(/savesAddressToLawmatics: view\.firm\.savesAddressToLawmatics/);
  });
});
