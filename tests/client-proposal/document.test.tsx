import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next/font only works inside the Next compiler.
vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import {
  KEEP_ONE_HINT,
  ProposalDocument,
  type ProposalDocumentProps,
} from "@/components/client-proposal/ProposalDocument";
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

describe("ProposalDocument: the last mark and class stay selected", () => {
  function single() {
    const c = sevetri();
    c.names = [c.names[0]];
    c.names[0].marks = [c.names[0].marks[0]];
    c.names[0].classes = [c.names[0].classes[0]];
    return c;
  }
  const checkboxes = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];

  it("one mark and one class: both boxes are checked and disabled, with the hint", () => {
    const html = render({ content: single() });
    const boxes = checkboxes(html);
    expect(boxes).toHaveLength(2);
    for (const b of boxes) {
      expect(b).toContain("checked");
      expect(b).toContain("disabled");
      expect(b).toContain('aria-describedby="cp-keep-p"');
    }
    expect(html).toContain(KEEP_ONE_HINT);
    expect(html).toContain('id="cp-keep-p"');
  });

  it("the full two-brand offer locks nothing and shows no hint", () => {
    const html = render();
    for (const b of checkboxes(html)) expect(b).not.toContain("disabled");
    expect(html).not.toContain(KEEP_ONE_HINT);
  });

  it("the staff preview applies the same rule", () => {
    const html = render({ content: single(), mode: "preview", onAccept: undefined });
    expect(html).toContain(KEEP_ONE_HINT);
  });

  it("a page that loads with nothing selected leaves every box tickable", () => {
    const c = single();
    c.names[0].marks[0].preselected = false;
    c.names[0].classes[0].preselected = false;
    const html = render({ content: c });
    for (const b of checkboxes(html)) expect(b).not.toContain("disabled");
    expect(html).not.toContain(KEEP_ONE_HINT);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Accept and pay my legal fee<\/button>/);
  });

  it("the accepted receipt shows no hint", () => {
    const content = single();
    const selection = defaultSelection(content);
    const html = render({
      content,
      mode: "accepted",
      onAccept: undefined,
      initialSelection: selection,
      acceptedQuote: quoteProposal(content, selection),
    });
    expect(html).not.toContain(KEEP_ONE_HINT);
  });
});
