import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { buildAcceptedSnapshot } from "@/lib/proposals/public";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { STEP_NAMES, SIGN_LABEL, READ_LETTER_FIRST, CONTINUE_LABEL, DOWNLOAD_SIGNED_LABEL, READ_AGAIN_LABEL, PAY_LABEL, FOOTER_LETTER_LINE, PAYNOTE_BEFORE_SIGNING } from "@/lib/loe/client-words";
import { sevetri } from "../proposals/fixture";
import { danielle } from "../proposals/danielle-fixture";
import { TEST_DETAILS, fullLetterBlocks, fullLetterBody, paragraphText } from "../loe/full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/** React's text escaping, so a paragraph can be looked for in the markup. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };

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
      {...over}
    />,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const between = (html: string, from: RegExp) => html.match(from)?.[0] ?? "";

describe("step 1 is today's page", () => {
  it("keeps the totals panel and the includes table exactly as the page without a letter draws them", () => {
    const withLetter = render();
    const without = render({ content: twoBrandPerMark(), letter: undefined, onDownloadReview: undefined });
    const totals = /<div class="cp-lines">[\s\S]*?<p class="cp-commit">/;
    expect(between(withLetter, totals)).not.toBe("");
    expect(between(withLetter, totals)).toBe(between(without, totals));
    const includes = /<section class="cp-inc"[\s\S]*?<\/section>/;
    expect(between(withLetter, includes)).not.toBe("");
    expect(between(withLetter, includes)).toBe(between(without, includes));
    // The same brand cards and the intro.
    expect(between(withLetter, /<section class="cp-intro">[\s\S]*?<\/section>/)).toBe(between(without, /<section class="cp-intro">[\s\S]*?<\/section>/));
    expect(between(withLetter, /<div class="cp-cards">[\s\S]*?<\/section>/)).toBe(between(without, /<div class="cp-cards">[\s\S]*?<\/section>/));
  });

  it("shows four steps, Continue, and 'Read the engagement letter first'", () => {
    const html = render();
    for (const name of STEP_NAMES) expect(html).toContain(`<span>${name}</span>`);
    expect(count(html, "<li class=\"cp-step ")).toBe(4);
    expect(html).toMatch(/<li class="cp-step cp-step-current" aria-current="step">/);
    expect(html).toContain(READ_LETTER_FIRST);
    expect(html).toContain(`>${CONTINUE_LABEL}</button>`);
    expect(html).not.toContain("Accept and pay my legal fee");
  });

  it("does not show the two old sentences, and carries the replacement footer line", () => {
    const html = render();
    expect(html).not.toContain("we&rsquo;ll send your engagement agreement");
    expect(html).not.toContain("send your engagement agreement for review and signature");
    const footer = between(html, /<footer[\s\S]*<\/footer>/);
    expect(footer).not.toContain("create an attorney-client relationship");
    expect(footer).toContain(esc(FOOTER_LETTER_LINE));
    expect(html).toContain(esc(PAYNOTE_BEFORE_SIGNING));
    // Lectual's own line stays.
    expect(html).toContain("not a law firm");
  });

  it("the letter before signing is in the page too, with the details still to come in brackets", () => {
    const html = render();
    expect(html).toContain('id="cp-letter-preview"');
    expect(html).toContain("[your address]");
  });
});

describe("every step keeps the totals panel and the phone bar", () => {
  const steps = [1, 2, 3] as const;
  for (const step of steps) {
    it(`step ${step}`, () => {
      const html = render({ initialLoe: { step, details: TEST_DETAILS } });
      expect(count(html, 'class="cp-side"')).toBe(1);
      expect(html).toContain("Legal fee due now");
      expect(html).toContain("USPTO filing fees, due at filing");
      expect(count(html, 'class="cp-bar"')).toBe(1);
      const totals = between(html, /<div class="cp-lines">[\s\S]*?<div class="cp-tot">[\s\S]*?<\/div><\/div><\/div>/);
      const baseline = between(render(), /<div class="cp-lines">[\s\S]*?<div class="cp-tot">[\s\S]*?<\/div><\/div><\/div>/);
      expect(totals).toBe(baseline);
    });
  }
});

