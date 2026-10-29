import { describe, it, expect } from "vitest";
import {
  chosenPackage,
  defaultSelection,
  isFixedOffer,
  normalizeSelection,
  packageChoiceOptions,
  quoteProposal,
} from "@/lib/proposals/pricing";
import { quoteWithClientClasses, emptyClientClassInput, clientAddMax } from "@/lib/proposals/client-classes";
import { validateContent } from "@/lib/proposals/validate";
import { publicContent, buildAcceptedSnapshot } from "@/lib/proposals/public";
import { packageOffersFromSetting, withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { chosenPackagesText, packageLineTitle } from "@/lib/proposals/name-package";
import { acceptanceHeadline, acceptanceNoteBody } from "@/lib/proposals/accept-followups";
import { loeInputFromAcceptedProposal } from "@/lib/proposals/loe-adapter";
import { parseName } from "@/lib/proposal-editor/form";
import type { ProposalContent, ProposalPricing, Selection } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

import { danielle, ESSENTIAL, ENHANCED, CONCIERGE, OPTIONS } from "./danielle-fixture";

function pick(fold: string, ci: string): Selection {
  return { ...defaultSelection(danielle()), packages: { fold, ci } };
}

const nameOf = (content: ProposalContent, sel: Selection, id: string) => quoteProposal(content, sel).names.find((n) => n.id === id)!;

describe("Danielle's figures (Spec 6)", () => {
  it("The Fold, 3 classes: Essential $3,600, Enhanced $4,075, Concierge $4,950; USPTO $1,050", () => {
    const c = danielle();
    for (const [pkg, legal] of [["Essential", 360_000], ["Enhanced", 407_500], ["Concierge", 495_000]] as const) {
      const n = nameOf(c, pick(pkg, "Enhanced"), "fold");
      expect(n.package).toBe(pkg);
      expect(n.legal_cents).toBe(legal);
      expect(n.gov_cents).toBe(105_000);
      expect(n.discount_cents).toBeUndefined();
    }
  });

  it("The Confidence Interval, 2 classes, 10% off: Essential $2,497.50, Enhanced $2,925, Concierge $4,455; USPTO $700", () => {
    const c = danielle();
    for (const [pkg, legal, off] of [["Essential", 249_750, 27_750], ["Enhanced", 292_500, 32_500], ["Concierge", 445_500, 49_500]] as const) {
      const n = nameOf(c, pick("Enhanced", pkg), "ci");
      expect(n.package).toBe(pkg);
      expect(n.legal_cents).toBe(legal);
      expect(n.discount_cents).toBe(off);
      expect(n.gov_cents).toBe(70_000);
    }
  });

  it("the totals add the two brand names; the USPTO fee is never discounted", () => {
    const q = quoteProposal(danielle(), pick("Concierge", "Concierge"));
    expect(q.legal_subtotal_cents).toBe(495_000 + 445_500);
    expect(q.legal_total_cents).toBe(940_500);
    expect(q.gov_total_cents).toBe(175_000);
  });

  it("one class added on each, priced under the chosen package like any other class", () => {
    const c = danielle();
    expect(clientAddMax(c, c.names[0])).toBe(5);
    const input = { entries: {}, added: { fold: [{ text: "Candles", on: true }], ci: [{ text: "Workshops", on: true }] } };
    const fold: Array<[string, number]> = [["Essential", 442_500], ["Enhanced", 490_000], ["Concierge", 577_500]];
    const ci: Array<[string, number]> = [["Essential", 324_000], ["Enhanced", 366_750], ["Concierge", 445_500]];
    for (let i = 0; i < 3; i++) {
      const r = quoteWithClientClasses(c, pick(fold[i][0], ci[i][0]), input);
      if (!r.ok) throw new Error("refused");
      const f = r.quote.names.find((n) => n.id === "fold")!;
      const k = r.quote.names.find((n) => n.id === "ci")!;
      expect([f.package, f.legal_cents, f.gov_cents]).toEqual([fold[i][0], fold[i][1], 140_000]);
      expect([k.package, k.legal_cents, k.gov_cents]).toEqual([ci[i][0], ci[i][1], 105_000]);
    }
  });
});

describe("package picks are names only, checked against the content", () => {
  it("a missing, unknown or forged pick is the name's default", () => {
    const c = danielle();
    for (const bad of [undefined, "Platinum", "essential", 495_000, { base_cents: 1 }, ""]) {
      const sel = { ...defaultSelection(c), packages: { fold: bad as unknown as string } };
      expect(chosenPackage(c, c.names[0], sel)?.package).toBe("Enhanced");
      expect(normalizeSelection(c, sel).packages).toEqual({ fold: "Enhanced", ci: "Enhanced" });
    }
  });

  it("a package not offered to THIS brand name falls back, even if the proposal has it", () => {
    const c = danielle();
    c.names[1].package_choice = { options: ["Essential", "Enhanced"], default: "Essential" };
    expect(normalizeSelection(c, { packages: { ci: "Concierge" } }).packages?.ci).toBe("Essential");
  });

  it("normalizeSelection keeps only real ids and package names, never a price", () => {
    const sel = normalizeSelection(danielle(), { "fold-word": true, legal_total_cents: 1, base_cents: 1, packages: { fold: "Essential", ci: "Concierge", other: "Essential" } });
    expect(Object.keys(sel).sort()).toEqual(["ci-c1", "ci-c2", "ci-word", "fold-c1", "fold-c2", "fold-c3", "fold-word", "packages"]);
    expect(sel.packages).toEqual({ fold: "Essential", ci: "Concierge" });
  });

  it("a brand name with a package to choose is never a fixed offer", () => {
    const c = danielle();
    c.names = [{ ...c.names[0], classes: [c.names[0].classes[0]] }];
    expect(isFixedOffer(c)).toBe(false);
    delete c.names[0].package_choice;
    expect(isFixedOffer(c)).toBe(true);
  });

  it("options keep their stored order, skip unknown names and duplicates", () => {
    const c = danielle();
    c.names[0].package_choice = { options: ["Concierge", "Nope", "Essential", "Concierge"], default: "Nope" };
    expect(packageChoiceOptions(c, c.names[0]).map((o) => o.package)).toEqual(["Concierge", "Essential"]);
    expect(chosenPackage(c, c.names[0], {})?.package).toBe("Concierge");
  });
});

describe("old content prices exactly as before", () => {
  it("no package_choice and no discount: no new keys on the quote or the selection", () => {
    const c = sevetri();
    const q = quoteProposal(c, defaultSelection(c));
    for (const n of q.names) {
      expect(Object.keys(n)).toEqual(["id", "name", "included", "classes", "marks", "base_cents", "legal_cents", "gov_cents", "class_count"]);
    }
    expect("packages" in defaultSelection(c)).toBe(false);
    expect("packages" in normalizeSelection(c, { packages: { p: "Essential" } })).toBe(false);
    expect(q.legal_total_cents).toBe(1_782_000);
  });

  it("a stray packages snapshot without any package_choice changes nothing", () => {
    const c = sevetri();
    const before = JSON.stringify(quoteProposal(c, defaultSelection(c)));
    expect(JSON.stringify(quoteProposal({ ...c, packages: [ESSENTIAL] }, defaultSelection(c)))).toBe(before);
  });
});

describe("validateContent: package choice and the brand name discount", () => {
  const paths = (c: unknown) => validateContent(c).filter((i) => i.level === "error").map((i) => i.path);

  it("Danielle's proposal is valid", () => {
    expect(paths(danielle())).toEqual([]);
  });

  it("refuses unknown options, a default not offered, duplicates, too many, and no packages", () => {
    const unknown = danielle();
    unknown.names[0].package_choice = { options: ["Essential", "Platinum"], default: "Essential" };
    expect(paths(unknown)).toContain("names[0].package_choice.options");

    const badDefault = danielle();
    badDefault.names[0].package_choice = { options: ["Essential", "Enhanced"], default: "Concierge" };
    expect(paths(badDefault)).toContain("names[0].package_choice.default");

    const dup = danielle();
    dup.names[0].package_choice = { options: ["Essential", "Essential"], default: "Essential" };
    expect(paths(dup)).toContain("names[0].package_choice.options");

    const many = danielle();
    many.packages = [...many.packages!, { ...ESSENTIAL, package: "Extra" }];
    many.names[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Essential" };
    expect(paths(many)).toContain("names[0].package_choice.options");

    const none = danielle();
    delete none.packages;
    expect(paths(none)).toContain("names[0].package_choice");
  });

  it("refuses a discount out of range or not whole, and a price override beside a choice", () => {
    for (const d of [-1, 51, 10.5, "10"]) {
      const c = danielle();
      (c.names[1] as unknown as Record<string, unknown>).discount_pct = d;
      expect(paths(c)).toContain("names[1].discount_pct");
    }
    const both = danielle();
    both.names[0].price_override = { base_cents: 100_000 };
    expect(paths(both)).toContain("names[0].price_override");
  });

  it("the id 'packages' is reserved for the selection's package picks", () => {
    const c = danielle();
    c.names[0].classes[0].id = "packages";
    expect(paths(c)).toContain("names[0].classes[0].id");
  });
});

describe("publicContent and the snapshot", () => {
  it("publishes the packages, the choice and the discount (all firm text and numbers)", () => {
    const out = publicContent(danielle());
    expect(out.packages?.map((p) => p.package)).toEqual(OPTIONS);
    expect(out.names[0].package_choice).toEqual({ options: OPTIONS, default: "Enhanced" });
    expect(out.names[1].discount_pct).toBe(10);
  });

  it("withPackageSnapshot copies the firm's current list only when a brand name uses a choice", () => {
    const setting = { packages: [{ ...ESSENTIAL, includes: [{ label: "Search report", included: "1" }] }, ENHANCED, CONCIERGE] };
    const plain = sevetri();
    expect(withPackageSnapshot(plain, setting)).toBe(plain);
    const c = danielle();
    delete c.packages;
    const snap = withPackageSnapshot(c, setting);
    expect(snap.packages?.map((p) => p.package)).toEqual(OPTIONS);
    expect(snap.packages?.[0].includes).toEqual([{ label: "Search report", included: "1" }]);
    expect(packageOffersFromSetting(setting)[1].includes).toBeUndefined();
  });
});

describe("what was chosen, named downstream", () => {
  const c = danielle();
  const sel = normalizeSelection(c, pick("Concierge", "Essential"));
  const quote = quoteProposal(c, sel);
  const snapshot = buildAcceptedSnapshot({ version: 1, content: c, selection: sel, quote, acceptedAt: "2026-10-29T15:00:00.000Z" });

  it("the snapshot records each brand name's package", () => {
    expect(snapshot.quote.names.map((n) => n.package)).toEqual(["Concierge", "Essential"]);
    expect(snapshot.selection.packages).toEqual({ fold: "Concierge", ci: "Essential" });
    expect(packageLineTitle(snapshot.quote.names[0])).toBe("The Fold — Concierge");
    expect(packageLineTitle({ name: "Prosperall" })).toBe("Prosperall");
  });

  it("the notice headline and the Lawmatics note name each chosen package", () => {
    expect(chosenPackagesText(quote.names)).toBe("The Fold — Concierge; The Confidence Interval — Essential");
    expect(acceptanceHeadline({ clientName: "Danielle Milton", packageName: chosenPackagesText(quote.names), legalTotalCents: quote.legal_total_cents })).toBe(
      "Danielle Milton accepted The Fold — Concierge; The Confidence Interval — Essential · legal $7,447.50",
    );
    const note = acceptanceNoteBody(snapshot, "Danielle Milton");
    expect(note.body).toContain("- The Fold — Concierge: Word mark");
    expect(note.body).toContain("- The Confidence Interval — Essential: Word mark");
  });

  it("the LOE adapter looks up the chosen package on the firm's current list", () => {
    const one = danielle();
    one.names = [one.names[0]];
    const s1 = normalizeSelection(one, { ...defaultSelection(one), packages: { fold: "Essential" } });
    const snap = buildAcceptedSnapshot({ version: 1, content: one, selection: s1, quote: quoteProposal(one, s1), acceptedAt: "2026-10-29T15:00:00.000Z" });
    const firm: ProposalPricing[] = [{ ...ESSENTIAL }, { ...CONCIERGE }];
    const r = loeInputFromAcceptedProposal(snap, { packages: firm, todayIso: "2026-10-29" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.packageName).toBe("Essential");
    expect(r.input.amountPaid).toBe("$3,600");
    const missing = loeInputFromAcceptedProposal(snap, { packages: [{ ...CONCIERGE }], todayIso: "2026-10-29" });
    expect(missing).toEqual({ ok: false, reason: "unknown_package" });
  });
});

describe("the editor's brand name form (parseName)", () => {
  const rand = () => "r";
  function form(extra: Record<string, string | string[]>): FormData {
    const f = new FormData();
    f.set("nameId", "fold");
    f.set("name", "The Fold");
    f.set("mark.0.id", "fold-word");
    f.set("mark.0.kind", "word");
    f.set("mark.0.desc", "Protects the words.");
    f.set("mark.0.preselected", "on");
    f.set("class.0.id", "fold-c1");
    f.set("class.0.label", "Clothing");
    f.set("class.0.preselected", "on");
    for (const [k, v] of Object.entries(extra)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  }

  it("saves the ticked packages, the default and the discount", () => {
    const r = parseName(form({ pkgFields: "1", pkgChoice: "on", pkgOption: ["Essential", "Concierge"], pkgDefault: "Concierge", discountPct: "10" }), danielle(), rand);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.package_choice).toEqual({ options: ["Essential", "Concierge"], default: "Concierge" });
    expect(r.value.discount_pct).toBe(10);
  });

  it("refuses no package, more than 3, a default not ticked, a bad discount, and an own price beside a choice", () => {
    const bad: Array<Record<string, string | string[]>> = [
      { pkgFields: "1", pkgChoice: "on" },
      { pkgFields: "1", pkgChoice: "on", pkgOption: ["A", "B", "C", "D"] },
      { pkgFields: "1", pkgChoice: "on", pkgOption: ["Essential"], pkgDefault: "Concierge" },
      { pkgFields: "1", discountPct: "51" },
      { pkgFields: "1", discountPct: "5.5" },
      { pkgFields: "1", pkgChoice: "on", pkgOption: ["Essential"], overrideBase: "100" },
    ];
    for (const extra of bad) expect(parseName(form(extra), danielle(), rand).ok).toBe(false);
  });

  it("unticking the choice removes it; a form without the fields keeps what was saved", () => {
    const off = parseName(form({ pkgFields: "1" }), danielle(), rand);
    if (!off.ok) throw new Error(off.error);
    expect(off.value.package_choice).toBeUndefined();
    const kept = parseName(form({}), danielle(), rand);
    if (!kept.ok) throw new Error(kept.error);
    expect(kept.value.package_choice).toEqual({ options: OPTIONS, default: "Enhanced" });
  });
});

describe("one price path for the page and the accept", () => {
  it("quoteWithClientClasses carries the package picks through", () => {
    const r = quoteWithClientClasses(danielle(), pick("Essential", "Concierge"), emptyClientClassInput(), { repair: true });
    if (!r.ok) throw new Error("refused");
    expect(r.selection.packages).toEqual({ fold: "Essential", ci: "Concierge" });
    expect(r.quote.legal_total_cents).toBe(360_000 + 445_500);
  });
});

