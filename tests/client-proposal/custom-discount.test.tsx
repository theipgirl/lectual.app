import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetriCustom } from "../proposals/sevetri-custom-fixture";
import { danielle } from "../proposals/danielle-fixture";

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={sevetriCustom()}
      title="Trademark Proposal"
      clientName="Sevetri Wilson"
      expiresOn={null}
      firm={{ name: "Hartwell", slug: "hartwell" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      {...over}
    />,
  ).replaceAll("&#x27;", "'");
}

describe("custom discount on the client page", () => {
  it("each Concierge mark's package line shows the package price, then the discount as its own line", () => {
    const html = render();
    expect(html).toContain("Concierge: $4,950 legal fee for the word mark");
    expect(html).toContain("Concierge: $3,960 legal fee for the design mark (20% off as your second mark)");
    expect(html).toContain('<p class="cp-how-add cp-custom-off">Custom proposal discount −$825</p>');
    expect(html).toContain('<p class="cp-how-add cp-custom-off">Custom proposal discount −$660</p>');
    // The brand name's legal fee and the total are the engine's.
    expect(html).toContain("$7,425");
    expect(html).toContain("$14,850");
  });

  it("the review panel lists each mark at its package price and the discount as its own line", () => {
    const html = render();
    const panel = html.slice(html.indexOf('id="cp-review"'));
    expect(panel).toContain('<div class="cp-ln cp-custom-off"><span class="cp-l">Custom proposal discount</span><span class="cp-r cp-num">−$1,485</span></div>');
    expect(panel).toContain("$4,950");
    expect(panel).toContain("$3,960");
  });

  it("the receipt (accepted) shows the same discount line", () => {
    const c = sevetriCustom();
    const sel = defaultSelection(c);
    const html = render({ mode: "accepted", initialSelection: sel, content: c, acceptedQuote: quoteProposal(c, sel), payUrl: "https://example.com/pay" });
    expect(html).toContain('<div class="cp-ln cp-custom-off"><span class="cp-l">Custom proposal discount</span><span class="cp-r cp-num">−$1,485</span></div>');
    expect(html).toContain("$14,850");
  });

  it("Essential or Enhanced: no discount line at all", () => {
    const c = sevetriCustom();
    const picks: Record<string, string> = {};
    for (const n of c.names) for (const m of n.marks) picks[m.id] = "Enhanced";
    const html = render({ initialSelection: { ...defaultSelection(c), packages: picks } });
    expect(html).not.toContain("Custom proposal discount");
    expect(html).not.toContain("cp-custom-off");
  });

  it("a brand-name-level package (Spec 6) shows the discount line under its package line", () => {
    const d = danielle();
    const c: ProposalContent = {
      ...d,
      packages: (d.packages ?? []).map((p) => (p.package === "Concierge" ? { ...p, custom_discount: { label: "Custom proposal discount", per_class_under_cents: 82_500 } } : p)),
    };
    const html = render({ content: c, initialSelection: { ...defaultSelection(c), packages: { fold: "Enhanced", ci: "Concierge" } } });
    expect(html).toContain('<p class="cp-how-add cp-custom-off">Custom proposal discount −$825</p>');
    expect(html).toContain("(after the discount below)");
  });
});
