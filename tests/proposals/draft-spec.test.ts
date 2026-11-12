import { describe, it, expect, expectTypeOf } from "vitest";
import {
  buildDraftContent,
  type DraftBrand,
  type DraftFirm,
  type DraftResult,
  type GeneralDraftSpec,
  type ProposalDraftSpec,
  type TrademarkDraftSpec,
} from "@/lib/proposals/draft-spec";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import { loeIssues } from "@/lib/loe/validate";
import type { ApprovedLetter } from "@/lib/proposals/loe-snapshot";
import type { PackageOffer, ProposalContent, Selection } from "@/lib/proposals/types";
import { sevetri } from "./fixture";
import { danielle, ESSENTIAL, ENHANCED, CONCIERGE, OPTIONS } from "./danielle-fixture";
import { sevetriCustom, S_OPTIONS } from "./sevetri-custom-fixture";
import { fold, WORD_OPTIONS, DESIGN_OPTIONS } from "./mark-fixture";
import { faithe } from "./general-fixture";

/** Sprint 3 D1/D2/F1/F2/F3: ONE description of a proposal, built by the one builder. */

const pkg = ({ includes: _i, custom_discount: _c, ...p }: PackageOffer) => {
  void _i;
  void _c;
  return p;
};

function firmPricing(over: Record<string, unknown> = {}) {
  const s = sevetri();
  return {
    ...pkg(CONCIERGE),
    packages: [pkg(ESSENTIAL), pkg(ENHANCED), pkg(CONCIERGE)],
    includes: s.includes,
    office_action_note: s.office_action_note,
    ...over,
  };
}

const LETTER: ApprovedLetter = { id: "t-1", kind: "trademark", version: 2, title: "Engagement letter", body: "Dear {{client_name}},\n\nThis letter confirms our engagement.\n\nFirm" };
const GENERAL_LETTER: ApprovedLetter = { id: "t-2", kind: "general", version: 1, title: "General engagement letter", body: "Dear {{client_name}},\n\nThis letter covers the work.\n\nFirm" };

function firm(over: Partial<DraftFirm> = {}): DraftFirm {
  return { pricing: firmPricing(), letter: null, ...over };
}

let n = 0;
const newId = () => `x${(n++).toString(36).padStart(4, "0")}`;

function built(spec: ProposalDraftSpec, f: DraftFirm = firm()): ProposalContent {
  const r = buildDraftContent(spec, f, newId);
  if (!r.ok) throw new Error(r.error);
  return r.content;
}

const stripMeta = ({ made_by: _b, made_from: _f, ...rest }: ProposalContent) => {
  void _b;
  void _f;
  return rest;
};
const errorsOf = (c: ProposalContent) => validateContent(c).filter((i) => i.level === "error");

/* ───────────────────────── the three fixtures, from specs ───────────────────────── */

const SEVETRI_SPEC: TrademarkDraftSpec = {
  kind: "trademark",
  madeBy: "person",
  client: { fullName: "Sevetri Wilson", firstName: "Sevetri", company: "Prosperall" },
  recommendation: sevetri().recommendation,
  package: "Concierge",
  names: sevetri().names.map(
    (nm): DraftBrand => ({
      id: nm.id,
      name: nm.name,
      what: nm.what,
      note: nm.note,
      marks: nm.marks.map((m) => ({ id: m.id, kind: m.kind, desc: m.desc })),
      classes: nm.classes.map((c) => ({ id: c.id, label: c.label })),
      offer: { mode: "per_mark", marks: { word: { options: S_OPTIONS, start: "Concierge" }, logo: { options: S_OPTIONS, start: "Concierge" } } },
    }),
  ),
};

