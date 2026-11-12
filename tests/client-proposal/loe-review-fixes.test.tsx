import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import {
  DOWNLOAD_SIGNED_LABEL,
  PAYNOTE_AFTER_SIGNING,
  PAYNOTE_DOWNLOAD_ABOVE,
  PAY_LABEL,
  READ_AGAIN_LABEL,
  SIGN_LABEL,
} from "@/lib/loe/client-words";
import { commitmentSentence, generalCommitmentSentence } from "@/lib/proposals/commitment";
import { sevetri } from "../proposals/fixture";
import { faithe } from "../proposals/general-fixture";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * Review items 2 and 12, on the rendered client page.
 *
 *  2. The moment signing succeeds (no reload) the receipt offers "Download your signed letter (PDF)", and the note under it only
 *     says "You can download it above" when the button really is above it. The successful sign result is injected with
 *     `initialDone` (what `onAccept` returned), the state the page is in right after the server answered.
 * 12. A proposal that carries a letter draws NO commitment sentence (the letter and the tick are the commitment) and no "2"
 *     badge on the panel header. A proposal without a letter keeps both exactly as before.
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
const count = (html: string, needle: string) => html.split(needle).length - 1;
const slice = (html: string, from: RegExp) => html.match(from)?.[0] ?? "";

const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };
const SIGNED_LINE = "Signed November 13, 2026 at 10:30 AM EST by Sevetri Wilson";

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-12-01"
      firm={{ name: "RPB Law", slug: "rpb-law" }}
      mode="live"
      letter={LETTER}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      onDownloadReview={async () => ({ ok: false, message: "x" })}
      onDownloadSigned={async () => ({ ok: false, message: "x" })}
      {...over}
    />,
  );
}

/** The LIVE page, on step 3 with everything typed, right after `onAccept` answered ok for a signing. */
function justSigned(over: Partial<ProposalDocumentProps> = {}) {
  return render({
    initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true },
    initialDone: { payUrl: "https://example.com/pay", opened: true, signedLine: SIGNED_LINE, letterDate: "November 13, 2026", letterVerified: true },
    ...over,
  });
}

describe("item 2: the signed download is there the moment signing succeeds", () => {
  it("before signing, step 3 offers Sign and no signed download", () => {
    const html = render({ initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true } });
    expect(html).toContain(`>${SIGN_LABEL}</button>`);
    expect(html).not.toContain(DOWNLOAD_SIGNED_LABEL);
    expect(html).not.toContain(PAYNOTE_DOWNLOAD_ABOVE);
  });

  it("right after a successful sign, with no reload: the signed line, the signed download, Pay, and a true note", () => {
    const html = justSigned();
    const side = slice(html, /<aside class="cp-side"[\s\S]*?<\/aside>/);
    expect(side).toContain(SIGNED_LINE);
    expect(side).toContain(`>${DOWNLOAD_SIGNED_LABEL}</button>`);
    expect(side).toContain(`>${PAY_LABEL}</a>`);
    expect(side).toContain('href="https://example.com/pay"');
    // The note says the download is above, and it is: the button comes first.
    expect(side).toContain(`${esc(PAYNOTE_AFTER_SIGNING)} ${esc(PAYNOTE_DOWNLOAD_ABOVE)}`);
    expect(side.indexOf(DOWNLOAD_SIGNED_LABEL)).toBeLessThan(side.indexOf(PAYNOTE_DOWNLOAD_ABOVE));
    // The signing controls are gone: this is the receipt.
    expect(html).not.toContain(`>${SIGN_LABEL}</button>`);
    expect(html).toContain(READ_AGAIN_LABEL);
    expect(html).toContain("Your acceptance");
  });

  it("the letter on the just-signed page carries the date the SERVER stamped, not the date the page was opened with", () => {
    const html = justSigned();
    const again = slice(html, /<section class="cp-signed-letter"[\s\S]*?<\/section>/);
    expect(again).toContain("November 13, 2026");
    expect(again).not.toContain("November 12, 2026");
    expect(again).toContain("Dear Sevetri Wilson:");
  });

  it("the note never claims a download that is not drawn", () => {
    const html = justSigned({ onDownloadSigned: undefined });
    const side = slice(html, /<aside class="cp-side"[\s\S]*?<\/aside>/);
    expect(side).not.toContain(DOWNLOAD_SIGNED_LABEL);
    expect(side).toContain(esc(PAYNOTE_AFTER_SIGNING));
    expect(side).not.toContain(PAYNOTE_DOWNLOAD_ABOVE);
    expect(PAYNOTE_AFTER_SIGNING).not.toMatch(/download/i);
  });

  it("a flat-fee proposal with a letter does the same", () => {
    const html = justSigned({ content: generalWithLoe(), title: "Proposal", clientName: "Faithe Williams" });
    const side = slice(html, /<aside class="cp-side"[\s\S]*?<\/aside>/);
    expect(side).toContain(`>${DOWNLOAD_SIGNED_LABEL}</button>`);
    expect(side).toContain(`${esc(PAYNOTE_AFTER_SIGNING)} ${esc(PAYNOTE_DOWNLOAD_ABOVE)}`);
    expect(slice(html, /<section class="cp-signed-letter"[\s\S]*?<\/section>/)).toContain("November 13, 2026");
  });

  it("the public page hands the LIVE page the signed-download action too (token-bound), so no reload is needed", () => {
    const page = readFileSync(join(process.cwd(), "src/app/p/[token]/page.tsx"), "utf8");
    const live = page.slice(page.lastIndexOf('mode="live"'));
    expect(live).toMatch(/onDownloadSigned=\{view\.letter \? downloadSignedLetterAction\.bind\(null, token\) : undefined\}/);
    expect(live).toMatch(/onDownloadReview=/);
  });

  it("the page does not need router.refresh or a reload to show the receipt: `done` state alone switches it", () => {
    for (const f of ["ProposalDocument.tsx", "GeneralProposalDocument.tsx", "LoeSideAction.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/components/client-proposal", f), "utf8");
      expect(src, f).not.toMatch(/location\.reload|router\.refresh/);
    }
    const side = readFileSync(join(process.cwd(), "src/components/client-proposal/LoeSideAction.tsx"), "utf8");
    expect(side).toMatch(/p\.onDownloadSigned \? ` \$\{PAYNOTE_DOWNLOAD_ABOVE\}` : ""/);
  });
});

