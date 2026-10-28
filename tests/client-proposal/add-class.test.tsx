import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { quoteWithAddedClasses } from "@/lib/proposals/added-classes";
import type { ProposalContent } from "@/lib/proposals/types";
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

/** One brand name with one class, Essential-shaped. */
function oneClass(): ProposalContent {
  const c = sevetri();
  c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500 };
  c.names = [{ ...c.names[0], classes: [c.names[0].classes[0]] }];
  return c;
}

const COPY = "Add another class (category of goods or services) you’d like us to include.";

describe("the client page: one class is always included", () => {
  it("a one-class mark shows the class checked and disabled, with the word 'Included'", () => {
    const html = render({ content: oneClass() });
    // PR #4's $0 lock also holds it (unticking it would empty the proposal), so it points at that hint too.
    expect(html).toContain('<input type="checkbox" disabled="" aria-describedby="cp-keep-p" checked=""/>');
    expect(html).toContain('<span class="cp-lock">Included</span>');
  });

  it("a multi-class mark with a single class left ticked is disabled with 'At least one class is included'", () => {
    const c = sevetri();
    c.names[0].classes[1].preselected = false;
    const html = render({ content: c });
    expect(html).toContain('<span class="cp-lock">At least one class is included</span>');
    // only the locked one is disabled among the first card's classes
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });

  it("with two classes ticked nothing is locked", () => {
    const html = render({ content: sevetri() });
    expect(html).not.toContain("cp-lock");
  });
});

