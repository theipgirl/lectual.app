import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  chosenMarkPackage,
  defaultSelection,
  isFixedOffer,
  normalizeSelection,
  quoteProposal,
  usesMarkPackages,
} from "@/lib/proposals/pricing";
import { quoteWithClientClasses, emptyClientClassInput } from "@/lib/proposals/client-classes";
import { validateContent } from "@/lib/proposals/validate";
import { publicContent, buildAcceptedSnapshot } from "@/lib/proposals/public";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { chosenPackagesText, packageLineTitle } from "@/lib/proposals/name-package";
import { acceptanceHeadline, acceptanceNoteBody } from "@/lib/proposals/accept-followups";
import { LOE_REFUSAL_TEXT, loeInputFromAcceptedProposal } from "@/lib/proposals/loe-adapter";
import { parseName } from "@/lib/proposal-editor/form";
import type { ProposalContent, ProposalPricing, Selection } from "@/lib/proposals/types";
import { sevetri } from "./fixture";
import { danielle, ENHANCED, ESSENTIAL, CONCIERGE } from "./danielle-fixture";
import { DESIGN_OPTIONS, WORD_OPTIONS, fold } from "./mark-fixture";

/** The Fold with the design mark ticked or not, and the two marks' picks. */
function sel(design: boolean, word?: unknown, logo?: unknown): Selection {
  const c = fold();
  const picks: Record<string, unknown> = {};
  if (word !== undefined) picks["fold-word"] = word;
  if (logo !== undefined) picks["fold-logo"] = logo;
  return { ...defaultSelection(c), "fold-logo": design, packages: picks as Record<string, string> };
}

const name = (content: ProposalContent, s: Selection) => quoteProposal(content, s).names[0];

describe("Spec 7 figures: a package per mark, 2 classes", () => {
  it("the word mark only, on Enhanced: $3,250 legal, USPTO $700", () => {
    const c = fold();
    const q = quoteProposal(c, defaultSelection(c));
    expect(q.legal_total_cents).toBe(325_000);
    expect(q.gov_total_cents).toBe(70_000);
    expect(q.names[0].marks).toEqual([{ id: "fold-word", kind: "word", desc: "Protects the words.", second: false, price_cents: 325_000, package: "Enhanced", base_cents: 325_000 }]);
    expect(q.names[0].package).toBeUndefined();
  });

  it("plus the design mark on Essential (second mark, 20% off $2,775 = $2,220): $5,470 legal, USPTO $1,400", () => {
    const q = quoteProposal(fold(), sel(true));
    const [word, design] = q.names[0].marks;
    expect([word.package, word.price_cents, word.second]).toEqual(["Enhanced", 325_000, false]);
    expect([design.package, design.base_cents, design.price_cents, design.second]).toEqual(["Essential", 277_500, 222_000, true]);
    expect(q.legal_total_cents).toBe(547_000);
    expect(q.gov_total_cents).toBe(140_000);
    expect(q.gov_class_count).toBe(4);
  });

  it("the USPTO fee is never discounted: $350 x classes per ticked mark", () => {
    const q = quoteProposal(fold(), sel(true, "Concierge", "Enhanced"));
    expect(q.names[0].gov_cents).toBe(2 * 35_000 * 2);
  });

  it("one added class (3 classes): word Enhanced $4,075 + design Essential 20% off $3,600 = $2,880; USPTO $2,100", () => {
    const input = { entries: {}, added: { fold: [{ text: "Candles", on: true }] } };
    const r = quoteWithClientClasses(fold(), sel(true), input);
    if (!r.ok) throw new Error("refused");
    const [word, design] = r.quote.names[0].marks;
    expect(word.price_cents).toBe(407_500);
    expect([design.base_cents, design.price_cents]).toEqual([360_000, 288_000]);
    expect(r.quote.legal_total_cents).toBe(695_500);
    expect(r.quote.gov_total_cents).toBe(210_000);
  });

  it("one added class under each package the marks can take", () => {
    const input = { entries: {}, added: { fold: [{ text: "Candles", on: true }] } };
    // word: Essential $3,600 / Enhanced $4,075 / Concierge $4,950; design (second, 20% off): Essential $2,880 / Enhanced $3,260.
    const word: Array<[string, number]> = [["Essential", 360_000], ["Enhanced", 407_500], ["Concierge", 495_000]];
    const design: Array<[string, number]> = [["Essential", 288_000], ["Enhanced", 326_000]];
    for (const [wp, wc] of word) {
      for (const [dp, dc] of design) {
        const r = quoteWithClientClasses(fold(), sel(true, wp, dp), input);
        if (!r.ok) throw new Error("refused");
        const marks = r.quote.names[0].marks;
        expect([marks[0].package, marks[0].price_cents, marks[1].package, marks[1].price_cents]).toEqual([wp, wc, dp, dc]);
        expect(r.quote.legal_total_cents).toBe(wc + dc);
        expect(r.quote.gov_total_cents).toBe(210_000);
      }
    }
  });

  it("the design mark unticked adds nothing, whatever its pick", () => {
    expect(quoteProposal(fold(), sel(false, "Enhanced", "Enhanced")).legal_total_cents).toBe(325_000);
  });

  it("the name's discount_pct comes off the name's total once", () => {
    const c = fold();
    c.names[0].discount_pct = 10;
    const n = name(c, sel(true));
    expect(n.legal_cents).toBe(492_300);
    expect(n.discount_cents).toBe(54_700);
    expect(n.gov_cents).toBe(140_000);
  });
});

