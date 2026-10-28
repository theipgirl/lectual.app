import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument, type ProposalDocumentProps } from "@/components/client-proposal/ProposalDocument";
import { DESCRIBE_BEFORE_ACCEPT, DEFAULT_CLIENT_ENTRY_PROMPT, quoteWithClientClasses, type ClientClassInput } from "@/lib/proposals/client-classes";
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

const COPY = "Add another class (category of goods or services) you’d like us to include, and describe it in your own words.";

/** oneClass() with room for the client to add up to `max` classes. */
function withRoom(max = 2): ProposalContent {
  const c = oneClass();
  c.names[0].client_add = { max };
  return c;
}

/** The real case: one design mark, Essential, three open classes. */
function openThree(): ProposalContent {
  const c = oneClass();
  c.names[0].marks = [{ ...c.names[0].marks[1], preselected: true }];
  c.names[0].classes = ["o1", "o2", "o3"].map((id) => ({ id, label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true as const }));
  return c;
}

function added(nameId: string, ...rows: Array<[string, boolean]>): ClientClassInput {
  return { entries: {}, added: { [nameId]: rows.map(([text, on]) => ({ text, on })) } };
}

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

describe("the client page: Add a class (explicit max, else 5, else none on a fixed offer)", () => {
  it("with no client_add, each ticked brand name of an offer with a choice has the control (Sprint 28's default)", () => {
    const html = render();
    expect(html.match(/Add a class<\/h4>/g)?.length).toBe(2);
    expect(html.match(/<button type="button" class="cp-add-btn">Add a class<\/button>/g)?.length).toBe(2);
  });

  it("a brand name whose marks are all unticked has no control", () => {
    const c = sevetri();
    c.names[1].marks.forEach((m) => (m.preselected = false));
    expect(render({ content: c }).match(/Add a class<\/h4>/g)?.length).toBe(1);
  });

  it("a fixed offer just shows the proposal: no checkboxes and no Add a class, unless the firm set a max", () => {
    const c = oneClass();
    c.names[0].marks = [c.names[0].marks[0]];
    const html = render({ content: c });
    expect(html).toContain("cp-fixed");
    expect(html).not.toContain("Add a class");
    expect(html).not.toContain('type="checkbox"');
    const room = oneClass();
    room.names[0].marks = [room.names[0].marks[0]];
    room.names[0].client_add = { max: 1 };
    expect(render({ content: room })).toContain("cp-add-btn");
  });

  it("a brand name with client_add has the heading, the helper lines and an Add a class button", () => {
    const html = render({ content: withRoom() });
    expect(html.match(/Add a class<\/h4>/g)?.length).toBe(1);
    expect(html).toContain(COPY);
    expect(html).toMatch(/<button type="button" class="cp-add-btn">Add a class<\/button>/);
  });

  it("client_add with max 0 is no control", () => {
    const c = oneClass();
    c.names[0].client_add = { max: 0 };
    expect(render({ content: c })).not.toContain("cp-add-btn");
  });

  it("at the max the button gives way to a sentence", () => {
    const html = render({ content: withRoom(1), initialClientClasses: added("p", ["Online store", true]) });
    expect(html).not.toContain("cp-add-btn");
    expect(html).toContain("You can add up to 1 class for Prosperall.");
  });

  it("says in words what the package includes and what the next class costs", () => {
    const html = render({ content: withRoom() });
    expect(html).toContain("Essential includes 1 class.");
    expect(html).toContain("Each class past that is $825 legal + $350 USPTO per class.");
    const concierge = sevetri();
    concierge.names[0].client_add = { max: 1 };
    expect(render({ content: concierge })).toContain(
      "Concierge includes 3 classes. 1 more included at no extra legal fee; after that $825 legal + $350 USPTO per class.",
    );
  });

  it("the new copy gives no advice", () => {
    const html = render({ content: withRoom() });
    const copy = (html.match(/cp-how-add">([^<]*)</g) ?? []).join(" ").toLowerCase();
    for (const word of ["should", "recommend", "we advise", "legal advice", "you need", "must "]) expect(copy).not.toContain(word);
  });

  it("preview mode has the control and the text boxes too (typing is allowed in preview)", () => {
    const html = render({ mode: "preview", onAccept: undefined, content: withRoom(), initialClientClasses: added("p", ["Online store", true]) });
    expect(html).toContain("Add a class</h4>");
    expect(html).toMatch(/<input type="text" class="cp-add-input" maxLength="200"[^>]*value="Online store"/);
    expect(html).toContain(">Preview</button>");
  });
});

describe("the client page: open classes", () => {
  it("each open class has its checkbox, the firm's question and a labelled text box", () => {
    const html = render({ content: openThree() });
    expect(html.match(/type="checkbox"/g)?.length).toBe(4);
    expect(html.match(/class="cp-entry"/g)?.length).toBe(3);
    expect(html).toContain(`Class 1 · ${DEFAULT_CLIENT_ENTRY_PROMPT}`);
    expect(html).toContain(`aria-label="Class 2 for Prosperall: ${DEFAULT_CLIENT_ENTRY_PROMPT}"`);
    // never a fixed offer
    expect(html).not.toContain("cp-fixed");
  });

  it("Accept is disabled with the sentence while a ticked open class is empty", () => {
    const html = render({ content: openThree() });
    expect(html).toMatch(/<button type="button" class="cp-btn" disabled="" aria-describedby="cp-describe">Accept and pay my legal fee<\/button>/);
    expect(html).toContain(DESCRIBE_BEFORE_ACCEPT);
    expect(html).toContain('aria-invalid="true"');
  });

  it("Accept is enabled once every ticked open class is described; unticked ones need nothing", () => {
    const c = openThree();
    c.names[0].classes[2].preselected = false;
    const html = render({ content: c, initialClientClasses: { entries: { o1: "Candles", o2: "Soaps" }, added: {} } });
    expect(html).toMatch(/<button type="button" class="cp-btn">Accept and pay my legal fee<\/button>/);
    expect(html).not.toContain(DESCRIBE_BEFORE_ACCEPT);
  });

  it("prices open classes like any class: Essential, 3 classes on one design mark = $3,600 legal, $1,050 USPTO", () => {
    const html = render({ content: openThree(), initialClientClasses: { entries: { o1: "a", o2: "b", o3: "c" }, added: {} } });
    expect(html).toContain("$3,600");
    expect(html).toContain("$1,050");
  });
});

describe("the client page: a class the client added", () => {
  it("has its own checkbox, text box and Remove, and is priced into the legal and USPTO lines", () => {
    const withOne = render({ content: withRoom(), initialClientClasses: added("p", ["Online store services", true]) });
    expect(withOne).toContain('value="Online store services"');
    expect(withOne).toContain('aria-label="Remove added class 1 for Prosperall"');
    expect(withOne).toContain('aria-label="Include added class 1 for Prosperall"');
    expect(withOne).toContain(">Remove</button>");
    expect(withOne).toContain("Added by you");
    // Essential $1,950 + $825 for the first mark, the second mark 20% off that: legal 2,775 + 2,220; USPTO 2 classes x 2 marks
    expect(withOne).toContain("$4,995");
    expect(withOne).toContain("$1,400");
    const without = render({ content: withRoom() });
    expect(without).not.toContain("Online store services");
    expect(without).toContain("$3,510");
    expect(without).toContain("$700");
  });

  it("unticked, it costs nothing and needs no words", () => {
    const html = render({ content: withRoom(), initialClientClasses: added("p", ["", false]) });
    expect(html).toContain("$3,510");
    expect(html).not.toContain(DESCRIBE_BEFORE_ACCEPT);
  });

  it("ticked and empty, Accept waits for its description", () => {
    const html = render({ content: withRoom(), initialClientClasses: added("p", ["", true]) });
    expect(html).toContain(DESCRIBE_BEFORE_ACCEPT);
  });

  it("the added class is the only ticked one: it cannot be removed or unticked", () => {
    const c = withRoom();
    c.names[0].classes[0].preselected = false;
    const html = render({ content: c, initialClientClasses: added("p", ["Online store services", true]) });
    expect(html).toMatch(/<button type="button" class="cp-link" disabled="" aria-describedby="cp-keep-p" aria-label="Remove added class 1 for Prosperall">/);
    expect(html).toContain("At least one class is included");
  });
});

describe("the client page: accepted versions show the client's words read-only", () => {
  function accepted(input: ClientClassInput, content = withRoom()) {
    const base = content;
    const sel = Object.fromEntries(base.names[0].marks.map((m) => [m.id, true]).concat(base.names[0].classes.map((c) => [c.id, c.preselected])));
    const priced = quoteWithClientClasses(base, sel, input);
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

  it("lists an added class with its description, no control, no Remove, no Add", () => {
    const html = accepted(added("p", ["Online store services", true]));
    expect(html).toContain("Added class · Online store services");
    expect(html).toContain("Added by you");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("Add a class");
    expect(html).not.toContain("cp-add-input");
  });

  it("shows an open class's answer in place of the question", () => {
    const html = accepted({ entries: { o1: "Candles", o2: "Soaps", o3: "Diffusers" }, added: {} }, openThree());
    expect(html).toContain("Class 1 · Candles");
    expect(html).toContain("Described by you");
    expect(html).not.toContain(DEFAULT_CLIENT_ENTRY_PROMPT);
    expect(html).not.toContain("cp-add-input");
  });

  it("a client's words are rendered as text, never as HTML", () => {
    const base = withRoom();
    const priced = quoteWithClientClasses(base, { "p-word": true, "p-c1": true }, added("p", ["x", true]));
    if (!priced.ok) throw new Error("priced");
    priced.content.names[0].classes[1].label = "<img src=x onerror=alert(1)>";
    const html = render({ mode: "accepted", content: priced.content, initialSelection: priced.selection, acceptedQuote: priced.quote, onAccept: undefined });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    const live = render({ content: withRoom(), initialClientClasses: added("p", ["<script>x</script>", true]) });
    expect(live).not.toContain("<script>x");
  });
});

describe("the client page: price words agree with the engine, and added classes carry no class number", () => {
  function custom(): ProposalContent {
    const c = sevetri();
    c.pricing = { ...c.pricing, reduce_under_included: true };
    c.names = [{ ...c.names[0], marks: [c.names[0].marks[0]], classes: [c.names[0].classes[0]], client_add: { max: 2 } }];
    return c;
  }

  it("with the custom switch on, never says 'no extra legal fee' and states the engine's next-class figure", () => {
    const base = custom();
    const sel = { "p-word": true, "p-c1": true };
    const without = quoteWithClientClasses(base, sel, { entries: {}, added: {} });
    const withOne = quoteWithClientClasses(base, sel, added("p", ["Online store services", true]));
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
    base.names[0].client_add = { max: 2 };
    const html = render({ content: base, initialClientClasses: added("p", ["Online store services", true], ["Event hosting", true]) });
    expect(html).toContain("Added class 1");
    expect(html).toContain("Added class 2");
    expect(html).not.toMatch(/Class [4-9]/);
  });
});
