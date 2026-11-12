/**
 * Sprint 3: ONE description of a proposal, and the one builder that turns it into content.
 *
 * Every way of starting a proposal (a person from scratch, the assistant from a consult, Copilot on request) maps
 * what it knows to a `ProposalDraftSpec` and calls `buildDraftContent`. The spec says WHICH of the firm's packages
 * are offered and how; it has no price, fee-per-class or package number anywhere (the flat-fee matter's own typed
 * fee is the one exception, and it is not a package price). Prices come only from the firm's saved package list,
 * read by the caller and passed in as `firm.pricing`, and from `quoteProposal` at quote time.
 *
 * Pure: no database, no clock, no randomness of its own (ids come from the injected generator, or from an id the
 * spec carries). It never sends, queues or approves anything.
 */

import { buildNewContent, cleanId } from "@/lib/proposal-editor/form";
import { buildGeneralContent } from "@/lib/proposal-editor/general-form";
import { loeIssues } from "@/lib/loe/validate";
import { withLoeSnapshot, type ApprovedLetter } from "./loe-snapshot";
import { normalisePackages } from "./package-list";
import { withPackageSnapshot } from "./package-snapshot";
import { readNewOffer, type NewOffer } from "./new-offer";
import {
  MARK_KIND_DEFAULT_DESC,
  standardProposalPricing,
  type GeneralBlock,
  type GeneralItem,
  type MadeBy,
  type ContentCheck,
  MAX_CHECK_TEXT,
  MAX_CONTENT_CHECKS,
  type MarkKind,
  type ProposalAdjustment,
  type ProposalContent,
  type ProposalMark,
  type ProposalName,
} from "./types";
import { validateContent, type ValidationIssue } from "./validate";

/* ─────────────────────────── the spec ─────────────────────────── */

/** A choice among named packages (1 to 3, all on the firm's list), starting on one of them. */
export type DraftChoice = { options: string[]; start?: string };

/** How a brand name's package is offered. Names only: the prices are the firm's. */
export type DraftOffer =
  | { mode: "one"; package: string }
  | ({ mode: "choice" } & DraftChoice)
  | { mode: "per_mark"; marks: Partial<Record<MarkKind, DraftChoice>> };

export type DraftMark = { id?: string; kind: MarkKind; desc?: string; preselected?: boolean };

export type DraftBrand = {
  id?: string;
  name: string;
  what?: string;
  note?: string;
  /** Default: a word mark and a logo mark. */
  marks?: DraftMark[];
  /** Plain-language classes, at most 3. Never a class number. */
  classes?: Array<string | { id?: string; label: string; preselected?: boolean }>;
  /** Absent: the firm's "New proposals offer". */
  offer?: DraftOffer;
  /** A whole percent, 0 to 50, off this brand name's legal fee. */
  discountPct?: number;
};

/** A credit on the whole proposal. `value` is a whole percent for `percent`, whole cents for `amount`; it comes from words the firm said. */
export type DraftCredit = { id?: string; label: string; kind: "amount" | "percent"; value: number };

/** Something a person should look at, with where it came from and the field it is about. */
export type DraftCheck = ContentCheck;

export type DraftWorkItem = { id?: string; label: string; hours?: number; hourlyRate?: number; value?: number };

/** The flat-fee matter. `flatFee` is the firm's own typed fee in cents; it is not a package price. */
export type DraftGeneral = {
  matterTitle: string;
  summary?: string;
  items: DraftWorkItem[];
  flatFee: number;
  excludes?: string[];
  termsNote?: string;
};

type DraftBase = {
  client: { fullName: string; firstName?: string; company?: string };
  greeting?: string;
  recommendation?: string;
  payUrl?: string;
  expiresOn?: string;
  credits?: DraftCredit[];
  checks?: DraftCheck[];
  madeBy: MadeBy;
  /** The consult a draft came from, a civil date (YYYY-MM-DD). */
  consultDate?: string;
};

