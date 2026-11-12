import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText, getDocumentProxy } from "unpdf";
import { findMergeFields, SAMPLE_VALUES } from "@/lib/loe/fields";
import { renderLetter, type LetterBlock } from "@/lib/loe/render";
import { loeIssues, validateTemplate } from "@/lib/loe/validate";
import {
  LETTER_STYLE_NAMES,
  hasStyle,
  letterStyleClasses,
  letterStyleProblems,
  parseParagraphStyle,
  unknownStyleSentence,
  STYLE_WITHOUT_TEXT_SENTENCE,
  EMPTY_STYLE_SENTENCE,
} from "@/lib/loe/letter-styles";
import { assembleAgreement, checkSigning, pageAgreement, pageSigningPayload, wordsOnly } from "@/lib/loe/signing";
import { agreementTextSha256, canonicalFingerprint } from "@/lib/loe/fingerprint";
import { buildExhibit } from "@/lib/loe/exhibit";
import { buildLetterPdf, INDENT_PT } from "@/lib/loe/pdf";
import { rebuildSignedLetter, signedLetterText } from "@/lib/loe/signed-letter";
import { verifySignedCopy } from "@/lib/loe/signed-text-check";
import { RPB_LETTER_LOGO } from "@/lib/loe/letter-logo";
import { money } from "@/components/client-proposal/format";
import { LetterParagraph } from "@/components/loe/LetterParagraph";
import { LoeLetterPanel } from "@/components/client-proposal/LoeLetterPanel";
import { LetterPreview } from "@/components/loe/LetterPreview";
import { PreviewBlock } from "@/components/proposal-editor/LetterSwitch";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { sevetri } from "../proposals/fixture";
import { TEST_DETAILS, fullLetterBlocks, fullLetterBody } from "./full-letter-fixture";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: vi.fn(async () => {}) }));

const VALUES = { ...SAMPLE_VALUES };

function exhibitForSevetri() {
  const content = sevetri();
  const priced = quoteWithClientClasses(content, defaultSelection(content), { entries: {}, added: {} });
  if (!priced.ok) throw new Error("no quote");
  return buildExhibit(priced.content, priced.quote, money);
}

/** The RPB letter as it was before style markers existed (first line "RPB Law, PLLC"), kept verbatim. */
function letterBeforeMarkers(): string {
  return readFileSync(join(process.cwd(), "tests", "loe", "__fixtures__", "rpb-letter-before-markers.txt"), "utf8").trim();
}

const INPUTS = { details: TEST_DETAILS, typedName: "Sevetri Wilson", dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };

describe("style markers are read from the template", () => {
  it("reads a marker on its own line, drops it from the text, and orders the styles one way", () => {
    const r = renderLetter("{center, small, rule-below}\n333 Main Street\n\nPlain paragraph.", VALUES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks[0]).toEqual({ lead: null, text: "333 Main Street", style: ["center", "small", "rule-below"] });
    // A paragraph with no marker has no `style` key at all.
    expect(r.blocks[1]).toEqual({ lead: null, text: "Plain paragraph." });
    expect("style" in r.blocks[1]).toBe(false);
    const swapped = renderLetter("{rule-below,small ,  center} 333 Main Street", VALUES);
    expect(swapped.ok && swapped.blocks[0].style).toEqual(["center", "small", "rule-below"]);
  });

  it("reads every style in the list, and a marker before a bold lead-in", () => {
    for (const name of LETTER_STYLE_NAMES) {
      const r = renderLetter(`{${name}}\nText for ${name}.`, VALUES);
      expect(r.ok && r.blocks[0].style, name).toEqual([name]);
    }
    const r = renderLetter("{indent}\n**Scope:** We file the application.", VALUES);
    expect(r.ok && r.blocks[0]).toEqual({ lead: "Scope:", text: "We file the application.", style: ["indent"] });
  });

  it("a paragraph that starts with a merge field is not a marker", () => {
    const r = renderLetter("{{date}}\n\n{{entity_name}}", VALUES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blocks).toEqual([{ lead: null, text: VALUES.date }, { lead: null, text: VALUES.entity_name }]);
    expect(parseParagraphStyle("{{date}}").marker).toBe(false);
  });

  it("a marker in the middle of a paragraph is ordinary text", () => {
    const r = renderLetter("Text first {center} then more.", VALUES);
    expect(r.ok && r.blocks[0]).toEqual({ lead: null, text: "Text first {center} then more." });
  });

  it("markers use single braces only, so the merge-field rules (and lectual 0106's approve check) never see a {{ or }}", () => {
    const body = fullLetterBody();
    const { fields, unclosed } = findMergeFields(body);
    expect(unclosed).toBe(false);
    expect(fields.every((f) => f.allowed)).toBe(true);
    // lectual 0106: every {{field}} one of the seven, and nothing left over once they are taken out.
    expect(body.replace(/\{\{[^{}]*\}\}/g, "")).not.toMatch(/\{\{|\}\}/);
    expect(validateTemplate({ title: "Engagement letter", body })).toEqual([]);
    expect(loeIssues({ kind: "trademark", title: "Engagement letter", body }, "trademark")).toEqual([]);
  });
});

