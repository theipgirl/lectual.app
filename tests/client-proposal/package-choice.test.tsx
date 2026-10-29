import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, includesComparison, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { normalizeSelection, quoteProposal } from "@/lib/proposals/pricing";
import { danielle } from "../proposals/danielle-fixture";

function render(over: Partial<ProposalDocumentProps> = {}) {
  return renderToStaticMarkup(
    <ProposalDocument
      content={danielle()}
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

describe("Select your package (Spec 6)", () => {
  it("each brand name has a labelled select, options in stored order, the default selected", () => {
    const html = render();
    expect(html).toContain('<label class="cp-pkg-l" for="cp-pkg-fold">Select your package</label>');
    expect(html).toContain('<label class="cp-pkg-l" for="cp-pkg-ci">Select your package</label>');
    const fold = html.slice(html.indexOf('id="cp-pkg-fold"'), html.indexOf("</select>", html.indexOf('id="cp-pkg-fold"')));
    expect(fold.indexOf('value="Essential"')).toBeLessThan(fold.indexOf('value="Enhanced"'));
    expect(fold.indexOf('value="Enhanced"')).toBeLessThan(fold.indexOf('value="Concierge"'));
    expect(fold).toContain('<option value="Enhanced" selected="">Enhanced</option>');
  });

  it("the select comes before the brand name's marks and classes", () => {
    const html = render();
    const card = html.slice(html.indexOf('id="cp-h-fold"'));
    expect(card.indexOf("Select your package")).toBeLessThan(card.indexOf("<h4>Marks</h4>"));
  });

  it("next to it: the price for this brand name and the package's terms", () => {
    const html = render();
    expect(html).toContain("Enhanced: $4,075 legal fee for The Fold · includes 2 classes, each additional class $825");
    expect(html).toContain("Enhanced: $2,925 legal fee for The Confidence Interval (after 10% off) · includes 2 classes, each additional class $825");
  });

  it("classes stay checkboxes, Add a class is offered, and the review panel names the package", () => {
    const html = render();
    expect(html).toContain("Class 1 · Clothing");
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7);
    expect(html).toContain("Add a class");
    expect(html).toContain("<h3>The Fold — Enhanced</h3>");
    expect(html).toContain("<h3>The Confidence Interval — Enhanced</h3>");
    expect(html).toContain("$7,000");
  });

  it("starting picks other than the default re-price through the same helper", () => {
    const html = render({ initialSelection: { packages: { fold: "Concierge", ci: "Essential" } } });
    expect(html).toContain('<option value="Concierge" selected="">Concierge</option>');
    expect(html).toContain("Concierge: $4,950 legal fee for The Fold");
    expect(html).toContain("Essential: $2,497.50 legal fee for The Confidence Interval (after 10% off)");
  });
});

describe("the receipt (Spec 6)", () => {
  it("shows '<Brand name> — <Package>' and no select", () => {
    const c = danielle();
    const sel = normalizeSelection(c, { "fold-word": true, "fold-c1": true, "fold-c2": true, "fold-c3": true, "ci-word": true, "ci-c1": true, "ci-c2": true, packages: { fold: "Concierge", ci: "Essential" } });
    const html = render({ mode: "accepted", initialSelection: sel, acceptedQuote: quoteProposal(c, sel), payUrl: "https://example.com/pay" });
    expect(html).toContain("<h3>The Fold — Concierge</h3>");
    expect(html).toContain("<h3>The Confidence Interval — Essential</h3>");
    expect(html).toContain("<h4>Package: Concierge</h4>");
    expect(html).not.toContain("<select");
  });
});

describe("What each package includes (Spec 6)", () => {
  it("one comparison table, a column per offered package, when the packages carry includes", () => {
    const c = danielle();
    c.packages = c.packages!.map((p, i) => ({ ...p, includes: [{ label: "Search report", included: String(i + 1) }, ...(i === 2 ? [{ label: "Post registration monitoring", included: "✓" }] : [])] }));
    const table = includesComparison(c);
    expect(table?.packages).toEqual(["Essential", "Enhanced", "Concierge"]);
    expect(table?.rows).toEqual([
      { label: "Search report", value: undefined, note: undefined, highlight: undefined, cells: ["1", "2", "3"] },
      { label: "Post registration monitoring", value: undefined, note: undefined, highlight: undefined, cells: ["—", "—", "✓"] },
    ]);
    const html = render({ content: c });
    expect(html).toContain("What each package includes");
    expect(html).toContain('<th scope="col" class="cp-vcell">Concierge</th>');
    expect(html).not.toContain("What your package includes");
  });

  it("without package includes, the existing table is unchanged", () => {
    const html = render();
    expect(includesComparison(danielle())).toBeNull();
    expect(html).toContain("What your package includes");
  });
});