export type TrademarkDraftSpec = DraftBase & {
  kind: "trademark";
  /** The package the proposal is priced under unless a brand says otherwise. Default: the firm's "New proposals offer", else the firm's first. */
  package?: string;
  names?: DraftBrand[];
  general?: never;
};

export type GeneralDraftSpec = DraftBase & {
  kind: "general";
  general: DraftGeneral;
  names?: never;
  package?: never;
};

export type ProposalDraftSpec = TrademarkDraftSpec | GeneralDraftSpec;

/* ─────────────────────────── the firm ─────────────────────────── */

export type DraftFirm = {
  /** `client_proposal_setting.pricing`: the firm's package list, includes and office action note. */
  pricing: unknown;
  /** The firm's approved engagement letter, or null. */
  letter: ApprovedLetter | null;
  /** The "New proposals offer". Left out = read from `pricing.new_offer`; null = none. */
  newOffer?: NewOffer | null;
};

export type DraftResult =
  | { ok: true; content: ProposalContent; issues: ValidationIssue[]; checks: DraftCheck[] }
  | { ok: false; error: string; /** Set when the refusal is an unknown package name: the names the firm does have. */ packages?: string[] };

/* ─────────────────────────── the builder ─────────────────────────── */

const MAX_CHOICE = 3;

/**
 * Errors a draft may still carry (it is being built; the editor's checklist lists them): a trademark draft with no
 * brand name or classes yet, a flat-fee draft with no matter, work or fee yet. Everything else refuses.
 */
const INCOMPLETE_OK = /^names(\[\d+\](\.(classes|name|marks)(\[\d+\])?)?)?$/;
const GENERAL_INCOMPLETE_OK = /^general(\.|\[|$)/;

export function packagesRefusal(asked: string, names: string[]): DraftResult {
  return {
    ok: false,
    error: `"${asked}" isn't one of your firm's packages. Your packages are: ${names.join(", ") || "none yet"}.`,
    packages: names,
  };
}

export function buildDraftContent(spec: ProposalDraftSpec, firm: DraftFirm, newId: () => string): DraftResult {
  const list = normalisePackages(firm.pricing);
  const names = list.map((p) => p.package);
  const offer = firm.newOffer === undefined ? readNewOffer(firm.pricing) : firm.newOffer;

  const fullName = spec.client.fullName.trim();
  if (!fullName) return { ok: false, error: "Enter the client's full name." };
  const firstName = spec.client.firstName?.trim() || fullName.split(/\s+/)[0];

  let content: ProposalContent;
  if (spec.kind === "general") {
    if ((spec as { names?: unknown[] }).names?.length) return { ok: false, error: "A flat-fee proposal has no brand names." };
    const built = buildGeneral(spec, newId);
    if (!built.ok) return built;
    content = buildGeneralContent({ firstName, fullName, company: spec.client.company, general: built.value });
  } else {
    if ((spec as { general?: unknown }).general !== undefined) {
      return { ok: false, error: "Only a flat-fee proposal has a matter and a flat fee. Remove it, or make this a flat-fee proposal." };
    }
    const built = buildTrademark(spec, firstName, fullName, { list, names, offer, pricing: firm.pricing }, newId);
    if (!built.ok) return built;
    content = built.value;
  }

  if (spec.greeting?.trim()) content = { ...content, greeting: spec.greeting.trim() };
  if (spec.kind === "trademark" && spec.recommendation?.trim()) content = { ...content, recommendation: spec.recommendation.trim() };

  const credits = buildCredits(spec.credits ?? [], newId);
  if (!credits.ok) return credits;
  if (credits.value.length > 0) content = { ...content, adjustments: credits.value };

  content = withLoeSnapshot(content, firm.letter, true);
  content = { ...content, made_by: spec.madeBy, ...(spec.consultDate ? { made_from: { consult_date: spec.consultDate } } : {}) };
  const checks = cleanChecks(spec.checks ?? []);
  if (checks.length > 0) content = { ...content, checks };

  const issues = validateContent(content);
  const errors = issues.filter((i) => i.level === "error");
  // A flat-fee draft may be wholly unwritten (a person who just chose the client); a half-filled one must be right.
  const unwritten = spec.kind === "general" && !spec.general.matterTitle.trim() && spec.general.items.length === 0 && spec.general.flatFee === 0;
  const incomplete = spec.kind === "general" ? (unwritten ? GENERAL_INCOMPLETE_OK : /^$/) : INCOMPLETE_OK;
  const blocking = errors.filter((i) => !incomplete.test(i.path));
  if (blocking.length > 0) return { ok: false, error: blocking[0].message };
  if (content.loe) {
    const loe = loeIssues(content.loe, spec.kind);
    if (loe.length > 0) return { ok: false, error: loe[0].message };
  }
  return { ok: true, content, issues, checks };
}

/** The checks as stored: words cut to the limit, at most 12, nothing empty. */
function cleanChecks(checks: readonly DraftCheck[]): DraftCheck[] {
  return checks
    .map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHECK_TEXT) }))
    .filter((c) => c.text.length > 0 && c.path.length > 0)
    .slice(0, MAX_CONTENT_CHECKS);
}