const DANIELLE_SPEC: TrademarkDraftSpec = {
  kind: "trademark",
  madeBy: "person",
  client: { fullName: "Danielle Milton", firstName: "Danielle" },
  package: "Concierge",
  names: danielle().names.map(
    (nm): DraftBrand => ({
      id: nm.id,
      name: nm.name,
      marks: nm.marks.map((m) => ({ id: m.id, kind: m.kind, desc: m.desc })),
      classes: nm.classes.map((c) => ({ id: c.id, label: c.label })),
      offer: { mode: "choice", options: OPTIONS, start: "Enhanced" },
      ...(nm.discount_pct ? { discountPct: nm.discount_pct } : {}),
    }),
  ),
};

const FAITHE_SPEC: GeneralDraftSpec = {
  kind: "general",
  madeBy: "person",
  client: { fullName: "Faithe Williams", firstName: "Faithe" },
  general: {
    matterTitle: faithe().general!.matter_title,
    summary: faithe().general!.summary,
    items: faithe().general!.items.map((i) => ({ id: i.id, label: i.label, hours: i.hours, hourlyRate: i.rate_cents })),
    flatFee: 50_000,
    excludes: faithe().general!.excludes,
    termsNote: faithe().general!.terms_note,
  },
};

describe("F1: buildDraftContent reproduces the existing fixtures", () => {
  it("Sevetri: two brands, a package per mark, equals the fixture where it defines content", () => {
    const content = built(SEVETRI_SPEC);
    const expected = sevetriCustom();
    // The fixture's one custom discount is data the firm's list never carries; everything else is the fixture's.
    expect(stripMeta(content)).toEqual({ ...expected, packages: expected.packages!.map(({ custom_discount: _c, ...p }) => { void _c; return p; }) });
    expect(errorsOf(content)).toEqual([]);
  });

  it("Danielle: a package per brand, 10% off one brand: names, packages, pricing and client equal the fixture", () => {
    const content = built(DANIELLE_SPEC);
    const expected = danielle();
    expect(content.names).toEqual(expected.names);
    expect(content.packages).toEqual(expected.packages);
    expect(content.pricing).toEqual(expected.pricing);
    expect(content.client).toEqual(expected.client);
    expect(content.adjustments).toEqual([]);
    expect(errorsOf(content)).toEqual([]);
  });

  it("Danielle quotes the pinned figures", () => {
    const content = built(DANIELLE_SPEC);
    const pick = (f: string, c: string): Selection => ({ ...defaultSelection(content), packages: { fold: f, ci: c } });
    const of = (sel: Selection, id: string) => quoteProposal(content, sel).names.find((x) => x.id === id)!;
    for (const [p, legal] of [["Essential", 360_000], ["Enhanced", 407_500], ["Concierge", 495_000]] as const) expect(of(pick(p, "Enhanced"), "fold").legal_cents).toBe(legal);
    for (const [p, legal] of [["Essential", 249_750], ["Enhanced", 292_500], ["Concierge", 445_500]] as const) expect(of(pick("Enhanced", p), "ci").legal_cents).toBe(legal);
  });

  it("the mark-fixture shape (word mark on one package, design mark on two) builds and quotes like the fixture", () => {
    const f = fold();
    const spec: TrademarkDraftSpec = {
      kind: "trademark",
      madeBy: "person",
      client: { fullName: f.client.full_name, firstName: f.client.first_name },
      package: f.pricing.package,
      names: f.names.map((nm) => ({
        id: nm.id,
        name: nm.name,
        marks: nm.marks.map((m) => ({ id: m.id, kind: m.kind, desc: m.desc, preselected: m.preselected })),
        classes: nm.classes.map((c) => ({ id: c.id, label: c.label })),
        offer: { mode: "per_mark", marks: { word: { options: WORD_OPTIONS, start: "Enhanced" }, logo: { options: DESIGN_OPTIONS, start: "Essential" } } },
      })),
    };
    const content = built(spec);
    expect(content.names).toEqual(f.names);
    expect(quoteProposal(content, defaultSelection(content)).legal_total_cents).toBe(quoteProposal(f, defaultSelection(f)).legal_total_cents);
  });

  it("Faithe: the flat-fee proposal equals the fixture's content, fee $500, and validates", () => {
    const content = built(FAITHE_SPEC);
    expect(stripMeta(content)).toEqual(faithe());
    expect(errorsOf(content)).toEqual([]);
    expect(quoteProposal(content, {}).legal_total_cents).toBe(50_000);
  });
});

