import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * Renders the four screens of a proposal with an engagement letter (step 1, 2, 3 and the receipt) with the FULL-length letter.
 * When LOE_RENDER_DIR is set the HTML is also written there (one file per screen) for the Playwright screenshots described in
 * the sprint handoff; the assertions run either way.
 */
const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };

function base(over: Partial<ProposalDocumentProps> = {}): ProposalDocumentProps {
  return {
    content: withLoe(twoBrandPerMark()),
    title: "Trademark Proposal",
    clientName: "Sevetri Wilson",
    expiresOn: "2026-12-01",
    firm: { name: "RPB Law", slug: "rpb-law" },
    mode: "live",
    letter: LETTER,
    onAccept: async () => ({ ok: true, payUrl: "https://example.com/pay" }),
    onDownloadReview: async () => ({ ok: false, message: "x" }),
    ...over,
  };
}

function receiptProps(): ProposalDocumentProps {
  const content = withLoe(twoBrandPerMark());
  const selection = defaultSelection(content);
  const priced = quoteWithClientClasses(content, selection, { entries: {}, added: {} }, { repair: true });
  if (!priced.ok) throw new Error("no quote");
  const snapshot = buildAcceptedSnapshot({
    version: 1,
    content: priced.content,
    selection: priced.selection,
    quote: priced.quote,
    acceptedAt: "2026-11-12T19:14:00.000Z",
    signed: {
      agreement: { signature_id: "sig-1", signer_name: "Sevetri Wilson", signed_at: "2026-11-12T19:14:00.000Z", sha256: "c".repeat(64), template_version: 3 },
      signing: { details: { ...TEST_DETAILS }, date_text: "November 12, 2026", client_email: "sevetri@example.com" },
    },
  });
  const signed = rebuildSignedLetter(snapshot, "America/New_York");
  if (!signed) throw new Error("no signed letter");
  return base({
    mode: "accepted",
    content: snapshot.content,
    initialSelection: priced.selection,
    acceptedQuote: snapshot.quote,
    payUrl: "https://example.com/pay",
    letter: { dateText: "November 12, 2026", clientEmail: "", signed },
    signedLine: signed.signedLine,
    onDownloadSigned: async () => ({ ok: false, message: "x" }),
    onDownloadReview: undefined,
    onAccept: undefined,
  });
}

const SCREENS: Array<[string, () => ProposalDocumentProps]> = [
  ["step1", () => base()],
  ["step2", () => base({ initialLoe: { step: 2 } })],
  ["step3", () => base({ initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true } })],
  ["receipt", receiptProps],
  // The live page the moment signing succeeded (no reload): the receipt with the signed download and the server's date.
  [
    "just-signed",
    () =>
      base({
        initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true },
        initialDone: { payUrl: "https://example.com/pay", opened: true, signedLine: "Signed November 13, 2026 at 10:30 AM EST by Sevetri Wilson", letterDate: "November 13, 2026" },
        onDownloadSigned: async () => ({ ok: false, message: "x" }),
      }),
  ],
];

describe("the four screens render with the full letter", () => {
  for (const [name, props] of SCREENS) {
    it(name, () => {
      const html = renderToStaticMarkup(<ProposalDocument {...props()} />);
      expect(html.length).toBeGreaterThan(5_000);
      expect(html).toContain('class="cp-side"');
      const dir = process.env.LOE_RENDER_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.html`), html);
      }
    });
  }
});