type Fail = { ok: false; error: string; packages?: string[] };
type Built<T> = { ok: true; value: T } | Fail;

function buildGeneral(spec: GeneralDraftSpec, newId: () => string): Built<GeneralBlock> {
  const g = spec.general;
  const taken = new Set<string>();
  const items: GeneralItem[] = g.items.map((it) => ({
    id: cleanId(it.id ?? "", "w", taken, newId),
    label: it.label.trim(),
    ...(it.hours !== undefined ? { hours: it.hours } : {}),
    ...(it.hourlyRate !== undefined ? { rate_cents: it.hourlyRate } : {}),
    ...(it.value !== undefined ? { value_cents: it.value } : {}),
  }));
  const excludes = (g.excludes ?? []).map((l) => l.trim()).filter(Boolean);
  return {
    ok: true,
    value: {
      matter_title: g.matterTitle.trim(),
      ...(g.summary?.trim() ? { summary: g.summary.trim() } : {}),
      items,
      fee_cents: g.flatFee,
      ...(excludes.length > 0 ? { excludes } : {}),
      ...(g.termsNote?.trim() ? { terms_note: g.termsNote.trim() } : {}),
    },
  };
}

function buildCredits(credits: DraftCredit[], newId: () => string): Built<ProposalAdjustment[]> {
  const taken = new Set<string>();
  const out: ProposalAdjustment[] = [];
  for (const c of credits) {
    const label = c.label.trim();
    if (!label) return { ok: false, error: "A credit needs a label." };
    out.push({ id: cleanId(c.id ?? "", "a", taken, newId), label, kind: c.kind, value: c.value });
  }
  return { ok: true, value: out };
}

type FirmContext = { list: ReturnType<typeof normalisePackages>; names: string[]; offer: NewOffer | null; pricing: unknown };

function checkNames(asked: string[], names: string[]): Fail | null {
  const bad = asked.find((a) => !names.includes(a));
  return bad === undefined ? null : (packagesRefusal(bad, names) as Fail);
}

function choiceOf(c: DraftChoice, names: string[]): Built<{ options: string[]; default: string }> {
  const options = [...new Set(c.options)];
  if (options.length === 0) return { ok: false, error: "Pick at least one package to offer." };
  if (options.length > MAX_CHOICE) return { ok: false, error: "Offer at most 3 packages." };
  const refused = checkNames([...options, ...(c.start ? [c.start] : [])], names);
  if (refused) return refused;
  const start = c.start ?? options[0];
  if (!options.includes(start)) return { ok: false, error: "The starting package must be one of the packages offered." };
  return { ok: true, value: { options, default: start } };
}