describe("the client page: Add a class", () => {
  it("each ticked brand name has the control, the helper line, a text field and an Add button", () => {
    const html = render();
    expect(html.match(/Add a class<\/h4>/g)?.length).toBe(2);
    expect(html).toContain(COPY);
    expect(html.match(/class="cp-add-input"/g)?.length).toBe(2);
    expect(html.match(/class="cp-add-btn"[^>]*>Add<\/button>/g)?.length).toBe(2);
  });

  it("says in words what the package includes and what the next class costs", () => {
    const html = render({ content: oneClass() });
    expect(html).toContain("Essential includes 1 class.");
    expect(html).toContain("Each class past that is $825 legal + $350 USPTO per class.");
    const concierge = render();
    expect(concierge).toContain("Concierge includes 3 classes. 1 more included at no extra legal fee; after that $825 legal + $350 USPTO per class.");
  });

  it("a brand name whose marks are all unticked has no control", () => {
    const c = sevetri();
    c.names[1].marks.forEach((m) => (m.preselected = false));
    const html = render({ content: c });
    expect(html.match(/Add a class<\/h4>/g)?.length).toBe(1);
  });

  it("the new copy gives no advice", () => {
    const html = render({ content: oneClass() });
    const copy = (html.match(/cp-how-add">([^<]*)</g) ?? []).join(" ").toLowerCase();
    for (const word of ["should", "recommend", "we advise", "legal advice", "you need", "must "]) expect(copy).not.toContain(word);
  });

  it("preview mode has the control too (boxes work in preview)", () => {
    expect(render({ mode: "preview", onAccept: undefined })).toContain("Add a class</h4>");
  });
});

describe("the client page: a class the client added", () => {
  it("is listed with a Remove button, priced into the legal and USPTO lines, and removing it returns them", () => {
    const withOne = render({ content: oneClass(), initialAddedClasses: { p: ["Online store services"] } });
    expect(withOne).toContain("Online store services");
    expect(withOne).toContain('aria-label="Remove Online store services"');
    expect(withOne).toContain(">Remove</button>");
    expect(withOne).toContain("Added by you");
    // Essential $1,950 + $825 for the first mark, the second mark 20% off that: legal 2,775 + 2,220; USPTO 2 classes x 2 marks
    expect(withOne).toContain("$4,995");
    expect(withOne).toContain("$1,400");
    const without = render({ content: oneClass() });
    expect(without).not.toContain("Online store services");
    expect(without).toContain("$3,510");
    expect(without).toContain("$700");
  });

  it("the added class is the only ticked one it cannot be removed while another is not ticked", () => {
    const c = oneClass();
    c.names[0].classes[0].preselected = false;
    const html = render({ content: c, initialAddedClasses: { p: ["Online store services"] } });
    expect(html).toMatch(/<button type="button" class="cp-link" disabled="" aria-describedby="cp-keep-p" aria-label="Remove Online store services">/);
    expect(html).toContain("At least one class is included");
  });
});

describe("the client page: accepted and closed versions show added classes read-only", () => {
  function accepted() {
    const base = oneClass();
    const priced = quoteWithAddedClasses(base, { "p-word": true, "p-c1": true }, { p: ["Online store services"] });
    if (!priced.ok) throw new Error("priced");
    return render({
      mode: "accepted",
      content: priced.content,
      initialSelection: priced.selection,
      acceptedQuote: priced.quote,
      payUrl: "https://example.com/pay",
      onAccept: undefined,
    });
  }

  it("lists the accepted class with its description, no control, no Remove, no Add", () => {
    const html = accepted();
    expect(html).toContain("Online store services");
    expect(html).toContain("Added by you");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("Add a class");
    expect(html).not.toContain("cp-add-input");
    expect(html).not.toContain("cp-lock\">Included");
  });

  it("shows the frozen totals: legal $2,775 and USPTO $700, unchanged by the current content", () => {
    const html = accepted();
    expect(html).toContain("$2,775");
    expect(html).toContain("$700");
  });

  it("a client-added description is rendered as text, never as HTML", () => {
    const priced = quoteWithAddedClasses(oneClass(), { "p-word": true, "p-c1": true }, { p: ["x"] });
    if (!priced.ok) throw new Error("priced");
    priced.content.names[0].classes[1].label = "<img src=x onerror=alert(1)>";
    const html = render({ mode: "accepted", content: priced.content, initialSelection: priced.selection, acceptedQuote: priced.quote, onAccept: undefined });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("the client page: price words agree with the engine, and added classes carry no class number", () => {
  function custom(): ProposalContent {
    const c = sevetri();
    c.pricing = { ...c.pricing, reduce_under_included: true };
    c.names = [{ ...c.names[0], marks: [c.names[0].marks[0]], classes: [c.names[0].classes[0]] }];
    return c;
  }

  it("with the custom switch on, never says 'no extra legal fee' and states the engine's next-class figure", () => {
    const base = custom();
    const sel = { "p-word": true, "p-c1": true };
    const without = quoteWithAddedClasses(base, sel, {});
    const withOne = quoteWithAddedClasses(base, sel, { p: ["Online store services"] });
    if (!without.ok || !withOne.ok) throw new Error("priced");
    const delta = withOne.quote.legal_total_cents - without.quote.legal_total_cents;
    expect(delta).toBe(82_500);
    const html = render({ content: base });
    expect(html).not.toContain("no extra legal fee");
    expect(html).toContain(`The next class adds $${(delta / 100).toLocaleString("en-US")} legal`);
  });

  it("with the switch off, the included classes are still described as free of legal fee", () => {
    const html = render({ content: { ...custom(), pricing: { ...custom().pricing, reduce_under_included: false } } });
    expect(html).toContain("no extra legal fee");
  });

  it("three staff classes and two added: no 'Class 4' to 'Class 9' label anywhere", () => {
    const base = sevetri();
    base.names[0].classes.push({ id: "p-c3", label: "Printed goods", preselected: true });
    const sel = { "p-word": true, "p-c1": true, "p-c2": true, "p-c3": true };
    const priced = quoteWithAddedClasses(base, sel, { p: ["Online store services", "Event hosting"] });
    if (!priced.ok) throw new Error("priced");
    const html = render({ content: priced.content, initialSelection: priced.selection });
    expect(html).toContain("Added class · Online store services");
    expect(html).toContain("Added class · Event hosting");
    expect(html).not.toMatch(/Class [4-9]/);
  });
});
