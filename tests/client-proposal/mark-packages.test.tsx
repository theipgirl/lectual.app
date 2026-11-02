import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, addMarkLabel, offeredPackages, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { defaultSelection, normalizeSelection, quoteProposal } from "@/lib/proposals/pricing";
import { fold } from "../proposals/mark-fixture";

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={fold()}
      title="Trademark Proposal"
      clientName="Danielle Milton"
      expiresOn={null}
      firm={{ name: "Hartwell", slug: "hartwell" }}
      mode="live"
      onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })}
      {...over}
    />,
  ).replaceAll("&#x27;", "'");
}

const selectFor = (html: string, id: string) => html.slice(html.indexOf(`id="cp-pkg-${id}"`), html.indexOf("</select>", html.indexOf(`id="cp-pkg-${id}"`)));

describe("a package per mark on the client page (Spec 7)", () => {
  it("the word mark row has its own 'Select your package', styled like the brand name's, default Enhanced", () => {
    const html = render();
    expect(html).toContain('<label class="cp-pkg-l" for="cp-pkg-fold-word">Select your package</label>');
    const sel = selectFor(html, "fold-word");
    expect(sel).toContain('class="cp-pkg-sel"');
    expect([...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual(["Essential", "Enhanced", "Concierge"]);
    expect(sel).toMatch(/<option value="Enhanced" selected="">/);
    expect(html).toContain("Enhanced: $3,250 legal fee for the word mark");
    // No brand-name-level select on a name that prices per mark.
    expect(html).not.toContain('id="cp-pkg-fold"');
  });

  it("the design mark is an add-on: a checkbox 'Add the design mark (logo)' with its description, and no select while unticked", () => {
    const html = render();
    expect(addMarkLabel("logo")).toBe("Add the design mark (logo)");
    expect(html).toContain("<b>Add the design mark (logo)</b><span>Protects the design.</span>");
    expect(html).not.toContain('id="cp-pkg-fold-logo"');
    expect(html).toContain("$3,250");
  });

  it("ticked, the design mark shows its own select (Essential / Enhanced, default Essential) and its price line", () => {
    const html = render({ initialSelection: { "fold-logo": true } });
    const sel = selectFor(html, "fold-logo");
    expect([...sel.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])).toEqual(["Essential", "Enhanced"]);
    expect(sel).toMatch(/<option value="Essential" selected="">/);
    expect(html).toContain("Essential: $2,220 legal fee for the design mark (20% off as your second mark)");
    expect(html).toContain("$5,470");
    expect(html).toContain("The Fold — word mark, Enhanced; design mark, Essential");
  });

  it("the receipt names the package per mark and shows no select", () => {
    const c = fold();
    const s = normalizeSelection(c, { ...defaultSelection(c), "fold-logo": true, packages: { "fold-word": "Concierge" } });
    const html = render({ mode: "accepted", initialSelection: s, acceptedQuote: quoteProposal(c, s) });
    expect(html).not.toContain("<select");
    expect(html).toContain("Package for the word mark: Concierge");
    expect(html).toContain("Package for the design mark: Essential");
    expect(html).toContain("The Fold — word mark, Concierge; design mark, Essential");
  });

  it("every package a mark offers counts as offered", () => {
    expect(offeredPackages(fold()).map((o) => o.package)).toEqual(["Essential", "Enhanced", "Concierge"]);
  });
});
