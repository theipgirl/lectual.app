import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildProposalCard, coverageLine } from "@/lib/proposals/card";
import { ProposalCard } from "@/components/proposal-editor/ProposalCard";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { formatDollars } from "@/lib/proposal-editor/events";
import type { ProposalContent, ProposalEventRow } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

function brandWith(classCount: number, pricing: Partial<ProposalContent["pricing"]> = {}): ProposalContent {
  const base = sevetri();
  return {
    ...base,
    pricing: { ...base.pricing, package: "Concierge", included_classes: 3, per_class_cents: 82_500, ...pricing },
    names: [
      {
        id: "n1",
        name: "Zephyr",
        marks: [{ id: "n1-word", kind: "word", desc: "d", preselected: true }],
        classes: Array.from({ length: classCount }, (_, i) => ({ id: `n1-c${i}`, label: `Service ${i + 1}`, preselected: true })),
      },
    ],
  };
}

const row = (content: ProposalContent, expires_on: string | null = "2026-11-03") => ({ client_name: "Ana Ruiz", content, expires_on });

function event(payload: Record<string, unknown>, over: Partial<ProposalEventRow> = {}): ProposalEventRow {
  return {
    id: "e1",
    org_id: "o",
    proposal_id: "p",
    family_id: "p",
    type: "edited",
    actor: "agent",
    actor_user_id: null,
    payload,
    created_at: "2026-10-19T12:00:00Z",
    ...over,
  };
}

const EVIDENCE = event({
  source: "consult-proposal",
  notes: "Check the logo goods.",
  evidence: [
    { path: "pricing", quote: "we recommend the Concierge package", verified: true },
    { path: "names[0]", quote: "maybe a sound mark", verified: false },
  ],
});

describe("coverage line", () => {
  it("2 classes under a 3-class package", () => {
    const card = buildProposalCard(row(brandWith(2)), []);
    expect(card.brands[0].coverage).toContain("2 classes heard");
    expect(card.brands[0].coverage).toContain("Concierge covers 3");
    expect(card.brands[0].coverage).not.toContain("the rest bill");
  });

  it("5 classes: the rest bill at the per-class amount", () => {
    const card = buildProposalCard(row(brandWith(5)), []);
    expect(card.brands[0].coverage).toBe("5 classes heard · Concierge covers 3, the rest bill at $825 each");
  });

  it("exactly the included count has no overage wording; one class is singular", () => {
    expect(buildProposalCard(row(brandWith(3)), []).brands[0].coverage).toBe("3 classes heard · Concierge covers 3");
    expect(buildProposalCard(row(brandWith(1)), []).brands[0].coverage).toBe("1 class heard · Concierge covers 3");
    expect(coverageLine({ heard: 0, packageName: "Concierge", included: 3, perClassCents: 82_500 })).toContain("No classes heard yet");
  });

  it("uses a brand's own per-class price when it has an override", () => {
    const content = brandWith(5);
    content.names[0].price_override = { per_class_cents: 100_000 };
    expect(buildProposalCard(row(content), []).brands[0].coverage).toContain("the rest bill at $1,000 each");
  });

  it("lists each brand's marks and never an International Class number", () => {
    const card = buildProposalCard(row(sevetri()), []);
    expect(card.brands.map((b) => b.name)).toEqual(["Prosperall", "Tech4PublicGood"]);
    expect(card.brands[0].marks).toEqual(["Word mark", "Logo mark"]);
    expect(card.brands[0].classesHeard).toBe(2);
    expect(card.package).toBe("Concierge");
    expect(card.client).toBe("Ana Ruiz");
    expect(card.company).toBe("Prosperall");
  });
});

describe("the two fees", () => {
  const content = sevetri();
  const quote = quoteProposal(content, defaultSelection(content));
  const card = buildProposalCard(row(content), []);

  it("are exposed separately, from the pre-ticked quote", () => {
    expect(card.legalAtSigningCents).toBe(quote.legal_total_cents);
    expect(card.usptoAtFilingCents).toBe(quote.gov_total_cents);
    expect(card.legalAtSigningCents).toBeGreaterThan(0);
    expect(card.usptoAtFilingCents).toBeGreaterThan(0);
  });

  it("render under their own labels, with no 'total' and no sum", () => {
    const html = renderToStaticMarkup(createElement(ProposalCard, { card }));
    expect(html).toContain("At signing");
    expect(html).toContain("At filing");
    expect(html).toContain(formatDollars(card.legalAtSigningCents));
    expect(html).toContain(formatDollars(card.usptoAtFilingCents));
    expect(html.toLowerCase()).not.toContain("total");
    const sum = card.legalAtSigningCents + card.usptoAtFilingCents;
    expect(html).not.toContain(formatDollars(sum));
    expect(html).not.toContain(String(sum));
  });

  it("shows the expiry, or says there is none", () => {
    expect(renderToStaticMarkup(createElement(ProposalCard, { card }))).toContain("Open until Nov 3");
    const none = buildProposalCard(row(content, null), []);
    expect(renderToStaticMarkup(createElement(ProposalCard, { card: none }))).toContain("No expiry date set");
  });
});

