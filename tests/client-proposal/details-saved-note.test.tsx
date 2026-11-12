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
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/** Step 2 on the live page says, in one line, that Continue saves the address to the firm's file. Nowhere else, and nothing more. */

const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };
const esc = (s: string) => s.replace(/'/g, "&#x27;");

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law", displayName: "RPB Law Firm" }}
      mode="live"
      letter={LETTER}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      initialLoe={{ step: 2, details: TEST_DETAILS }}
      {...over}
    />,
  );
}

describe("the line under Your details", () => {
  it("is drawn on the live page with the firm's display name when the page can save the details", () => {
    const html = render({ onSaveDetails: async () => {} });
    expect(html).toContain(esc(detailsSavedNote("RPB Law Firm")));
    expect(html).toContain("cp-details-note");
  });

  it("is drawn on a flat-fee proposal's details step too", () => {
    const html = render({ content: generalWithLoe(), onSaveDetails: async () => {} });
    expect(html).toContain(esc(detailsSavedNote("RPB Law Firm")));
  });

  it("is not drawn where nothing saves the details (the staff preview, any page without the action)", () => {
    expect(render()).not.toContain("cp-details-note");
    expect(render({ mode: "preview" })).not.toContain("cp-details-note");
  });

  it("the public page passes the save action only for a proposal with a letter, bound to the token", () => {
    const page = readFileSync(join(process.cwd(), "src/app/p/[token]/page.tsx"), "utf8");
    expect(page).toMatch(/onSaveDetails=\{view\.letter \? saveDetailsAction\.bind\(null, token\) : undefined\}/);
  });
});