describe("F2: a package the firm doesn't have is refused, with the list", () => {
  it("an unknown package in a choice, a mark choice, a one-package offer or the base is refused and names the firm's packages", () => {
    const list = ["Essential", "Enhanced", "Concierge"];
    const bad: DraftBrand[] = [
      { name: "A", offer: { mode: "choice", options: ["Essential", "Platinum"] } },
      { name: "A", offer: { mode: "per_mark", marks: { word: { options: ["Platinum"] } } } },
      { name: "A", offer: { mode: "one", package: "Platinum" } },
    ];
    for (const brand of bad) {
      const r = buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [brand] }, firm(), newId);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.packages).toEqual(list);
        expect(r.error).toContain("Platinum");
        expect(r.error).toContain("Essential, Enhanced, Concierge");
      }
    }
    const base = buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, package: "Platinum" }, firm(), newId);
    expect(base).toMatchObject({ ok: false, packages: list });
  });

  it("no spec type or sample carries a price, cents, base or per-class field for a package", () => {
    type Keys<T> = T extends readonly (infer U)[] ? Keys<U> : T extends object ? { [K in keyof T & string]: K | Keys<NonNullable<T[K]>> }[keyof T & string] : never;
    type Forbidden = Extract<Keys<TrademarkDraftSpec>, `${string}${"price" | "Price" | "cents" | "Cents" | "base" | "Base" | "perClass" | "per_class" | "fee" | "Fee"}${string}`>;
    expectTypeOf<Forbidden>().toEqualTypeOf<never>();

    const scan = (v: unknown, path: string[] = []): string[] =>
      Array.isArray(v)
        ? v.flatMap((x, i) => scan(x, [...path, String(i)]))
        : v && typeof v === "object"
          ? Object.entries(v).flatMap(([k, x]) => [...(/price|cents|base|per_?class|fee/i.test(k) ? [[...path, k].join(".")] : []), ...scan(x, [...path, k])])
          : [];
    expect(scan(SEVETRI_SPEC)).toEqual([]);
    expect(scan(DANIELLE_SPEC)).toEqual([]);
  });

  it("a price smuggled onto a spec never reaches the content: package numbers come only from the firm's list", () => {
    const sneaky = { ...DANIELLE_SPEC, base_cents: 1, pricing: { base_cents: 1 }, names: DANIELLE_SPEC.names!.map((x) => ({ ...x, price_override: { base_cents: 1 } })) } as unknown as ProposalDraftSpec;
    const content = built(sneaky);
    expect(content.pricing.base_cents).toBe(495_000);
    expect(content.names.every((x) => x.price_override === undefined)).toBe(true);
  });
});

describe("F3: the firm's approved letter", () => {
  it("attaches the letter through withLoeSnapshot, and the Sprint 2 check passes", () => {
    const content = built(DANIELLE_SPEC, firm({ letter: LETTER }));
    expect(content.loe).toEqual({ kind: "trademark", template_id: "t-1", template_version: 2, title: "Engagement letter", body: LETTER.body });
    expect(loeIssues(content.loe, "trademark")).toEqual([]);
  });

  it("adds no loe key when the firm has none", () => {
    expect("loe" in built(DANIELLE_SPEC, firm({ letter: null }))).toBe(false);
  });

  it("a general spec gets only a general-kind letter; a trademark letter is not attached to it", () => {
    expect(built(FAITHE_SPEC, firm({ letter: GENERAL_LETTER })).loe?.kind).toBe("general");
    expect("loe" in built(FAITHE_SPEC, firm({ letter: LETTER }))).toBe(false);
    expect("loe" in built(DANIELLE_SPEC, firm({ letter: GENERAL_LETTER }))).toBe(false);
  });
});