describe("receipts", () => {
  it("verified quotes are 'Heard on the call'; unverified ones are listed apart under 'check it'", () => {
    const html = renderToStaticMarkup(createElement(ProposalCard, { card: buildProposalCard(row(sevetri()), [EVIDENCE]) }));
    const heard = html.indexOf("Heard on the call");
    const check = html.indexOf("Not found word for word, check it");
    expect(heard).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(heard);
    expect(html.slice(heard, check)).toContain("we recommend the Concierge package");
    expect(html.slice(heard, check)).not.toContain("maybe a sound mark");
    expect(html.slice(check)).toContain("maybe a sound mark");
    expect(html).toContain("Check the logo goods.");
  });

  it("a proposal with no agent event renders without receipts", () => {
    const card = buildProposalCard(row(sevetri()), []);
    expect(card.receipts).toEqual({ status: "none" });
    const html = renderToStaticMarkup(createElement(ProposalCard, { card }));
    expect(html).not.toContain("Heard on the call");
    expect(html).not.toContain("couldn&#x27;t be loaded");
    // Another kind of event is not a receipt either.
    expect(buildProposalCard(row(sevetri()), [event({ fields: ["title"] }, { actor: "staff" })]).receipts).toEqual({ status: "none" });
  });

  it("a malformed evidence payload does not crash and reads as an empty list", () => {
    for (const evidence of ["nope", 42, null, [null, 3, { quote: 9 }, { quote: "  " }, { verified: true }]]) {
      const card = buildProposalCard(row(sevetri()), [event({ source: "consult-proposal", evidence, notes: 5 })]);
      expect(card.receipts).toMatchObject({ status: "ok", verified: [], unverified: [] });
      expect(() => renderToStaticMarkup(createElement(ProposalCard, { card }))).not.toThrow();
    }
  });

  it("a failed events read says receipts couldn't be loaded, not that there are none", () => {
    const card = buildProposalCard(row(sevetri()), null);
    expect(card.receipts).toEqual({ status: "unavailable" });
    const html = renderToStaticMarkup(createElement(ProposalCard, { card }));
    expect(html).toContain("Receipts couldn&#x27;t be loaded");
    expect(html).not.toContain("Heard on the call");
  });

  it("caps a long list and says how many were left out", () => {
    const evidence = Array.from({ length: 30 }, (_, i) => ({ path: "p", quote: `quote ${i}`, verified: true }));
    const card = buildProposalCard(row(sevetri()), [event({ source: "consult-proposal", evidence })]);
    expect(card.receipts).toMatchObject({ status: "ok", more: 18 });
  });
});

describe("totality", () => {
  it("does not throw on junk content", () => {
    const junk = { names: "x", pricing: null, client: 3 } as unknown as ProposalContent;
    const card = buildProposalCard(row(junk), []);
    expect(card.brands).toEqual([]);
    expect(card.legalAtSigningCents).toBe(0);
    expect(() => renderToStaticMarkup(createElement(ProposalCard, { card }))).not.toThrow();
  });
});

describe("edited from a package (Sprint 6)", () => {
  const edited = (basis: unknown) => buildProposalCard(row({ ...sevetri(), package_basis: basis } as unknown as ProposalContent), []);

  it("shows 'Edited from <package>' and the changed fields when content.package_basis names some", () => {
    const card = edited({ name: "Enhanced", edited: ["price", "classes included"] });
    expect(card.editedFrom).toEqual({ name: "Enhanced", fields: ["price", "classes included"] });
    const html = renderToStaticMarkup(createElement(ProposalCard, { card }));
    expect(html).toContain("Edited from Enhanced");
    expect(html).toContain("price, classes included");
    expect(html.toLowerCase()).not.toContain("total");
  });

  it("is absent when nothing was changed, or when the basis is missing or malformed", () => {
    expect(buildProposalCard(row(sevetri()), []).editedFrom).toBeNull();
    expect(edited({ name: "Enhanced", edited: [] }).editedFrom).toBeNull();
    for (const junk of ["x", 4, null, [], { edited: ["price"] }, { name: "A", edited: "price" }, { name: "A", edited: [1, null, "  "] }]) {
      expect(edited(junk).editedFrom).toBeNull();
    }
    expect(renderToStaticMarkup(createElement(ProposalCard, { card: buildProposalCard(row(sevetri()), []) }))).not.toContain("Edited from");
  });
});
