import { describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { GeneralProposalDocument } from "@/components/client-proposal/GeneralProposalDocument";
import { LoeSignedLetter } from "@/components/client-proposal/LoeReceipt";
import { LoeLetterPanel } from "@/components/client-proposal/LoeLetterPanel";
import { LetterPreview } from "@/components/loe/LetterPreview";
import { PreviewBlock } from "@/components/proposal-editor/LetterSwitch";
import { RPB_LETTER_LOGO, letterLogoForBrand, letterLogoForSlug } from "@/lib/loe/letter-logo";
import { buildLetterPdf, loadLogoBytes } from "@/lib/loe/pdf";
import { buildVerifiedSignedPdf } from "@/lib/loe/signed-pdf";
import { reviewLetterPdf } from "@/lib/proposals/public-letter";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { buildExhibit } from "@/lib/loe/exhibit";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";
import { TEST_DETAILS, fullLetterBlocks } from "./full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "./loe-fixtures";
import { NOW, world } from "../proposals/signing-world";
import { signedTrademark } from "./signed-fixtures";

const LOGO_IMG = 'src="/brand/rpb-logo-oxblood.png"';
const LETTER = { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" };

function render(slug: string, over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-12-01"
      firm={{ name: "Some Firm", slug }}
      mode="live"
      letter={LETTER}
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      onDownloadReview={async () => ({ ok: false, message: "x" })}
      {...over}
    />,
  );
}

describe("the letter logo map", () => {
  it("is RPB's oxblood file under /brand/, which exists on disk, and nobody else's", () => {
    expect(RPB_LETTER_LOGO.src).toBe("/brand/rpb-logo-oxblood.png");
    expect(RPB_LETTER_LOGO.alt).toBe("RPB Law Firm");
    expect(existsSync(join(process.cwd(), "public", RPB_LETTER_LOGO.src))).toBe(true);
    expect(letterLogoForSlug("rpb-law")).toEqual(RPB_LETTER_LOGO);
    expect(letterLogoForBrand("rpb")).toEqual(RPB_LETTER_LOGO);
    for (const other of ["hartwell-ip", "cabanis-law", "", null, undefined]) expect(letterLogoForSlug(other)).toBeNull();
    expect(letterLogoForBrand("neutral")).toBeNull();
  });

  it("a missing or non-/brand/ file reads as no logo, never an error", () => {
    expect(loadLogoBytes({ src: "/brand/not-there.png", alt: "x" })).toBeNull();
    expect(loadLogoBytes({ src: "/etc/passwd", alt: "x" })).toBeNull();
    expect(loadLogoBytes({ src: "/brand/../package.json", alt: "x" })).toBeNull();
    expect(loadLogoBytes(null)).toBeNull();
    expect(loadLogoBytes(RPB_LETTER_LOGO)?.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("the client page draws the logo above the letter for RPB only", () => {
  it("the letter step and the letter-first preview carry the logo; another firm's page has none", () => {
    const rpb3 = render("rpb-law", { initialLoe: { step: 3, details: TEST_DETAILS } });
    expect(rpb3).toContain(LOGO_IMG);
    expect(rpb3).toContain('alt="RPB Law Firm"');
    expect(rpb3).toMatch(/<div class="cp-letter" id="cp-letter"[^>]*><img class="cp-letter-logo"/);
    const rpb1 = render("rpb-law");
    expect(rpb1).toMatch(/id="cp-letter-preview"[\s\S]*?<img class="cp-letter-logo"/);
    const other3 = render("hartwell-ip", { initialLoe: { step: 3, details: TEST_DETAILS } });
    expect(other3).not.toContain("rpb-logo-oxblood");
    expect(other3).not.toContain("cp-letter-logo");
    expect(render("hartwell-ip")).not.toContain("cp-letter-logo");
  });

  it("a flat-fee proposal draws it the same way", () => {
    const general = (slug: string) =>
      renderToStaticMarkup(
        <GeneralProposalDocument
          content={generalWithLoe()}
          title="Proposal"
          clientName="Faithe Williams"
          expiresOn="2026-12-01"
          firm={{ name: "Some Firm", slug }}
          mode="live"
          letter={LETTER}
          initialLoe={{ step: 3, details: TEST_DETAILS }}
          onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
        />,
      );
    expect(general("rpb-law")).toContain(LOGO_IMG);
    expect(general("hartwell-ip")).not.toContain("cp-letter-logo");
  });

  it("'Read it again' and the letter panel take the logo as a prop and draw nothing without it", () => {
    const letter = rebuildSignedLetter(signedTrademark(), "America/New_York");
    if (!letter) throw new Error("fixture does not rebuild");
    const view = { blocks: letter.blocks, exhibit: letter.exhibit };
    expect(renderToStaticMarkup(<LoeSignedLetter agreement={view} title="Letter" logo={RPB_LETTER_LOGO} />)).toContain(LOGO_IMG);
    expect(renderToStaticMarkup(<LoeSignedLetter agreement={view} title="Letter" />)).not.toContain("<img");
    expect(renderToStaticMarkup(<LoeLetterPanel agreement={view} title="Letter" logo={null} />)).not.toContain("<img");
  });
});

describe("the staff previews", () => {
  it("the editor's Preview and the settings preview draw the firm's logo only when given one", () => {
    const blocks = [{ lead: null, text: "Dear client" }];
    expect(renderToStaticMarkup(<PreviewBlock blocks={blocks} problems={[]} logo={RPB_LETTER_LOGO} />)).toContain(LOGO_IMG);
    expect(renderToStaticMarkup(<PreviewBlock blocks={blocks} problems={[]} />)).not.toContain("<img");
    expect(renderToStaticMarkup(<LetterPreview body="Dear {{client_name}}" logo={RPB_LETTER_LOGO} />)).toContain(LOGO_IMG);
    expect(renderToStaticMarkup(<LetterPreview body="Dear {{client_name}}" />)).not.toContain("<img");
  });
});

const hasImage = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1").includes("/Subtype /Image");
function exhibit() {
  const c = sevetri();
  const priced = quoteWithClientClasses(c, defaultSelection(c), { entries: {}, added: {} });
  if (!priced.ok) throw new Error("no quote");
  return buildExhibit(priced.content, priced.quote, money);
}

describe("the PDF", () => {
  const base = { blocks: fullLetterBlocks(), exhibit: exhibit(), details: TEST_DETAILS, mode: "review" as const, firmName: "RPB Law Firm" };

  it("draws an image on page 1 for RPB and none otherwise", async () => {
    expect(hasImage(await buildLetterPdf({ ...base, logo: RPB_LETTER_LOGO }))).toBe(true);
    expect(hasImage(await buildLetterPdf({ ...base, logo: null }))).toBe(false);
    expect(hasImage(await buildLetterPdf(base))).toBe(false);
  });

  it("a logo whose file is missing leaves the letter without a picture, and still builds", async () => {
    const bytes = await buildLetterPdf({ ...base, logo: { src: "/brand/missing.png", alt: "x" } });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(hasImage(bytes)).toBe(false);
  });

  it("the stored-text copy and the signed copy draw it too", async () => {
    const bytes = await buildLetterPdf({
      ...base,
      mode: "signed",
      storedText: "Dear Sevetri Wilson:\n\nA paragraph.",
      signature: { signerName: "Sevetri Wilson", signedAtText: "x", signedAtUtc: "y", fingerprint: "ab".repeat(32) },
      logo: RPB_LETTER_LOGO,
    });
    expect(hasImage(bytes)).toBe(true);
  });

  it("the review copy a client downloads carries RPB's logo (the firm's slug is rpb-law in this world)", async () => {
    const token = `L${"0".repeat(42)}`;
    const w = world({ token });
    const r = await reviewLetterPdf(token, defaultSelection(withLoe(twoBrandPerMark())), undefined, TEST_DETAILS, NOW, { db: w.db, ip: "203.0.113.50" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasImage(new Uint8Array(Buffer.from(r.base64, "base64")))).toBe(true);
  });

  it("buildVerifiedSignedPdf passes the firm's logo through, and none when the firm has none", async () => {
    const snapshot = signedTrademark();
    const withLogo = await buildVerifiedSignedPdf({ snapshot, firm: { displayName: "RPB Law Firm", timeZone: "America/New_York", logo: RPB_LETTER_LOGO }, readStored: async () => null });
    const without = await buildVerifiedSignedPdf({ snapshot, firm: { displayName: "Other Firm", timeZone: "America/New_York", logo: letterLogoForSlug("hartwell-ip") }, readStored: async () => null });
    expect(withLogo.ok && hasImage(withLogo.bytes)).toBe(true);
    expect(without.ok && hasImage(without.bytes)).toBe(false);
  });
});
