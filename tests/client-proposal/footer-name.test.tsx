import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { GeneralProposalDocument } from "@/components/client-proposal/GeneralProposalDocument";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";
import { sevetri } from "../proposals/fixture";
import { faithe } from "../proposals/general-fixture";
import type { ProposalContent } from "@/lib/proposals/types";

/** RPB's footer line names "RPB Law Firm, PLLC" and is on EVERY state of the page, with the attorney-advertising line beside it. */
const LINE = "RPB Law Firm, PLLC &middot; (305) 712-6960".replace("&middot;", "·");
const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };
const accept = async () => ({ ok: true as const, payUrl: "https://example.com/pay" });

const footerOf = (html: string) => html.match(/<footer[\s\S]*<\/footer>/)?.[0] ?? "";

type Maker = (slug: string) => string;

function trademark(content: ProposalContent, extra: Record<string, unknown>): Maker {
  return (slug) =>
    renderToStaticMarkup(
      <ProposalDocument
        content={content}
        title="Trademark Proposal"
        clientName="Sevetri Wilson"
        expiresOn="2026-12-01"
        firm={{ name: "Some Firm", slug }}
        onAccept={accept}
        {...({ mode: "live", ...extra } as object)}
      />,
    );
}

function general(content: ProposalContent, extra: Record<string, unknown>): Maker {
  return (slug) =>
    renderToStaticMarkup(
      <GeneralProposalDocument
        content={content}
        title="Proposal"
        clientName="Faithe Williams"
        expiresOn="2026-12-01"
        firm={{ name: "Some Firm", slug }}
        onAccept={accept}
        {...({ mode: "live", ...extra } as object)}
      />,
    );
}

const accepted = (content: ProposalContent) => ({ mode: "accepted", initialSelection: defaultSelection(content), acceptedQuote: quoteProposal(content, defaultSelection(content)), payUrl: "https://example.com/pay" });

const lt = withLoe(twoBrandPerMark());
const gl = generalWithLoe();
const STATES: Array<[string, Maker]> = [
  ["trademark, no letter, live", trademark(sevetri(), {})],
  ["trademark, no letter, accepted", trademark(sevetri(), accepted(sevetri()))],
  ["trademark, letter, step 1", trademark(lt, { letter: LETTER })],
  ["trademark, letter, step 2", trademark(lt, { letter: LETTER, initialLoe: { step: 2 } })],
  ["trademark, letter, step 3", trademark(lt, { letter: LETTER, initialLoe: { step: 3, details: TEST_DETAILS } })],
  ["trademark, letter, step 4", trademark(lt, { letter: LETTER, initialLoe: { step: 4, details: TEST_DETAILS } })],
  ["trademark, letter, receipt", trademark(lt, { letter: LETTER, ...accepted(lt) })],
  ["flat fee, no letter, live", general(faithe(), {})],
  ["flat fee, no letter, accepted", general(faithe(), accepted(faithe()))],
  ["flat fee, letter, step 1", general(gl, { letter: LETTER })],
  ["flat fee, letter, step 3", general(gl, { letter: LETTER, initialLoe: { step: 3, details: TEST_DETAILS } })],
  ["flat fee, letter, receipt", general(gl, { letter: LETTER, ...accepted(gl) })],
];

describe("the footer is on every state of the client page", () => {
  for (const [name, make] of STATES) {
    it(name, () => {
      // Only the footer is looked at: the firm's own letter text (not ours to change) names "RPB Law, PLLC" higher up the page.
      const html = footerOf(make("rpb-law"));
      expect(html).toContain("<footer");
      expect(html).toContain(LINE);
      expect(html).toContain("RPB Law Firm, PLLC");
      expect(html).not.toContain("RPB Law, PLLC");
      expect(html).toContain("Attorney advertising. Prepared for discussion purposes; does not constitute legal advice or create an attorney-client relationship.");
      expect(html).toContain("not a law firm");
    });

    it(`${name}: another firm never shows RPB's line`, () => {
      const html = footerOf(make("hartwell-ip"));
      expect(html).toContain("<footer");
      expect(html).not.toContain("RPB Law");
      expect(html).not.toContain("(305) 712-6960");
    });
  }
});