describe("D1: three brands, three offers, one discount; the setting changes the start", () => {
  const THREE: TrademarkDraftSpec = {
    kind: "trademark",
    madeBy: "assistant",
    consultDate: "2026-11-10",
    client: { fullName: "Mira Okafor", firstName: "Mira" },
    names: [
      { name: "Alpha", classes: ["Software"], offer: { mode: "one", package: "Concierge" } },
      { name: "Beta", classes: ["Coaching", "Events"], offer: { mode: "choice", options: ["Essential", "Enhanced"], start: "Enhanced" }, discountPct: 15 },
      { name: "Gamma", classes: ["Apparel"], offer: { mode: "per_mark", marks: { word: { options: ["Enhanced", "Concierge"], start: "Concierge" } } } },
    ],
  };

  it("builds valid content whose snapshot lists the firm's current packages", () => {
    const content = built(THREE);
    expect(errorsOf(content)).toEqual([]);
    expect(content.packages!.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);
    const [a, b, g] = content.names;
    expect(a.package_choice).toEqual({ options: ["Concierge"], default: "Concierge" });
    expect(b.package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Enhanced" });
    expect(b.discount_pct).toBe(15);
    expect(g.package_choice).toBeUndefined();
    expect(g.marks.find((m) => m.kind === "word")!.package_choice).toEqual({ options: ["Enhanced", "Concierge"], default: "Concierge" });
    expect(g.marks.find((m) => m.kind === "logo")!.package_choice).toBeUndefined();
    expect(content.made_by).toBe("assistant");
    expect(content.made_from).toEqual({ consult_date: "2026-11-10" });
  });

  it("a second build with the setting changed starts on the new package", () => {
    const base = { kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [{ name: "Alpha", classes: ["Software"] }] } as const;
    const onEnhanced = built(base, firm({ pricing: firmPricing({ new_offer: { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" } }) }));
    expect(onEnhanced.names[0].package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Enhanced" });
    const onEssential = built(base, firm({ pricing: firmPricing({ new_offer: { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Essential" } }) }));
    expect(onEssential.names[0].package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Essential" });
    // Per mark: every mark carries the choice, the brand carries none.
    const perMark = built(base, firm({ pricing: firmPricing({ new_offer: { mode: "choice", per: "mark", options: ["Enhanced", "Concierge"], start: "Concierge" } }) }));
    expect(perMark.names[0].package_choice).toBeUndefined();
    expect(perMark.names[0].marks.every((m) => m.package_choice?.default === "Concierge")).toBe(true);
    // One package: the proposal is priced under it, no choice.
    const one = built(base, firm({ pricing: firmPricing({ new_offer: { mode: "one", per: "brand", options: ["Essential"], start: "Essential" } }) }));
    expect(one.pricing.package).toBe("Essential");
    expect(one.names[0].package_choice).toBeUndefined();
  });

  it("with no setting: one package, the firm's first, as today", () => {
    const c = built({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [{ name: "Alpha", classes: ["Software"] }] }, firm({ pricing: firmPricing({ packages: [pkg(ENHANCED), pkg(CONCIERGE)], ...pkg(ENHANCED) }) }));
    expect(c.pricing.package).toBe("Enhanced");
    expect(c.names[0].package_choice).toBeUndefined();
    expect(c.packages).toBeUndefined();
  });

  it("a stale setting naming a package the firm no longer has is dropped, never an error", () => {
    const c = built({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [{ name: "A", classes: ["x"] }] }, firm({ pricing: firmPricing({ new_offer: { mode: "choice", per: "brand", options: ["Platinum", "Essential"], start: "Platinum" } }) }));
    expect(c.names[0].package_choice).toEqual({ options: ["Essential"], default: "Essential" });
  });
});

describe("D2: flat-fee specs", () => {
  it("title, up to 20 work items, a fee and excludes build general content with no brand, package list or USPTO fee", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ label: `Work ${i + 1}`, hours: 0.25 }));
    const c = built({ kind: "general", madeBy: "copilot", client: { fullName: "Ana Ruiz" }, general: { matterTitle: "Lease review", items, flatFee: 120_000, excludes: ["Litigation"] } });
    expect(c.kind).toBe("general");
    expect(c.names).toEqual([]);
    expect(c.packages).toBeUndefined();
    expect(c.pricing).toMatchObject({ base_cents: 0, gov_per_class_cents: 0 });
    expect(quoteProposal(c, {}).gov_total_cents).toBe(0);
    expect(c.general!.items).toHaveLength(20);
    expect(errorsOf(c)).toEqual([]);
  });

  it("a 21st work item is refused", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ label: `Work ${i + 1}` }));
    expect(buildDraftContent({ kind: "general", madeBy: "person", client: { fullName: "Ana Ruiz" }, general: { matterTitle: "Lease", items, flatFee: 1000 } }, firm(), newId).ok).toBe(false);
  });

  it("a trademark spec carrying flat-fee fields is refused, and so is a flat-fee spec carrying brands", () => {
    const withGeneral = { ...DANIELLE_SPEC, general: FAITHE_SPEC.general } as unknown as ProposalDraftSpec;
    expect(buildDraftContent(withGeneral, firm(), newId)).toMatchObject({ ok: false });
    const withNames = { ...FAITHE_SPEC, names: DANIELLE_SPEC.names } as unknown as ProposalDraftSpec;
    expect(buildDraftContent(withNames, firm(), newId)).toMatchObject({ ok: false });
  });

  it("a person's own flat-fee start (no matter, work or fee yet) still builds a draft the editor can finish", () => {
    const r = buildDraftContent({ kind: "general", madeBy: "person", client: { fullName: "Ana Ruiz" }, general: { matterTitle: "", items: [], flatFee: 0 } }, firm(), newId);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.issues.some((i) => i.level === "error")).toBe(true);
  });
});

describe("the builder is pure and keeps the checks it was given", () => {
  it("generated ids are unique and come from the injected generator", () => {
    const c = built({ kind: "trademark", madeBy: "person", client: { fullName: "Ana Ruiz" }, names: [{ name: "A", classes: ["x", "y"] }, { name: "B", classes: ["z"] }] });
    const ids = c.names.flatMap((x) => [x.id, ...x.marks.map((m) => m.id), ...x.classes.map((k) => k.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => /^[a-z]-x[0-9a-z]{4}$/.test(i))).toBe(true);
  });

  it("returns the spec's checks (source and field path) beside the content and never inside it", () => {
    const r: DraftResult = buildDraftContent({ ...DANIELLE_SPEC, checks: [{ text: "Confirm the second brand's classes", source: "consult", path: "names[1].classes" }] }, firm(), newId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.checks).toEqual([{ text: "Confirm the second brand's classes", source: "consult", path: "names[1].classes" }]);
      expect(JSON.stringify(r.content)).not.toContain("Confirm the second brand");
    }
  });

  it("refuses an empty client name, an unknown discount, a credit with no label", () => {
    expect(buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: " " } }, firm(), newId).ok).toBe(false);
    expect(buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: "A B" }, names: [{ name: "A", classes: ["x"], discountPct: 80 }] }, firm(), newId).ok).toBe(false);
    expect(buildDraftContent({ kind: "trademark", madeBy: "person", client: { fullName: "A B" }, credits: [{ label: " ", kind: "amount", value: 100 }] }, firm(), newId).ok).toBe(false);
  });

  it("a whole-proposal credit becomes an adjustment", () => {
    const c = built({ ...DANIELLE_SPEC, credits: [{ label: "Consult credit", kind: "amount", value: 10_000 }] });
    expect(c.adjustments).toHaveLength(1);
    expect(c.adjustments[0]).toMatchObject({ label: "Consult credit", kind: "amount", value: 10_000 });
  });
});