describe("an unknown marker is refused (fail closed)", () => {
  it("validateTemplate names the unknown style, an empty marker and a marker with no text", () => {
    const issues = validateTemplate({ title: "T", body: "{centre}\nHello\n\n{}\nThere\n\n{bold}" });
    const messages = issues.map((i) => i.message);
    expect(messages).toContain(unknownStyleSentence("centre"));
    expect(messages).toContain(EMPTY_STYLE_SENTENCE);
    expect(messages).toContain(STYLE_WITHOUT_TEXT_SENTENCE);
    expect(issues.every((i) => i.path === "body")).toBe(true);
    expect(unknownStyleSentence("centre")).toBe("{centre} is not a letter style. Use only: center, bold, small, indent, rule-below, bold-underline-first-line, space-before.");
  });

  it("one bad name among good ones is still refused", () => {
    expect(letterStyleProblems("{center, blink}\nHello")).toEqual([unknownStyleSentence("blink")]);
  });

  it("renderLetter makes no letter from it", () => {
    const r = renderLetter("{blink}\nHello {{client_name}}", VALUES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([{ kind: "style", sentence: unknownStyleSentence("blink") }]);
  });

  it("a proposal's letter with one is a content problem", () => {
    expect(loeIssues({ kind: "trademark", title: "T", body: "{blink}\nHello" }, "trademark")).toEqual([
      { path: "loe.body", message: "The engagement letter has a paragraph style that does not exist." },
    ]);
  });

  it("the Settings preview shows the problem and no letter", () => {
    const html = renderToStaticMarkup(<LetterPreview body={"{blink}\nHello"} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("{blink} is not a letter style.");
    expect(html).not.toContain('data-testid="letter-preview"');
  });
});

describe("a value can never style anything", () => {
  const evil = "{center, bold} Mallory **Lead.** {{date}} <b>x</b>";

  it("marker text inside a value is printed literally and adds no style", () => {
    const r = renderLetter("{{client_name}}\n\nDear {{client_name}}:", { ...VALUES, client_name: evil });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks[0]).toEqual({ lead: null, text: evil });
    expect(r.blocks[1]).toEqual({ lead: null, text: `Dear ${evil}:` });
  });

  it("inside a styled paragraph the value keeps its characters and the paragraph keeps only the template's style", () => {
    const r = renderLetter("{indent}\n{{signer_name}}", { ...VALUES, signer_name: "{rule-below} Eve" });
    expect(r.ok && r.blocks[0]).toEqual({ lead: null, text: "{rule-below} Eve", style: ["indent"] });
  });

  it("the page draws it as text", () => {
    const html = renderToStaticMarkup(<LetterParagraph block={{ lead: null, text: evil }} variant="client" className="cp-letter-p" />);
    expect(html).toBe('<p class="cp-letter-p">{center, bold} Mallory **Lead.** {{date}} &lt;b&gt;x&lt;/b&gt;</p>');
  });
});

describe("the web views draw each style", () => {
  const block = (style: LetterBlock["style"], text = "Line one\nLine two", lead: string | null = null): LetterBlock => ({ lead, text, ...(style ? { style } : {}) });

  it("a block with no style is drawn exactly as before on each surface", () => {
    expect(renderToStaticMarkup(<LetterParagraph block={block(undefined, "Hello", "Scope.")} variant="client" className="cp-letter-p" />)).toBe(
      '<p class="cp-letter-p"><b>Scope. </b>Hello</p>',
    );
    expect(renderToStaticMarkup(<LetterParagraph block={block(undefined, "Hello", "Scope.")} variant="staff" />)).toBe("<p><strong>Scope.</strong> Hello</p>");
    expect(renderToStaticMarkup(<LetterParagraph block={block(undefined, "Hello")} variant="staff" />)).toBe("<p>Hello</p>");
  });

  it("each style becomes its own class", () => {
    for (const name of LETTER_STYLE_NAMES) {
      const html = renderToStaticMarkup(<LetterParagraph block={block([name])} variant="client" className="cp-letter-p" />);
      expect(html, name).toContain(`class="cp-letter-p loe-s-${name}"`);
    }
    expect(letterStyleClasses(block(["center", "bold", "space-before"]))).toBe("loe-s-center loe-s-bold loe-s-space-before");
    expect(letterStyleClasses(block(undefined))).toBeUndefined();
  });

  it("bold-underline-first-line wraps only the first line", () => {
    const html = renderToStaticMarkup(<LetterParagraph block={block(["bold-underline-first-line"], "Via Email: a@example.com\nAttention: Pat")} variant="staff" />);
    expect(html).toBe('<p class="loe-s-bold-underline-first-line"><span class="loe-s-first-line">Via Email: a@example.com</span>\nAttention: Pat</p>');
  });

  it("the client panel, the editor preview and the Settings preview all draw the RPB letter's styles", () => {
    const blocks = fullLetterBlocks();
    const panel = renderToStaticMarkup(<LoeLetterPanel agreement={{ blocks, exhibit: null }} title="Engagement letter" logo={RPB_LETTER_LOGO} />);
    const editor = renderToStaticMarkup(<PreviewBlock blocks={blocks} problems={[]} logo={RPB_LETTER_LOGO} />);
    const settings = renderToStaticMarkup(<LetterPreview body={fullLetterBody()} logo={RPB_LETTER_LOGO} />);
    for (const html of [panel, editor, settings]) {
      expect(html).toMatch(/class="[^"]*loe-s-center loe-s-small loe-s-rule-below"[^>]*>333 S\.E\. 2nd Avenue/);
      expect(html).toContain('<span class="loe-s-first-line">Via Email: ');
      expect(html).toMatch(/class="[^"]*loe-s-center loe-s-bold loe-s-space-before"[^>]*>Re: Letter of Engagement for Legal Services</);
      expect(html).toMatch(/class="[^"]*loe-s-indent"[^>]*>Sincerely yours,</);
      expect(html).toMatch(/class="[^"]*loe-s-indent loe-s-space-before"[^>]*>Rebecca P\. Beliard, Esq\.</);
      expect(html).toMatch(/class="[^"]*loe-s-center loe-s-bold"[^>]*>RPB Law, PLLC</);
      expect(html).not.toMatch(/\{(center|indent|space-before|bold-underline-first-line)/);
    }
    // The logo comes first, then the firm-name line, then the address line.
    expect(panel.indexOf("rpb-logo")).toBeLessThan(panel.indexOf("RPB Law, PLLC"));
    expect(panel.indexOf("RPB Law, PLLC")).toBeLessThan(panel.indexOf("333 S.E."));
  });
});

describe("the RPB letter: logo, address line, rule, and the words", () => {
  it("the firm-name line, then the address line, each its own paragraph; the template changed no word", () => {
    const blocks = fullLetterBlocks();
    expect(blocks[0]).toEqual({ lead: null, text: "RPB Law, PLLC", style: ["center", "bold"] });
    expect(blocks[1]).toEqual({ lead: null, text: "333 S.E. 2nd Avenue Suite 2000, Miami, FL 33131 | (305) 712-6960 | info@rpblawfirm.com", style: ["center", "small", "rule-below"] });
    expect(hasStyle(blocks[3], "bold-underline-first-line")).toBe(true);
    // Strip the markers and join the first two lines back into one paragraph: exactly the letter as it was before markers.
    const unmarked = fullLetterBody().replace(/^\{[^{}\n]*\}[ \t]*\n/gm, "");
    expect(unmarked.replace("RPB Law, PLLC\n\n", "RPB Law, PLLC\n")).toBe(letterBeforeMarkers());
  });

  it("the agreement text is the words only: the old text with the firm-name line as its own paragraph", () => {
    const exhibit = exhibitForSevetri();
    const before = assembleAgreement({ body: letterBeforeMarkers(), inputs: INPUTS, exhibit });
    const after = assembleAgreement({ body: fullLetterBody(), inputs: INPUTS, exhibit });
    if (!before.ok || !after.ok) throw new Error("no agreement");
    expect(after.agreement.text).not.toMatch(/\{(center|bold|small|indent|rule-below|space-before|bold-underline-first-line)/);
    expect(before.agreement.text.startsWith("RPB Law, PLLC\n")).toBe(true);
    expect(after.agreement.text).toBe(before.agreement.text.replace("RPB Law, PLLC\n", "RPB Law, PLLC\n\n"));
    // The canonical form covers the words only, never a style.
    expect(after.agreement.canonical).not.toContain('"style"');
  });

  it("a letter with no markers gives exactly the agreement text, canonical form and fingerprint the code gave before styles", async () => {
    // Pinned from the code at 021c352 (before style markers), over the RPB letter as it was then.
    const r = assembleAgreement({ body: letterBeforeMarkers(), inputs: INPUTS, exhibit: exhibitForSevetri() });
    if (!r.ok) throw new Error("no agreement");
    expect(r.agreement.blocks.some((b) => "style" in b)).toBe(false);
    expect(r.agreement.text.length).toBe(16552);
    expect(agreementTextSha256(r.agreement.text)).toBe("909ce0fffaa85d9e52756a466e025444012f9118a4d47a8c0d2cb8c447c1fad4");
    expect(r.agreement.canonical.length).toBe(18080);
    expect(canonicalFingerprint(r.agreement.canonical)).toBe("57bff724884b4802abbf6819cb7a75f3f114dd5de0bb9c8fdbd20a2ec0c3cdbb");
    expect(wordsOnly(r.agreement.blocks)).toEqual(r.agreement.blocks);
  });

  it("the page's fingerprint equals the server's, and the rebuilt signed letter verifies against the stored sha256", async () => {
    const exhibit = exhibitForSevetri();
    const state = { body: fullLetterBody(), details: TEST_DETAILS, typedName: "Sevetri  Wilson", dateText: "November 11, 2026", clientEmail: "sevetri@example.com", exhibit };
    const page = pageAgreement(state);
    const payload = await pageSigningPayload({ ...state, agree: true });
    if (!page || !payload) throw new Error("the page could not sign");
    expect(page.blocks.some((b) => b.style && b.style.length > 0)).toBe(true);

    // The server's side, as `signAndAccept` does it: clean, assemble with ITS date, compare fingerprints.
    const checked = checkSigning(payload);
    if (!checked.ok) throw new Error("refused");
    const server = assembleAgreement({ body: fullLetterBody(), inputs: { details: checked.details, typedName: checked.typedName, dateText: "November 12, 2026", clientEmail: "sevetri@example.com" }, exhibit });
    if (!server.ok) throw new Error("no agreement");
    expect(payload.fingerprint).toBe(canonicalFingerprint(server.agreement.canonical));

    const sha256 = agreementTextSha256(server.agreement.text);
    const content = { ...sevetri(), loe: { kind: "trademark" as const, template_id: null, template_version: 3, title: "Engagement letter", body: fullLetterBody() } };
    const priced = quoteWithClientClasses(content, defaultSelection(content), { entries: {}, added: {} });
    if (!priced.ok) throw new Error("no quote");
    const snapshot = {
      schema: 2,
      content: priced.content,
      selection: priced.selection,
      quote: priced.quote,
      accepted_at: "2026-11-12T19:14:00.000Z",
      agreement: { signature_id: "sig-1", signer_name: checked.typedName, signed_at: "2026-11-12T19:14:00.000Z", sha256, template_version: 3 },
      signing: { details: { ...checked.details }, date_text: "November 12, 2026", client_email: "sevetri@example.com" },
    } as unknown as AcceptedSnapshot;
    const rebuilt = rebuildSignedLetter(snapshot, "America/New_York");
    expect(rebuilt).not.toBeNull();
    expect(agreementTextSha256(signedLetterText(rebuilt!))).toBe(sha256);
    expect(rebuilt!.blocks[0].style).toEqual(["center", "bold"]);
    expect(rebuilt!.blocks[1].style).toEqual(["center", "small", "rule-below"]);
    const verified = await verifySignedCopy(snapshot, "America/New_York", async () => null);
    expect(verified.kind).toBe("rebuilt");
  });

  it("signs end to end through the public accept path, and the stored text carries no marker", async () => {
    const { acceptPublicProposal } = await import("@/lib/proposals/public");
    const { NOW, TOKEN, browserSigning, world } = await import("../proposals/signing-world");
    const w = world();
    const b = await browserSigning(w.db);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing, { ip: null, userAgent: null });
    expect(r.ok).toBe(true);
    const text = String(w.rpcCalls[0].args.p_agreement_text);
    expect(text.startsWith("RPB Law, PLLC\n\n333 S.E. 2nd Avenue")).toBe(true);
    expect(text).not.toMatch(/\{(center|bold|small|indent|rule-below|space-before|bold-underline-first-line)/);
    const snapshot = (w.tables.client_proposal[0] as { accepted_snapshot: AcceptedSnapshot }).accepted_snapshot;
    const verified = await verifySignedCopy(snapshot, "America/New_York", async () => ({ text, sha256: agreementTextSha256(text) }));
    expect(verified.kind).toBe("rebuilt");
  });
});

type PdfItem = { str: string; x: number; y: number; w: number; page: number };

async function pdfItems(bytes: Uint8Array): Promise<{ items: PdfItem[]; pageWidth: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const items: PdfItem[] = [];
  let pageWidth = 0;
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    pageWidth = page.getViewport({ scale: 1 }).width;
    const content = await page.getTextContent();
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      if (typeof it.str !== "string" || !it.transform) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0, page: p });
    }
  }
  return { items, pageWidth };
}

