import { vi } from "vitest";
import { createElement } from "react";
import { resetState } from "../fixtures";
import type { Screen } from "../registry";
import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { SignByLinkPage } from "@/components/client-proposal/sign-link/SignByLinkPage";
import { TEST_DETAILS } from "../../../tests/loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../../../tests/loe/loe-fixtures";

// next/font only runs inside Next: stand in with plain classes and load the two real faces from Google Fonts (as callum.screen does).
vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "sev-f-head", className: "sev-f-head" }),
  Source_Serif_4: () => ({ variable: "sev-f-body", className: "sev-f-body" }),
}));
const CLIENT_FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap">' +
  "<style>.sev-f-head{--font-cp-heading:'Bodoni Moda'}.sev-f-body{--font-cp-body:'Source Serif 4'}</style>";
const withFonts = (html: string) => CLIENT_FONTS + html;

/**
 * lectual 0117 (Sprint B): the client states of the emailed signing link at 1440 and 375, from the REAL components with invented names and
 * example.com addresses only. Static markup: step 3 with the email button, the `?sign=` page read-only before consent, after consent
 * (the signature box), the link-unavailable page and the done screen. NOT drawable statically (they need pointer or typing in a
 * browser): a drawn signature, the name-mismatch sentence and the "link sent" note after pressing the button.
 */
const FIRM = { name: "Sample Firm", slug: "sample-firm", displayName: "Sample Firm" };
const VIEW = {
  title: "Engagement letter",
  paragraphs: [
    "Sample Firm, PLLC",
    "Alex Sample, 12 Example Road, Springfield, EX 00000",
    "This is a made-up paragraph of the letter, standing in for the firm's own approved words. It runs long enough to wrap on a phone so the layout is checked at both widths.",
    "A second made-up paragraph. The real letter is the attorney's own text.",
  ],
  consentLine: "Made-up consent line, written by the firm.",
  consentText: "Made-up consent text, written by the firm. It is longer than the line, so the page's text box is exercised.",
  consentSha256: "a".repeat(64),
  consented: false,
  signLine: "Made-up line beside Sign.",
  boxNote: "Made-up line under the signature box.",
};
const noop = async () => ({ ok: true as const });

type Page = { key: string; title: string; render: () => ReturnType<typeof createElement> };

const pages: Page[] = [
  {
    key: "step3",
    title: "Step 3 with the email button",
    render: () =>
      createElement(ProposalDocument, {
        content: withLoe(twoBrandPerMark()),
        title: "Trademark Proposal",
        clientName: "Alex Sample",
        expiresOn: "2026-12-01",
        firm: { name: "Sample Firm", slug: "sample-firm" },
        mode: "live",
        onAccept: async () => ({ ok: true, payUrl: "https://example.com/pay" }),
        letter: { dateText: "November 23, 2026", clientEmail: "alex@example.com", emailSigning: true },
        onSendSigningLink: async () => ({ ok: true, sentTo: "a•••@example.com", uncertain: false }) as never,
        onCloseSigningLink: async () => ({ closed: false }),
        initialLoe: { step: 3, details: TEST_DETAILS },
      } as never),
  },
  { key: "open", title: "Signing link, read-only before consent", render: () => createElement(SignByLinkPage, { state: "open", backHref: "/p/x/", firm: FIRM, view: VIEW, onOpened: async () => {}, onConsent: noop, onSign: async () => ({ ok: true as const, signedLine: "", payUrl: null }) }) },
  { key: "consented", title: "Signing link, signature box", render: () => createElement(SignByLinkPage, { state: "open", backHref: "/p/x/", firm: FIRM, view: { ...VIEW, consented: true }, onOpened: async () => {}, onConsent: noop, onSign: async () => ({ ok: true as const, signedLine: "", payUrl: null }) }) },
  { key: "gone", title: "Signing link unavailable", render: () => createElement(SignByLinkPage, { state: "unavailable", backHref: "/p/x/" }) },
  { key: "done", title: "Signed: done screen", render: () => createElement(SignByLinkPage, { state: "signed", backHref: "/p/x/", firm: FIRM, signedLine: "Signed November 23, 2026 at 2:14 PM EST by Alex Sample", payUrl: "https://example.com/pay" }) },
];

const VPS = [["d", "desktop"], ["p", "phone"]] as const;

export const screens: Screen[] = pages.flatMap((p) =>
  VPS.map(([tag, viewport]) => ({
    id: `loe-email-${p.key}-${tag}`,
    title: `${p.title} (${viewport})`,
    designBoard: "none",
    viewport,
    shell: "none" as const,
    prepare: () => resetState(),
    render: () => p.render(),
    transformHtml: withFonts,
    note: "Static markup of the real client components, invented names, example.com addresses. A drawn signature, the name-mismatch sentence and the link-sent note need a browser.",
  })),
);
