import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font only works inside the Next compiler.
vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={sevetri()}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn="2026-10-26"
      firm={{ name: "RPB Law", slug: "rpb-law" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      {...over}
    />,
  );
}

describe("ProposalDocument", () => {
  it("shows the two labelled amounts and never a bare Total", () => {
    const html = render();
    const q = quoteProposal(sevetri(), defaultSelection(sevetri()));
    expect(html).toContain("Legal fee due now");
    expect(html).toContain("USPTO filing fees, due at filing");
    expect(html).not.toMatch(/>\s*Total\s*</);
    expect(html).toContain(`$${(q.legal_total_cents / 100).toLocaleString("en-US")}`);
    expect(html).toContain("What your package includes");
    expect(html).toContain("Available through Monday, October 26, 2026");
    expect(html).toContain("Accept and pay my legal fee");
  });

  it("renders firm text as text, never HTML", () => {
    const content = sevetri();
    content.names[0].note = '**<b onmouseover="x">hi</b>** <script>alert(1)</script>';
    content.greeting = "<img src=x onerror=alert(1)>";
    const html = render({ content });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("preview mode disables Accept and labels it Preview", () => {
    const html = render({ mode: "preview", onAccept: undefined });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Preview<\/button>/);
    expect(html).not.toContain("Accept and pay my legal fee</button>");
  });

  it("accepted mode shows the receipt with a Pay link and locked boxes", () => {
    const content = sevetri();
    const selection = defaultSelection(content);
    const html = render({
      mode: "accepted",
      onAccept: undefined,
      initialSelection: selection,
      acceptedQuote: quoteProposal(content, selection),
      payUrl: "https://example.com/pay",
    });
    expect(html).toContain("Thank you, Sevetri.");
    expect(html).toContain('href="https://example.com/pay"');
    expect(html).toContain("Pay my legal fee");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("Accept and pay my legal fee</button>");
    expect(html).toContain("disabled");
  });

  it("never links a non-https pay url", () => {
    const html = render({ mode: "accepted", onAccept: undefined, payUrl: "javascript:alert(1)" });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Pay my legal fee</a>");
  });

  it("gives other firms the neutral look, not RPB's logo", () => {
    const html = render({ firm: { name: "Acme IP", slug: "acme-ip" } });
    expect(html).toContain('data-brand="neutral"');
    expect(html).not.toContain("rpb-logo-cream.png");
    expect(html).toContain("Acme IP");
  });
});