function buildTrademark(spec: TrademarkDraftSpec, firstName: string, fullName: string, firm: FirmContext, newId: () => string): Built<ProposalContent> {
  if (firm.list.length === 0) return { ok: false, error: "Your firm has no packages yet." };
  const asked = spec.package ?? (firm.offer?.mode === "one" ? firm.offer.start : undefined);
  const refusedBase = asked !== undefined ? checkNames([asked], firm.names) : null;
  if (refusedBase) return refusedBase;
  const base = (asked !== undefined ? firm.list.find((p) => p.package === asked) : undefined) ?? firm.list[0];

  const standard = standardProposalPricing(firm.pricing);
  standard.pricing = { ...base };

  const taken = new Set<string>();
  const names: ProposalName[] = [];
  for (const brand of spec.names ?? []) {
    const built = buildBrand(brand, base.package, firm, taken, newId);
    if (!built.ok) return built;
    names.push(built.value);
  }

  const content = buildNewContent({ firstName, fullName, company: spec.client.company, names, standard, rand: newId });
  const withBase = names.length === 0 ? content : { ...content, names };
  return { ok: true, value: withPackageSnapshot(withBase, firm.pricing) };
}

function buildBrand(brand: DraftBrand, basePackage: string, firm: FirmContext, taken: Set<string>, newId: () => string): Built<ProposalName> {
  const id = cleanId(brand.id ?? "", "n", taken, newId);
  const kinds: DraftMark[] = brand.marks && brand.marks.length > 0 ? brand.marks : [{ kind: "word" }, { kind: "logo" }];
  const marks: ProposalMark[] = kinds.map((m) => ({
    id: cleanId(m.id ?? "", "m", taken, newId),
    kind: m.kind,
    desc: m.desc?.trim() || MARK_KIND_DEFAULT_DESC[m.kind],
    preselected: m.preselected ?? true,
  }));
  const classes = (brand.classes ?? []).map((c) => {
    const label = (typeof c === "string" ? c : c.label).trim();
    return { id: cleanId(typeof c === "string" ? "" : (c.id ?? ""), "c", taken, newId), label, preselected: typeof c === "string" ? true : (c.preselected ?? true) };
  });
  const name: ProposalName = {
    id,
    name: brand.name.trim(),
    ...(brand.what?.trim() ? { what: brand.what.trim() } : {}),
    ...(brand.note?.trim() ? { note: brand.note.trim() } : {}),
    marks,
    classes,
  };
  if (brand.discountPct !== undefined) name.discount_pct = brand.discountPct;

  // The offer: this brand's own, else the firm's "New proposals offer".
  const own = brand.offer;
  if (own) {
    if (own.mode === "one") {
      const refused = checkNames([own.package], firm.names);
      if (refused) return refused;
      if (own.package !== basePackage) name.package_choice = { options: [own.package], default: own.package };
    } else if (own.mode === "choice") {
      const c = choiceOf(own, firm.names);
      if (!c.ok) return c;
      name.package_choice = c.value;
    } else {
      for (const kind of Object.keys(own.marks) as MarkKind[]) {
        const choice = own.marks[kind];
        if (!choice) continue;
        const mark = marks.find((m) => m.kind === kind);
        if (!mark) return { ok: false, error: `${brand.name} has no ${kind === "word" ? "word" : "logo"} mark, so its package can't be chosen.` };
        const c = choiceOf(choice, firm.names);
        if (!c.ok) return c;
        mark.package_choice = c.value;
      }
    }
  } else if (firm.offer?.mode === "choice") {
    const value = { options: [...firm.offer.options], default: firm.offer.start };
    if (firm.offer.per === "mark") for (const m of marks) m.package_choice = { ...value, options: [...value.options] };
    else name.package_choice = value;
  }
  return { ok: true, value: name };
}