describe("step 2: your details", () => {
  it("prefills the name and company from what the firm entered and links back to the includes table", () => {
    const content = withLoe(twoBrandPerMark());
    content.client = { ...content.client, company: "Prosperall Inc." };
    const html = render({ content, initialLoe: { step: 2 } });
    expect(html).toContain('value="Sevetri Wilson"');
    expect(html).toContain('value="Prosperall Inc."');
    expect(html).toContain('href="#cp-h-inc"');
    expect(html).toContain("Street address");
    // The step's button is disabled until the name, street and city are given.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
    // The target of the link exists on step 1.
    expect(render()).toContain('id="cp-h-inc"');
  });

  it("Continue is enabled once the details are complete", () => {
    const html = render({ initialLoe: { step: 2, details: TEST_DETAILS } });
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
    expect(html).toMatch(/<button type="button" class="cp-btn">Continue<\/button>/);
  });
});

describe("step 3: the engagement letter", () => {
  const html = render({ initialLoe: { step: 3, details: TEST_DETAILS } });
  const blocks = fullLetterBlocks();

  it("shows every paragraph of the full letter, in order, with the details merged in, then Exhibit A", () => {
    expect(blocks.length).toBeGreaterThan(20);
    let at = html.indexOf('class="cp-letter"');
    expect(at).toBeGreaterThan(-1);
    for (const b of blocks) {
      if (b.lead) {
        const li = html.indexOf(`<b>${esc(b.lead)} </b>`, at);
        expect(li, `lead-in ${b.lead}`).toBeGreaterThan(-1);
        at = li;
      }
      const ti = html.indexOf(esc(b.text), at);
      expect(ti, paragraphText(b).slice(0, 50)).toBeGreaterThan(-1);
      at = ti;
    }
    const exhibit = html.indexOf("Exhibit A: Fee Structure and Estimated Costs", at);
    expect(exhibit).toBeGreaterThan(at);
    // Nothing is collapsed or summarised: the first and the last paragraph.
    expect(html).toContain(esc(blocks[0].text));
    expect(html).toContain(esc(blocks[blocks.length - 1].text));
    expect(html).toContain("Dear Sevetri Wilson:");
    expect(html).toContain("100 Example Street");
    expect(html).toContain("November 12, 2026");
    expect(html).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(fullLetterBody().length).toBeGreaterThan(10_000);
  });

  it("holds only the lead-ins the letter has, each once in the letter panel", () => {
    const letter = between(html, /<div class="cp-letter"[\s\S]*?<section class="cp-exhibit"/);
    for (const b of blocks.filter((x) => x.lead)) expect(letter).toContain(`<b>${esc(b.lead!)} </b>`);
  });

  it("Exhibit A lists the selected marks and the exact figures", () => {
    expect(html).toContain("The Fold");
    expect(html).toContain("The Confidence Interval");
    expect(html).toContain("Legal fee due now");
    expect(html).toContain("USPTO filing fees, due at filing");
  });

  it("offers the review PDF and a link back to the includes table", () => {
    expect(html).toContain("Download the letter (PDF)");
    expect(html).toContain('href="#cp-h-inc"');
  });

  it("Sign and continue to payment is disabled until the name is typed and the box ticked", () => {
    const disabled = /<button[^>]*disabled[^>]*>Sign and continue to payment<\/button>/;
    expect(html).toMatch(disabled);
    expect(render({ initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson" } })).toMatch(disabled);
    expect(render({ initialLoe: { step: 3, details: TEST_DETAILS, agree: true } })).toMatch(disabled);
    const ready = render({ initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true } });
    expect(ready).not.toMatch(disabled);
    expect(ready).toContain(`>${SIGN_LABEL}</button>`);
    expect(ready).toContain('value="Sevetri Wilson"');
  });

  it("shows the recording notice and the agreement tick", () => {
    expect(html).toContain("I have read and agree to this engagement letter");
    expect(html).toContain("When you sign, we record your typed name");
  });

  it("draws what a client typed as text, never markup", () => {
    const evil = { ...TEST_DETAILS, client_name: "<img src=x onerror=alert(1)> Alex", street: "1 <script>alert(1)</script> Main St" };
    const out = render({ initialLoe: { step: 3, details: evil, typedName: "<b>Alex</b>" } });
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("img src=x onerror=alert(1) Alex");
  });
});

describe("the receipt after signing", () => {
  function receipt(content = withLoe(twoBrandPerMark())) {
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
    return { snapshot, signed, selection: priced.selection };
  }

  it("shows the signed line, the signed PDF, Read it again from the snapshot and the pay button, with the totals still there", () => {
    const r = receipt();
    const html = render({
      mode: "accepted",
      content: r.snapshot.content,
      initialSelection: r.selection,
      acceptedQuote: r.snapshot.quote,
      payUrl: "https://example.com/pay",
      letter: { dateText: "November 12, 2026", clientEmail: "", signed: r.signed },
      signedLine: r.signed.signedLine,
      onDownloadSigned: async () => ({ ok: false, message: "x" }),
      onDownloadReview: undefined,
      onAccept: undefined,
    });
    expect(html).toContain("Signed November 12, 2026 at 2:14 PM by Sevetri Wilson");
    expect(html).toContain(DOWNLOAD_SIGNED_LABEL);
    expect(html).toContain(READ_AGAIN_LABEL);
    expect(html).toContain(`>${PAY_LABEL}</a>`);
    expect(html).toContain('href="https://example.com/pay"');
    expect(count(html, 'class="cp-side"')).toBe(1);
    expect(html).toContain("Legal fee due now");
    // The letter as signed, in full, from the snapshot.
    for (const b of r.signed.blocks) expect(html).toContain(esc(b.text));
    expect(html).toContain("Exhibit A: Fee Structure and Estimated Costs");
    // No print view, no old sentence.
    expect(html).not.toMatch(/print/i);
    expect(html).not.toContain("send your engagement agreement for review and signature");
  });

  it("'Read it again' is the letter AS SIGNED: it does not follow a changed letter in the content", () => {
    const r = receipt();
    const changed = { ...r.snapshot, content: { ...r.snapshot.content, loe: { ...r.snapshot.content.loe!, body: "A different letter for {{client_name}}." } } };
    expect(rebuildSignedLetter(r.snapshot, "UTC")!.blocks).toEqual(r.signed.blocks);
    expect(rebuildSignedLetter(changed, "UTC")!.blocks).not.toEqual(r.signed.blocks);
  });
});

describe("a flat-fee proposal with a letter", () => {
  it("steps through the same four steps with the matter, the work and the fee in the exhibit and no USPTO line", () => {
    const content = generalWithLoe();
    const one = render({ content, title: "Proposal", clientName: "Faithe Williams", onDownloadReview: undefined });
    expect(one).toContain(`>${CONTINUE_LABEL}</button>`);
    expect(count(one, "<li class=\"cp-step ")).toBe(4);
    const three = render({ content, clientName: "Faithe Williams", initialLoe: { step: 3, details: TEST_DETAILS } });
    expect(three).toContain("Exhibit A: Fee Structure and Estimated Costs");
    expect(three).toContain("Review both management agreements");
    expect(three).toContain("Flat fee");
    const exhibit = between(three, /<section class="cp-exhibit"[\s\S]*?<\/section>/);
    expect(exhibit).toContain("Flat fee");
    expect(exhibit).not.toContain("USPTO");
    expect(three).not.toContain("USPTO filing fees, due at filing");
    expect(count(three, 'class="cp-side"')).toBe(1);
  });
});

describe("content without a letter", () => {
  it("shows none of the steps", () => {
    for (const content of [sevetri(), danielle()]) {
      const html = render({ content, letter: undefined, onDownloadReview: undefined });
      expect(html).not.toContain("cp-steps");
      expect(html).toContain("Accept and pay my legal fee");
      expect(html).not.toContain(READ_LETTER_FIRST);
    }
  });
});