describe("item 12: no commitment sentence and no '2' badge on a proposal that carries a letter", () => {
  const SENTENCE = esc(commitmentSentence("RPB Law"));
  const GENERAL_SENTENCE = esc(generalCommitmentSentence("RPB Law"));
  const header = (html: string) => slice(html, /<div class="cp-panel-h">[\s\S]*?<\/div>/);

  const letterStates: Array<[string, () => string]> = [
    ["step 1", () => render()],
    ["step 2", () => render({ initialLoe: { step: 2, details: TEST_DETAILS } })],
    ["step 3", () => render({ initialLoe: { step: 3, details: TEST_DETAILS } })],
    ["the receipt just after signing", () => justSigned()],
    ["the staff preview", () => render({ mode: "preview", onAccept: undefined })],
  ];
  for (const [label, make] of letterStates) {
    it(`trademark, ${label}: no commitment sentence anywhere, no number badge, the heading kept`, () => {
      const html = make();
      expect(html).not.toContain("By accepting, you agree");
      expect(html).not.toContain(SENTENCE);
      expect(html).not.toContain('class="cp-commit"');
      expect(html).not.toContain("get an engagement letter to sign");
      const h = header(html);
      expect(h).not.toBe("");
      expect(h).not.toContain('class="cp-n"');
      expect(h).toMatch(/<h2 id="cp-s2">(Review and accept|Your acceptance)<\/h2>/);
      // The phone bar carries the total and a link, and no sentence.
      const bar = slice(html, /<div class="cp-bar">[\s\S]*?<\/div><\/div>/);
      expect(bar).not.toBe("");
      expect(bar).not.toContain("By accepting");
    });
  }

  it("flat-fee with a letter: the same on every step", () => {
    for (const step of [1, 2, 3] as const) {
      const html = render({ content: generalWithLoe(), title: "Proposal", clientName: "Faithe Williams", initialLoe: { step, details: TEST_DETAILS } });
      expect(html).not.toContain("By accepting, you agree");
      expect(html).not.toContain(GENERAL_SENTENCE);
      expect(html).not.toContain('class="cp-commit"');
      expect(header(html)).not.toContain('class="cp-n"');
      expect(header(html)).toContain("Review and accept");
    }
  });

  it("no replacement sentence was written in its place: the panel goes from the totals straight to the button", () => {
    const html = render();
    const afterTotals = html.slice(html.indexOf('class="cp-tot"'));
    const action = afterTotals.slice(afterTotals.indexOf("</div></div></div>") + "</div></div></div>".length);
    expect(action.startsWith('<button type="button" class="cp-btn"')).toBe(true);
  });

  it("the four numbered steps above keep their numbers; only the panel's badge is dropped", () => {
    const html = render();
    expect(count(html, '<li class="cp-step ')).toBe(4);
  });

  it("a trademark proposal WITHOUT a letter keeps the sentence and the '2' badge exactly as before", () => {
    const html = render({ content: sevetri(), letter: undefined, onDownloadReview: undefined, onDownloadSigned: undefined });
    expect(html).toContain(`<p class="cp-commit">${SENTENCE}</p>`);
    expect(header(html)).toBe('<div class="cp-panel-h"><span class="cp-n" aria-hidden="true">2</span><h2 id="cp-s2">Review and accept</h2></div>');
  });

  it("a flat-fee proposal WITHOUT a letter keeps them too", () => {
    const html = render({ content: faithe(), title: "Proposal", clientName: "Faithe Williams", letter: undefined, onDownloadReview: undefined, onDownloadSigned: undefined });
    expect(html).toContain(`<p class="cp-commit">${GENERAL_SENTENCE}</p>`);
    expect(header(html)).toBe('<div class="cp-panel-h"><span class="cp-n" aria-hidden="true">2</span><h2 id="cp-s2">Review and accept</h2></div>');
  });

  it("the side action component has no commitment prop at all", () => {
    const side = readFileSync(join(process.cwd(), "src/components/client-proposal/LoeSideAction.tsx"), "utf8");
    expect(side).not.toMatch(/commitment[?]?:|p\.commitment/);
    expect(side).not.toMatch(/cp-commit/);
    for (const f of ["ProposalDocument.tsx", "GeneralProposalDocument.tsx"]) {
      const doc = readFileSync(join(process.cwd(), "src/components/client-proposal", f), "utf8");
      const call = doc.slice(doc.indexOf("<LoeSideAction"), doc.indexOf("/>", doc.indexOf("<LoeSideAction")));
      expect(call, f).not.toMatch(/commitment/i);
    }
  });
});