describe("mark picks are names only, checked against that mark's options", () => {
  it("a forged, unknown or not-offered pick falls back to the mark's default", () => {
    const c = fold();
    for (const bad of [undefined, "Platinum", "enhanced", 495_000, { base_cents: 1 }, ""]) {
      const s = sel(true, bad, bad);
      expect(chosenMarkPackage(c, c.names[0], c.names[0].marks[0], s)?.package).toBe("Enhanced");
      expect(normalizeSelection(c, s).packages).toEqual({ "fold-word": "Enhanced", "fold-logo": "Essential" });
      expect(quoteProposal(c, normalizeSelection(c, s)).legal_total_cents).toBe(547_000);
    }
    // Concierge is offered to the word mark but not to the design mark.
    expect(normalizeSelection(c, sel(true, "Concierge", "Concierge")).packages).toEqual({ "fold-word": "Concierge", "fold-logo": "Essential" });
  });

  it("normalizeSelection keeps real ids and package names only, never a price", () => {
    const s = normalizeSelection(fold(), { "fold-word": true, legal_total_cents: 1, packages: { "fold-word": "Concierge", fold: "Essential", other: "Essential" } });
    expect(Object.keys(s).sort()).toEqual(["fold-c1", "fold-c2", "fold-logo", "fold-word", "packages"]);
    expect(s.packages).toEqual({ "fold-word": "Concierge", "fold-logo": "Essential" });
  });

  it("a mark-level choice is a choice: never a fixed offer", () => {
    const c = fold();
    c.names[0].marks = [c.names[0].marks[0]];
    c.names[0].classes = [c.names[0].classes[0]];
    expect(usesMarkPackages(c, c.names[0])).toBe(true);
    expect(isFixedOffer(c)).toBe(false);
    delete c.names[0].marks[0].package_choice;
    expect(isFixedOffer(c)).toBe(true);
  });

  it("a mark without a choice on such a name keeps the proposal's own price", () => {
    const c = fold();
    delete c.names[0].marks[1].package_choice;
    const [, design] = name(c, sel(true)).marks;
    // Concierge (the proposal's package) at 2 classes is flat $4,950, 20% off as the second mark.
    expect(design).toEqual({ id: "fold-logo", kind: "logo", desc: "Protects the design.", second: true, price_cents: 396_000 });
  });
});

describe("validateContent: mark-level choices", () => {
  const paths = (c: unknown) => validateContent(c).filter((i) => i.level === "error").map((i) => i.path);

  it("the fixture is valid", () => {
    expect(paths(fold())).toEqual([]);
  });

  it("refuses a name-level AND a mark-level choice on one brand name", () => {
    const c = fold();
    c.names[0].package_choice = { options: ["Essential"], default: "Essential" };
    expect(paths(c)).toContain("names[0].package_choice");
  });

  it("refuses an unknown option, a default not offered, too many, no packages, an own price, and a mark id that is a name id", () => {
    const unknown = fold();
    unknown.names[0].marks[1].package_choice = { options: ["Essential", "Platinum"], default: "Essential" };
    expect(paths(unknown)).toContain("names[0].marks[1].package_choice.options");

    const badDefault = fold();
    badDefault.names[0].marks[1].package_choice = { options: ["Essential"], default: "Enhanced" };
    expect(paths(badDefault)).toContain("names[0].marks[1].package_choice.default");

    const many = fold();
    many.packages = [...many.packages!, { ...ESSENTIAL, package: "Extra" }];
    many.names[0].marks[0].package_choice = { options: ["Essential", "Enhanced", "Concierge", "Extra"], default: "Essential" };
    expect(paths(many)).toContain("names[0].marks[0].package_choice.options");

    const none = fold();
    delete none.packages;
    expect(paths(none)).toContain("names[0].marks[0].package_choice");

    const own = fold();
    own.names[0].price_override = { base_cents: 100_000 };
    expect(paths(own)).toContain("names[0].price_override");

    const clash = fold();
    clash.names.push({ ...sevetri().names[0], id: "fold-word2" });
    clash.names[0].marks[0].id = "fold-word2";
    expect(paths(clash)).toContain("names[0].marks[0].package_choice");
  });
});

