import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { SignByLinkPage } from "@/components/client-proposal/sign-link/SignByLinkPage";
import { CONSENT_STEP_NAME, EMAIL_LINK_LABEL, LINK_UNAVAILABLE, SIGNATURE_STEP_NAME, SIGN_AGREE_LABEL, SIGN_LABEL, TYPE_INSTEAD_LABEL } from "@/lib/loe/client-words";
import { TEST_DETAILS } from "../full-letter-fixture";
import { generalWithLoe, twoBrandPerMark, withLoe } from "../loe-fixtures";

const FIRM = { name: "Sample Firm", slug: "sample-firm", displayName: "Sample Firm" };
const VIEW = {
  title: "Engagement letter",
  paragraphs: ["Paragraph one.", "Paragraph two."],
  consentLine: "FIRM CONSENT LINE",
  consentText: "FIRM CONSENT TEXT",
  consentSha256: "a".repeat(64),
  consented: false,
  signLine: "FIRM SIGN LINE",
  boxNote: "FIRM BOX NOTE",
};
const noop = async () => ({ ok: true as const });
const open = (over: Partial<typeof VIEW> = {}) =>
  renderToStaticMarkup(
    <SignByLinkPage
      state="open"
      backHref="/p/x/"
      firm={FIRM}
      view={{ ...VIEW, ...over }}
      onOpened={async () => {}}
      onConsent={noop}
      onSign={async () => ({ ok: true, signedLine: "", payUrl: null })}
    />,
  );

describe("T9 the ?sign= page's states", () => {
  it("before consent: the letter, the attorney's consent line and text, and NO input, canvas or Sign", () => {
    const html = open();
    expect(html).toContain("Paragraph one.");
    expect(html).toContain(CONSENT_STEP_NAME);
    expect(html).toContain("FIRM CONSENT LINE");
    expect(html).toContain("FIRM CONSENT TEXT");
    expect(html).not.toMatch(/<input|<canvas|<textarea/);
    expect(html).not.toContain(SIGN_LABEL);
    expect(html).not.toContain("FIRM SIGN LINE");
  });
  it("after consent: the box (canvas), the typed alternative, the required typed name, the box note and the sign line", () => {
    const html = open({ consented: true });
    expect(html).toContain(SIGNATURE_STEP_NAME);
    expect(html).toMatch(/<canvas[^>]*width="600"[^>]*height="200"/);
    expect(html).toContain(TYPE_INSTEAD_LABEL);
    expect(html).toMatch(/<input[^>]*required=""[^>]*name="typed_name"/);
    expect(html).toContain("FIRM BOX NOTE");
    expect(html).toContain("FIRM SIGN LINE");
    expect(html).toContain(SIGN_LABEL);
    // The radio comes before the canvas in the focus order (keyboard users reach "Type it instead" first).
    expect(html.indexOf('type="radio"')).toBeLessThan(html.indexOf("<canvas"));
  });
  it("unavailable: one sentence and a link back, nothing else", () => {
    const html = renderToStaticMarkup(<SignByLinkPage state="unavailable" backHref="/p/x/" />);
    expect(html).toContain(LINK_UNAVAILABLE);
    expect(html).toContain('href="/p/x/"');
  });
  it("signed: the step word, the signed line and Pay", () => {
    const html = renderToStaticMarkup(<SignByLinkPage state="signed" backHref="/p/x/" firm={FIRM} signedLine="Signed X by Y" payUrl="https://pay.example/x" />);
    expect(html).toContain("Signed X by Y");
    expect(html).toContain('href="https://pay.example/x"');
  });
});

function proposal(over: Partial<ProposalDocumentProps>) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={withLoe(twoBrandPerMark())}
      title="Trademark Proposal"
      clientName="Sam Client"
      expiresOn="2026-12-01"
      firm={{ name: "Sample Firm", slug: "sample-firm" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "" })}
      initialLoe={{ step: 3, details: TEST_DETAILS }}
      {...over}
    />,
  );
}

describe("item 17: step 3 when the path is on", () => {
  const letter = { dateText: "October 20, 2026", clientEmail: "client@example.com", emailSigning: true };
  const send = async () => ({ ok: true as const, sentTo: "c•••@example.com", expiresText: "x" });
  it("the live page with the send action: the email button replaces the typed name, the tick and Sign", () => {
    const html = proposal({ letter, onSendSigningLink: send, onCloseSigningLink: async () => ({ closed: false }) });
    expect(html).toContain(EMAIL_LINK_LABEL);
    expect(html).not.toContain(SIGN_AGREE_LABEL);
    expect(html).not.toContain(SIGN_LABEL);
  });
  it("the flat-fee page too", () => {
    const html = proposal({ content: generalWithLoe(), letter, onSendSigningLink: send });
    expect(html).toContain(EMAIL_LINK_LABEL);
    expect(html).not.toContain(SIGN_AGREE_LABEL);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("T22 no client email can come from a staff preview", () => {
  it("the editor's preview (mode preview), even with emailSigning true, draws no email button", () => {
    const html = proposal({ mode: "preview", letter: { dateText: "x", clientEmail: "c@example.com", emailSigning: true } });
    expect(html).not.toContain(EMAIL_LINK_LABEL);
  });
  it("a live page that was not given the send action draws today's step 3", () => {
    const html = proposal({ letter: { dateText: "x", clientEmail: "c@example.com", emailSigning: true } });
    expect(html).not.toContain(EMAIL_LINK_LABEL);
    expect(html).toContain(SIGN_AGREE_LABEL);
  });
  it("no dashboard or editor file names or imports the send / close actions", () => {
    for (const f of [...walk("src/app/dashboard"), ...walk("src/components/proposal-editor")]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/sendSigningLinkAction|closeSigningLinkAction|onSendSigningLink|onCloseSigningLink/);
    }
  });
});

describe("the ?sign= render keeps Referrer-Policy: no-referrer and writes nothing on GET", () => {
  it("the route's layout sets no-referrer for every render of /p/[token], the ?sign= one included", async () => {
    const { metadata } = await import("@/app/p/[token]/layout");
    expect(metadata.referrer).toBe("no-referrer");
    const page = readFileSync("src/app/p/[token]/page.tsx", "utf8");
    // The ?sign= branch returns before the `viewed` event is recorded, and calls only the read entry.
    const branch = page.indexOf("if (sign !== undefined) return <SigningLink");
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(page.indexOf("recordProposalViewed(read.handle"));
    const fn = page.slice(page.indexOf("async function SigningLink"));
    expect(fn).toMatch(/entryReadLink\(/);
    expect(fn).not.toMatch(/entryRecordOpened|entryRecordConsent|entrySign\(|\.rpc\(/);
  });
});