describe("the PDF draws the styles", () => {
  it("logo, then the centred address line, then the letter in order; Sincerely and the signer are indented", async () => {
    const blocks = fullLetterBlocks();
    const bytes = await buildLetterPdf({ blocks, exhibit: exhibitForSevetri(), details: TEST_DETAILS, mode: "review", firmName: "RPB Law Firm", logo: RPB_LETTER_LOGO });
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const flat = text.replace(/\s+/g, " ");
    const order = ["333 S.E. 2nd Avenue", "November 12, 2026", "Via Email: sevetri@example.com", "Re: Letter of Engagement for Legal Services", "Dear Sevetri Wilson:", "Sincerely yours,", "Rebecca P. Beliard, Esq.", "ACKNOWLEDGED AND AGREED TO:", "By: Sevetri Wilson"];
    let at = -1;
    for (const s of order) {
      const i = flat.indexOf(s, at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    // The firm's name is not printed as a letterhead line: the logo names the firm.
    expect(flat.indexOf("RPB Law Firm")).toBe(-1);

    const { items, pageWidth } = await pdfItems(bytes);
    const address = items.find((i) => i.str.startsWith("333 S.E. 2nd Avenue"));
    expect(address).toBeDefined();
    const centre = address!.x + address!.w / 2;
    expect(Math.abs(centre - pageWidth / 2)).toBeLessThan(4);
    expect(address!.x).toBeGreaterThan(64 + 10);
    const re = items.find((i) => i.str.startsWith("Re: Letter of Engagement"));
    expect(Math.abs(re!.x + re!.w / 2 - pageWidth / 2)).toBeLessThan(4);
    const dear = items.find((i) => i.str.startsWith("Dear Sevetri"));
    expect(dear!.x).toBeCloseTo(64, 0);
    const sincerely = items.find((i) => i.str.startsWith("Sincerely yours"));
    const rebecca = items.find((i) => i.str.startsWith("Rebecca P. Beliard"));
    expect(sincerely!.x).toBeCloseTo(64 + INDENT_PT, 0);
    expect(rebecca!.x).toBeCloseTo(64 + INDENT_PT, 0);
    const acknowledged = items.find((i) => i.str.startsWith("ACKNOWLEDGED"));
    expect(acknowledged!.x).toBeCloseTo(64, 0);
  });

  it("without the logo the firm-name letterhead still comes first, and the review mark and signature record are unchanged", async () => {
    const blocks = fullLetterBlocks();
    const review = await buildLetterPdf({ blocks, exhibit: exhibitForSevetri(), details: TEST_DETAILS, mode: "review", firmName: "RPB Law Firm" });
    const r = (await extractText(await getDocumentProxy(new Uint8Array(review)), { mergePages: true })).text.replace(/\s+/g, " ");
    expect(r.indexOf("RPB Law Firm")).toBeLessThan(r.indexOf("333 S.E."));
    expect(r).toContain("Review copy");
    const signed = await buildLetterPdf({
      blocks,
      exhibit: exhibitForSevetri(),
      details: TEST_DETAILS,
      mode: "signed",
      signature: { signerName: "Sevetri Wilson", signedAtText: "November 12, 2026 at 2:14 PM EST", signedAtUtc: "2026-11-12T19:14:00.000Z", fingerprint: "ab".repeat(32) },
      logo: RPB_LETTER_LOGO,
    });
    const s = (await extractText(await getDocumentProxy(new Uint8Array(signed)), { mergePages: true })).text.replace(/\s+/g, " ");
    expect(s).toContain("Signature record");
    expect(s).toContain("Signed (UTC): 2026-11-12T19:14:00.000Z");
    expect(s).not.toContain("Review copy");
  });
});