describe("publicContent, the snapshot and the editor", () => {
  it("publishes each mark's choice", () => {
    const out = publicContent(fold());
    expect(out.names[0].marks.map((m) => m.package_choice)).toEqual([
      { options: WORD_OPTIONS, default: "Enhanced" },
      { options: DESIGN_OPTIONS, default: "Essential" },
    ]);
  });

  it("withPackageSnapshot copies the firm's list when only a mark uses a choice", () => {
    const c = fold();
    delete c.packages;
    expect(withPackageSnapshot(c, { packages: [ESSENTIAL, ENHANCED, CONCIERGE] }).packages?.map((p) => p.package)).toEqual(WORD_OPTIONS);
  });

  const rand = () => "r";
  function form(extra: Record<string, string | string[]>): FormData {
    const f = new FormData();
    f.set("nameId", "fold");
    f.set("name", "The Fold");
    f.set("mark.0.id", "fold-word");
    f.set("mark.0.kind", "word");
    f.set("mark.0.desc", "Protects the words.");
    f.set("mark.0.preselected", "on");
    f.set("mark.2.id", "fold-logo");
    f.set("mark.2.kind", "logo");
    f.set("mark.2.desc", "Protects the design.");
    f.set("class.0.id", "fold-c1");
    f.set("class.0.label", "Clothing");
    f.set("class.0.preselected", "on");
    for (const [k, v] of Object.entries(extra)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  }

  it("parseName saves a choice per mark (rows posted by their own numbers)", () => {
    const r = parseName(
      form({ pkgFields: "1", "mark.0.pkgChoice": "on", "mark.0.pkgOption": ["Essential", "Enhanced"], "mark.0.pkgDefault": "Enhanced", "mark.2.pkgChoice": "on", "mark.2.pkgOption": "Essential" }),
      fold(),
      rand,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.value.marks.map((m) => m.package_choice)).toEqual([{ options: ["Essential", "Enhanced"], default: "Enhanced" }, { options: ["Essential"], default: "Essential" }]);
    expect(r.value.package_choice).toBeUndefined();
  });

  it("parseName refuses both levels, an own price beside a mark choice, and a bad mark choice; keeps choices when the fields aren't posted", () => {
    const bad: Array<Record<string, string | string[]>> = [
      { pkgFields: "1", pkgChoice: "on", pkgOption: "Essential", "mark.0.pkgChoice": "on", "mark.0.pkgOption": "Essential" },
      { pkgFields: "1", overrideBase: "100", "mark.0.pkgChoice": "on", "mark.0.pkgOption": "Essential" },
      { pkgFields: "1", "mark.0.pkgChoice": "on" },
      { pkgFields: "1", "mark.0.pkgChoice": "on", "mark.0.pkgOption": ["A", "B", "C", "D"] },
      { pkgFields: "1", "mark.0.pkgChoice": "on", "mark.0.pkgOption": "Essential", "mark.0.pkgDefault": "Concierge" },
    ];
    for (const extra of bad) expect(parseName(form(extra), fold(), rand).ok).toBe(false);
    const kept = parseName(form({}), fold(), rand);
    if (!kept.ok) throw new Error(kept.error);
    expect(kept.value.marks.map((m) => m.package_choice?.default)).toEqual(["Enhanced", "Essential"]);
    const off = parseName(form({ pkgFields: "1" }), fold(), rand);
    if (!off.ok) throw new Error(off.error);
    expect(off.value.marks.every((m) => m.package_choice === undefined)).toBe(true);
  });
});

describe("what was chosen, named downstream", () => {
  const c = fold();
  const s = normalizeSelection(c, sel(true));
  const quote = quoteProposal(c, s);
  const snapshot = buildAcceptedSnapshot({ version: 1, content: c, selection: s, quote, acceptedAt: "2026-10-29T15:00:00.000Z" });
  const firm: ProposalPricing[] = [{ ...ESSENTIAL }, { ...ENHANCED }, { ...CONCIERGE }];

  it("the receipt / staff line names the package per mark", () => {
    expect(packageLineTitle(snapshot.quote.names[0])).toBe("The Fold — word mark, Enhanced; design mark, Essential");
    expect(snapshot.selection.packages).toEqual({ "fold-word": "Enhanced", "fold-logo": "Essential" });
  });

  it("the accept notice and the Lawmatics note name the package per mark", () => {
    expect(chosenPackagesText(quote.names)).toBe("The Fold — word mark, Enhanced; design mark, Essential");
    expect(acceptanceHeadline({ clientName: "Danielle Milton", packageName: chosenPackagesText(quote.names), legalTotalCents: quote.legal_total_cents })).toBe(
      "Danielle Milton accepted The Fold — word mark, Enhanced; design mark, Essential · legal $5,470",
    );
    expect(acceptanceNoteBody(snapshot, "Danielle Milton").body).toContain("- The Fold — word mark, Enhanced; design mark, Essential: Word mark + Logo mark");
  });

  it("the LOE adapter: two marks on different packages is 'Choose the LOE template', never a guess", () => {
    expect(loeInputFromAcceptedProposal(snapshot, { packages: firm, todayIso: "2026-10-29" })).toEqual({ ok: false, reason: "mixed_mark_packages" });
    expect(LOE_REFUSAL_TEXT.mixed_mark_packages).toMatch(/different packages/);
  });

  it("the LOE adapter: the word mark alone drafts under its package", () => {
    const s1 = normalizeSelection(c, sel(false, "Concierge"));
    const snap = buildAcceptedSnapshot({ version: 1, content: c, selection: s1, quote: quoteProposal(c, s1), acceptedAt: "2026-10-29T15:00:00.000Z" });
    const r = loeInputFromAcceptedProposal(snap, { packages: firm, todayIso: "2026-10-29" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.packageName).toBe("Concierge");
    expect(r.input.amountPaid).toBe("$4,950");
  });

  it("the LOE adapter: both marks on one package drafts under it", () => {
    const s2 = normalizeSelection(c, sel(true, "Essential", "Essential"));
    const snap = buildAcceptedSnapshot({ version: 1, content: c, selection: s2, quote: quoteProposal(c, s2), acceptedAt: "2026-10-29T15:00:00.000Z" });
    const r = loeInputFromAcceptedProposal(snap, { packages: firm, todayIso: "2026-10-29" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.packageName).toBe("Essential");
    expect(r.input.amountPaid).toBe("$4,995");
  });

  it("the accept path's one price helper carries the mark picks", () => {
    const r = quoteWithClientClasses(c, sel(true, "Concierge", "Enhanced"), emptyClientClassInput(), { repair: true });
    if (!r.ok) throw new Error("refused");
    expect(r.selection.packages).toEqual({ "fold-word": "Concierge", "fold-logo": "Enhanced" });
    expect(r.quote.legal_total_cents).toBe(495_000 + 260_000);
  });
});

/* ── Old content prices byte for byte as before: the quote engine as it stood on main before Spec 7 (2b9c95d) ── */
const BEFORE = "2b9c95d";
let oldPricing: string | null = null;
try {
  oldPricing = execSync(`git show ${BEFORE}:src/lib/proposals/pricing.ts`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
} catch {
  oldPricing = null;
}

describe("old content prices byte for byte as before", () => {
  it.skipIf(oldPricing === null)("sevetri, danielle and a mixed selection quote exactly as the pre-Spec 7 engine did", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spec7-pricing-"));
    const file = join(dir, "pricing-before.ts");
    writeFileSync(file, oldPricing!);
    const before = (await import(/* @vite-ignore */ file)) as typeof import("@/lib/proposals/pricing");
    const cases: Array<[ProposalContent, Selection]> = [];
    const s = sevetri();
    cases.push([s, before.defaultSelection(s)]);
    cases.push([s, Object.fromEntries(Object.keys(before.defaultSelection(s)).map((k, i) => [k, i % 2 === 0]))]);
    const d = danielle();
    for (const p of WORD_OPTIONS) cases.push([d, { ...before.defaultSelection(d), packages: { fold: p, ci: "Essential" } }]);
    const disc = danielle();
    disc.names[0].discount_pct = 15;
    cases.push([disc, before.defaultSelection(disc)]);
    for (const [content, selection] of cases) {
      expect(JSON.stringify(quoteProposal(content, selection))).toBe(JSON.stringify(before.quoteProposal(content, selection)));
      expect(JSON.stringify(defaultSelection(content))).toBe(JSON.stringify(before.defaultSelection(content)));
      expect(JSON.stringify(normalizeSelection(content, selection))).toBe(JSON.stringify(before.normalizeSelection(content, selection)));
      expect(isFixedOffer(content)).toBe(before.isFixedOffer(content));
    }
  });

  it("no mark-level key on a quote without mark choices", () => {
    const c = sevetri();
    for (const n of quoteProposal(c, defaultSelection(c)).names) {
      for (const m of n.marks) expect(Object.keys(m)).toEqual(["id", "kind", "desc", "second", "price_cents"]);
    }
  });
});
