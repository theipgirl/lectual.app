import { hash } from "node:crypto";
import { clientFromLead, type LeadFill } from "@/lib/proposals/prefill";
import { findPackage, normalisePackages, packageOption } from "@/lib/proposals/package-list";
import { defaultGreeting, parseMoney, parsePercent } from "@/lib/proposal-editor/form";
import { defaultGeneralGreeting } from "@/lib/proposal-editor/general-form";
import { formatDollars } from "@/lib/proposal-editor/events";
import { COPILOT_WORDS } from "@/lib/proposal-editor/vocabulary";
import { MAX_MARKS } from "@/lib/consult/vocab";
import { buildDraftContent, type DraftBrand as SpecBrand, type DraftCheck, type DraftChoice, type DraftOffer, type ProposalDraftSpec } from "@/lib/proposals/draft-spec";
import { readNewOffer } from "@/lib/proposals/new-offer";
import { isMarkKind, type MarkKind, type ProposalContent } from "@/lib/proposals/types";
import { MAX_CLASSES_PER_BRAND, validateContent, type ValidationIssue } from "@/lib/proposals/validate";

/**
 * The pure rules of Copilot's one draft-only tool, `draft_proposal`. No
 * database, no model, no clock. The executor (`@/lib/agents/copilot-draft-proposal`)
 * reads the lead and the firm's packages through the caller's scoped client and
 * hands them here; the content is built with the SAME helpers New proposal uses
 * (`clientFromLead`, `findPackage` over `normalisePackages`) and the ONE builder `buildDraftContent`
 * (Sprint 5), then checked with `validateContent`.
 *
 * ── THE CONFIRMATION RULE, IN CODE ──────────────────────────────────────────
 * The system prompt tells the model to summarise and ask first. The code does not
 * rely on that:
 *  - a call without `confirmed: true` never writes. It returns the draft, and the
 *    SERVER (not the model) appends the exact summary and "Create this draft?
 *    (draft ref <ref>)" to the answer (`withConfirmation`). The ref is a hash of
 *    the firm and the resolved draft (`draftRef`).
 *  - a call with `confirmed: true` writes only when the user's CURRENT message is a
 *    plain yes (`isConfirmation`) AND the previous answer in the thread carries
 *    the ref of exactly this draft. A different draft, or a "yes, but ...", gets a
 *    new summary instead. At most one draft is created per question.
 *  - neither runs unless a user turn in the visible thread asked for a proposal
 *    (`askedForProposal`).
 * The thread is sent by the browser, i.e. by the signed-in person: they can only
 * confirm for themselves. What the rule stops is the model (or text inside a
 * record it read) creating a draft the person never saw and agreed to.
 */

export const DRAFT_PROPOSAL_TOOL = "draft_proposal";
export const CONFIRM_QUESTION = "Create this draft?";
export const MAX_LEAD_TEXT = 200;
export const MAX_PACKAGE_TEXT = 120;
export const MAX_BRAND_TEXT = 300;
export const MAX_CLASS_TEXT = 300;
export const MAX_DISCOUNT_LABEL = 120;
export const MAX_MATTER_TITLE = 160;
export const MAX_MATTER_SUMMARY = 1200;
export const MAX_ITEM_LABEL = 200;
export const MAX_ITEMS = 20;
export const MAX_EXCLUDES = 10;
export const MAX_EXCLUDE_TEXT = 200;
export const MAX_OFFER_OPTIONS = 3;

/* ───────────────────────── the request ──────────────────────────────────── */

/** A choice among the firm's packages, as the user said it (names, not prices). */
export type DraftChoiceRequest = { options: string[]; start: string | null };

export type DraftBrand = {
  name: string;
  marks: MarkKind[];
  classes: string[];
  /** At most ONE of the next three is set: one package, a choice among packages, or a choice per mark. */
  package: string | null;
  choice: DraftChoiceRequest | null;
  perMark: Partial<Record<MarkKind, DraftChoiceRequest>> | null;
  /** A whole percent, 0 to 50, off this brand name's legal fee. */
  discountPercent: number | null;
};
export type DraftDiscount = { label: string; kind: "amount" | "percent"; /** amount: cents; percent: 0..100 */ value: number };

/** The flat-fee matter. Dollars the user typed are cents here; the fee is the user's own word, never a package price. */
export type DraftMatterItem = { label: string; hours: number | null; /** cents per hour */ hourlyRate: number | null };
export type DraftMatter = { title: string; summary: string | null; items: DraftMatterItem[]; /** cents */ fee: number; excludes: string[] };

export type DraftRequest = {
  lead: string;
  /** The one package for the proposal, when the user named one. */
  packageName: string | null;
  brands: DraftBrand[];
  /** The whole-proposal credit (`credit` is accepted as an alias for `discount`). */
  discount: DraftDiscount | null;
  payLink: string | null;
  /** Set for a flat-fee proposal; then there are no brands and no package. */
  matter: DraftMatter | null;
  confirmed: boolean;
};

/** A request the tool can use, or the one thing to ask the user. */
export type ParsedRequest = { ok: true; value: DraftRequest } | { ok: false; ask: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

function parseChoice(raw: unknown, who: string): { ok: true; value: DraftChoiceRequest } | { ok: false; ask: string } {
  const c = isObj(raw) ? raw : {};
  const options = [...new Set((Array.isArray(c.options) ? c.options : []).map(text).filter(Boolean))];
  if (options.length === 0 || options.length > MAX_OFFER_OPTIONS) {
    return { ok: false, ask: `Which packages (one to ${MAX_OFFER_OPTIONS}) should ${who} offer the client to choose from?` };
  }
  if (options.some((o) => o.length > MAX_PACKAGE_TEXT)) return { ok: false, ask: `Which packages should ${who} offer?` };
  const start = text(c.start) || null;
  if (start && !options.some((o) => o.toLowerCase() === start.toLowerCase())) {
    return { ok: false, ask: `Which of those packages should ${who} start on? It has to be one of the packages offered.` };
  }
  return { ok: true, value: { options, start } };
}

function parseMatter(raw: unknown): { ok: true; value: DraftMatter } | { ok: false; ask: string } {
  const m = isObj(raw) ? raw : {};
  const title = text(m.title);
  if (!title || title.length > MAX_MATTER_TITLE) return { ok: false, ask: "What is the matter called, in a few words? (For example: Management agreement termination.)" };
  const summary = text(m.summary) || null;
  if (summary && summary.length > MAX_MATTER_SUMMARY) return { ok: false, ask: "Describe the matter more briefly." };
  const rawItems = Array.isArray(m.items) ? m.items : [];
  if (rawItems.length === 0) return { ok: false, ask: "What work does the flat fee cover? List each piece of work." };
  if (rawItems.length > MAX_ITEMS) return { ok: false, ask: `A flat-fee proposal can list at most ${MAX_ITEMS} pieces of work. Which ones should it list?` };
  const items: DraftMatterItem[] = [];
  for (const ri of rawItems) {
    const it = isObj(ri) ? ri : {};
    const label = text(it.label);
    if (!label || label.length > MAX_ITEM_LABEL) return { ok: false, ask: "What is each piece of work, in a short line?" };
    let hours: number | null = null;
    if (it.hours != null) {
      const h = typeof it.hours === "number" ? it.hours : Number(it.hours);
      if (!Number.isFinite(h) || h <= 0 || h > 100 || !Number.isInteger(h * 4)) return { ok: false, ask: `How many hours for "${label}"? Use quarter hours, up to 100.` };
      hours = h;
    }
    let hourlyRate: number | null = null;
    if (it.hourlyRate != null) {
      const rate = parseMoney(typeof it.hourlyRate === "number" || typeof it.hourlyRate === "string" ? String(it.hourlyRate) : "", "Hourly rate");
      if (!rate.ok || rate.value <= 0) return { ok: false, ask: `What is the hourly rate for "${label}", in dollars?` };
      hourlyRate = rate.value;
    }
    items.push({ label, hours, hourlyRate });
  }
  const fee = parseMoney(typeof m.fee === "number" || typeof m.fee === "string" ? String(m.fee) : "", "Flat fee");
  if (!fee.ok || fee.value <= 0) return { ok: false, ask: "What is the flat fee, in dollars?" };
  const excludes = (Array.isArray(m.excludes) ? m.excludes : []).map(text).filter(Boolean);
  if (excludes.length > MAX_EXCLUDES || excludes.some((e) => e.length > MAX_EXCLUDE_TEXT)) return { ok: false, ask: `List at most ${MAX_EXCLUDES} things the fee does not include, each in a short line.` };
  return { ok: true, value: { title, summary, items, fee: fee.value, excludes } };
}

export function parseDraftRequest(raw: unknown): ParsedRequest {
  const input = isObj(raw) ? raw : {};
  const ask = (q: string): ParsedRequest => ({ ok: false, ask: q });

  const lead = text(input.lead);
  if (!lead) return ask("Which lead is this proposal for?");
  if (lead.length > MAX_LEAD_TEXT) return ask("Give the lead's name or id in fewer words.");

  const packageName = text(input.package) || null;
  if (packageName && packageName.length > MAX_PACKAGE_TEXT) return ask("Which of the firm's packages should the proposal use?");

  const rawBrands = Array.isArray(input.brands) ? input.brands : [];
  let matter: DraftMatter | null = null;
  if (input.matter != null) {
    if (rawBrands.length > 0) return ask("Is this a flat-fee proposal for a matter, or a trademark proposal with brand names? It can't be both.");
    if (packageName) return ask("A flat-fee proposal has no package. Is it a flat-fee matter, or a trademark proposal with a package?");
    const parsedMatter = parseMatter(input.matter);
    if (!parsedMatter.ok) return ask(parsedMatter.ask);
    matter = parsedMatter.value;
  }

  const brands: DraftBrand[] = [];
  if (!matter) {
    if (rawBrands.length === 0) {
      return ask(packageName
        ? "Which brand names should the proposal cover, with their marks (word, logo) and what each is used for?"
        : "Which of the firm's packages should the proposal use?");
    }
    if (rawBrands.length > MAX_MARKS) return ask(`A proposal can hold at most ${MAX_MARKS} brand names. Which ones should this one cover?`);
    for (const rb of rawBrands) {
      const b = isObj(rb) ? rb : {};
      const name = text(b.name);
      if (!name || name.length > MAX_BRAND_TEXT) return ask("What is each brand name, exactly as it should read?");
      const marks = [...new Set((Array.isArray(b.marks) ? b.marks : []).map((m) => text(m).toLowerCase()))];
      if (marks.length === 0 || !marks.every(isMarkKind)) return ask(`Should ${name} have a word mark, a logo mark, or both?`);
      const classes = (Array.isArray(b.classes) ? b.classes : []).map(text).filter(Boolean);
      if (classes.length === 0) return ask(`What is ${name} used for? Describe each class in plain business words.`);
      if (classes.length > MAX_CLASSES_PER_BRAND) {
        return ask(`${name} has more than ${MAX_CLASSES_PER_BRAND} classes. Which ${MAX_CLASSES_PER_BRAND} should this brand name cover? The rest can go on a second brand name.`);
      }
      if (classes.some((c) => c.length > MAX_CLASS_TEXT)) return ask(`Describe each class for ${name} more briefly.`);
      const kinds = (["word", "logo"] as const).filter((k) => marks.includes(k));

      // At most one way of offering packages for this brand name.
      const own = [b.package != null && text(b.package) !== "", b.choice != null, b.perMark != null].filter(Boolean).length;
      if (own > 1) return ask(`For ${name}, should I offer one package, a choice of packages, or a different package for each mark? Pick one.`);
      let pkg: string | null = null;
      let choice: DraftChoiceRequest | null = null;
      let perMark: Partial<Record<MarkKind, DraftChoiceRequest>> | null = null;
      if (own === 1) {
        if (b.package != null) {
          pkg = text(b.package);
          if (pkg.length > MAX_PACKAGE_TEXT) return ask(`Which package should ${name} use?`);
        } else if (b.choice != null) {
          const c = parseChoice(b.choice, name);
          if (!c.ok) return ask(c.ask);
          choice = c.value;
        } else {
          const pm = isObj(b.perMark) ? b.perMark : {};
          perMark = {};
          for (const kind of ["word", "logo"] as const) {
            if (pm[kind] == null) continue;
            if (!kinds.includes(kind)) return ask(`${name} has no ${kind} mark, so its ${kind} mark can't have its own package. Which marks should ${name} have?`);
            const c = parseChoice(pm[kind], `the ${kind} mark of ${name}`);
            if (!c.ok) return ask(c.ask);
            perMark[kind] = c.value;
          }
          if (Object.keys(perMark).length === 0) return ask(`Which package choices should the marks of ${name} have?`);
        }
      }
      let discountPercent: number | null = null;
      if (b.discountPercent != null) {
        const d = typeof b.discountPercent === "number" ? b.discountPercent : Number(b.discountPercent);
        if (!Number.isInteger(d) || d < 0 || d > 50) return ask(`What percent off should ${name} get? Use a whole number from 0 to 50.`);
        discountPercent = d;
      }
      brands.push({ name, marks: [...kinds], classes, package: pkg, choice, perMark, discountPercent });
    }
  }

  let discount: DraftDiscount | null = null;
  const rawDiscount = input.discount ?? input.credit;
  if (rawDiscount != null) {
    const d = isObj(rawDiscount) ? rawDiscount : {};
    const kind = d.kind === "amount" || d.kind === "percent" ? d.kind : null;
    if (!kind) return ask("Is the discount a dollar amount or a percent?");
    const label = text(d.label) || "Discount";
    if (label.length > MAX_DISCOUNT_LABEL) return ask("What should the discount be called, in a few words?");
    const rawValue = typeof d.value === "number" || typeof d.value === "string" ? String(d.value) : "";
    const value = kind === "amount" ? parseMoney(rawValue, "Discount") : parsePercent(rawValue, "Discount");
    if (!value.ok) return ask(`${value.error} What is the discount?`);
    discount = { label, kind, value: value.value };
  }

  const payLink = text(input.payLink) || null;
  if (payLink) {
    const issue = validateContent({}, { pay_url: payLink }).find((i) => i.path === "pay_url");
    if (issue) return ask(`${issue.message} What is the pay link?`);
  }

  return { ok: true, value: { lead, packageName, brands, discount, payLink, matter, confirmed: input.confirmed === true } };
}

/* ───────────────────────── the draft ────────────────────────────────────── */

export type DraftLead = LeadFill;

/** The request with every package name resolved against the firm's list (canonical spelling). What the ref covers. */
export type ResolvedOffer =
  | { mode: "one"; package: string }
  | { mode: "choice"; options: string[]; start: string }
  | { mode: "per_mark"; marks: Partial<Record<MarkKind, { options: string[]; start: string }>> }
  | { mode: "firm" };

export type BuiltDraft = {
  leadId: string;
  clientName: string;
  clientEmail: string | null;
  /** The package the proposal is priced under; the matter's title for a flat-fee proposal. */
  packageName: string;
  /** Each brand's offer, resolved; empty for a flat-fee proposal. */
  resolved: ResolvedOffer[];
  content: ProposalContent;
  payLink: string | null;
  /** Problems the user must fix before anything is created (a class number in a label ...). */
  blocking: string[];
  /** Problems the draft may carry; staff fix them in the editor. */
  issues: string[];
  /** The plain summary the user confirms. */
  summary: string;
};

export type BuildResult =
  | { ok: true; draft: BuiltDraft }
  | { ok: false; kind: "package_not_found"; packages: string[] }
  | { ok: false; kind: "needs_package"; packages: string[] }
  | { ok: false; kind: "needs_changes"; problems: string[] }
  | { ok: false; kind: "no_client_name" };

/** Paths that come from what the user said: an error there is theirs to fix before anything is created. */
const USER_PATHS = /^(names\[|adjustments\[|pay_url|general)/;

/**
 * The draft for `request` and this lead, against the firm's saved package list
 * (`pricing` = `client_proposal_setting.pricing`, or `{}` when none is saved: the
 * same list New proposal offers). A package that is not on the list is never
 * guessed. Prices come from the package only; a flat-fee proposal's fee is the
 * user's own typed figure, shown in the summary they confirm. The content is
 * built by `buildDraftContent`, the one builder every way of starting a proposal uses.
 */
export function buildDraft(request: DraftRequest, lead: DraftLead, pricing: unknown, rand: () => string): BuildResult {
  const packages = normalisePackages(pricing ?? {});
  const names = packages.map((p) => p.package);
  const client = clientFromLead(lead);
  if (!client.fullName) return { ok: false, kind: "no_client_name" };
  const firmOffer = readNewOffer(pricing ?? {});

  const checks: DraftCheck[] = [];
  let spec: ProposalDraftSpec;
  const resolved: ResolvedOffer[] = [];
  let packageName: string;
  let packageWords: string | null = null;

  if (request.matter) {
    const m = request.matter;
    packageName = m.title;
    spec = {
      kind: "general",
      client: { fullName: client.fullName, firstName: client.firstName, ...(client.company ? { company: client.company } : {}) },
      general: {
        matterTitle: m.title,
        ...(m.summary ? { summary: m.summary } : {}),
        items: m.items.map((it) => ({ label: it.label, ...(it.hours != null ? { hours: it.hours } : {}), ...(it.hourlyRate != null ? { hourlyRate: it.hourlyRate } : {}) })),
        flatFee: m.fee,
        ...(m.excludes.length > 0 ? { excludes: m.excludes } : {}),
      },
      credits: [],
      checks,
      madeBy: "copilot",
    };
    checks.push({ source: "copilot", path: "general.fee_cents", text: COPILOT_WORDS.checkFeeTyped });
  } else {
    const resolve = (asked: string): string | null => findPackage(packages, asked)?.package ?? null;
    const unknown = (): BuildResult => ({ ok: false, kind: "package_not_found", packages: names });
    const resolveChoice = (c: DraftChoiceRequest): { options: string[]; start: string } | BuildResult => {
      const options: string[] = [];
      for (const o of c.options) {
        const r = resolve(o);
        if (!r) return unknown();
        if (!options.includes(r)) options.push(r);
      }
      const start = c.start ? resolve(c.start) : options[0];
      if (!start) return unknown();
      return { options, start };
    };

    let top: string | null = null;
    if (request.packageName) {
      top = resolve(request.packageName);
      if (!top) return unknown();
    }
    if (!top && !firmOffer && request.brands.some((b) => !b.package && !b.choice && !b.perMark)) return { ok: false, kind: "needs_package", packages: names };

    const brands: SpecBrand[] = [];
    request.brands.forEach((b, i) => {
      let offer: DraftOffer | undefined;
      let res: ResolvedOffer = { mode: "firm" };
      if (b.package) {
        const r = resolve(b.package);
        if (!r) return;
        offer = { mode: "one", package: r };
        res = { mode: "one", package: r };
      } else if (b.choice) {
        const c = resolveChoice(b.choice);
        if ("ok" in c) return;
        offer = { mode: "choice", ...c };
        res = { mode: "choice", ...c };
      } else if (b.perMark) {
        const marks: Partial<Record<MarkKind, DraftChoice>> = {};
        const rmarks: Partial<Record<MarkKind, { options: string[]; start: string }>> = {};
        for (const kind of ["word", "logo"] as const) {
          const c0 = b.perMark[kind];
          if (!c0) continue;
          const c = resolveChoice(c0);
          if ("ok" in c) return;
          marks[kind] = c;
          rmarks[kind] = c;
        }
        offer = { mode: "per_mark", marks };
        res = { mode: "per_mark", marks: rmarks };
      } else if (top) {
        // The user named one package for the proposal: it wins over the firm's own setting.
        offer = { mode: "one", package: top };
        res = { mode: "one", package: top };
      }
      resolved.push(res);
      brands.push({
        name: b.name,
        marks: b.marks.map((kind) => ({ kind })),
        classes: b.classes,
        ...(offer ? { offer } : {}),
        ...(b.discountPercent != null ? { discountPct: b.discountPercent } : {}),
      });
      if (b.discountPercent != null) checks.push({ source: "copilot", path: `names[${i}].discount_pct`, text: COPILOT_WORDS.checkBrandDiscount });
    });
    // A package name the loop above could not resolve: report the first one, creating nothing.
    for (const b of request.brands) {
      const asked = [b.package, ...(b.choice ? [...b.choice.options, b.choice.start] : []), ...Object.values(b.perMark ?? {}).flatMap((c) => (c ? [...c.options, c.start] : []))];
      const bad = asked.find((a): a is string => !!a && !resolve(a));
      if (bad) return unknown();
    }
    if (request.discount) checks.push({ source: "copilot", path: "adjustments[0]", text: COPILOT_WORDS.checkCredit });

    const basePackage = top ?? (firmOffer?.mode === "one" ? firmOffer.start : packages[0].package);
    packageName = basePackage;
    const base = packages.find((p) => p.package === basePackage);
    packageWords = base ? packageOption(base).summary : null;
    spec = {
      kind: "trademark",
      client: { fullName: client.fullName, firstName: client.firstName, ...(client.company ? { company: client.company } : {}) },
      ...(top ? { package: top } : {}),
      names: brands,
      credits: [],
      checks,
      madeBy: "copilot",
    };
  }
  if (request.discount) {
    spec.credits = [{ label: request.discount.label, kind: request.discount.kind, value: request.discount.value }];
    if (request.matter) checks.push({ source: "copilot", path: "adjustments[0]", text: COPILOT_WORDS.checkCredit });
  }
  if (!request.payLink) checks.push({ source: "copilot", path: "pay_url", text: COPILOT_WORDS.checkNoPayLink });

  // `letter: null` ON PURPOSE: what this function returns is summarised back to the model (the tool result), and the firm's
  // engagement letter never comes near one. The executor attaches the letter at the moment of the insert, after the user's
  // confirmation (`copilot-draft-proposal.ts`, `attachFirmLetter`).
  const built = buildDraftContent(spec, { pricing: pricing ?? {}, letter: null }, rand);
  if (!built.ok) {
    if (built.packages) return { ok: false, kind: "package_not_found", packages: built.packages };
    return { ok: false, kind: "needs_changes", problems: built.problems ?? [built.error] };
  }
  let content = built.content;
  // A lead with no first name keeps an empty one (the editor asks for it); the builder's stand-in is the first word of the full name.
  if (!client.firstName.trim()) {
    content = {
      ...content,
      client: { ...content.client, first_name: "" },
      greeting: request.matter ? defaultGeneralGreeting("") : defaultGreeting(""),
    };
  }

  const found = validateContent(content, { pay_url: request.payLink, client_email: client.clientEmail || null });
  const blocking = found.filter((i) => i.level === "error" && USER_PATHS.test(i.path)).map((i) => i.message);
  const issues = found.filter((i) => !(i.level === "error" && USER_PATHS.test(i.path))).map((i) => i.message);

  const draft: Omit<BuiltDraft, "summary"> = {
    leadId: lead.id,
    clientName: client.fullName,
    clientEmail: client.clientEmail || null,
    packageName,
    resolved,
    content,
    payLink: request.payLink,
    blocking: [...new Set(blocking)],
    issues: [...new Set(issues)],
  };
  return { ok: true, draft: { ...draft, summary: draftSummary(draft, packageWords, request) } };
}

const cents = (n: number) => formatDollars(n);

function offerWords(o: ResolvedOffer): string | null {
  if (o.mode === "firm") return null;
  if (o.mode === "one") return `${COPILOT_WORDS.package.toLowerCase()} ${o.package}`;
  if (o.mode === "choice") return `${COPILOT_WORDS.choiceOf} ${o.options.join(", ")}, ${COPILOT_WORDS.startingOn} ${o.start}`;
  return Object.entries(o.marks)
    .map(([kind, c]) => `${kind} mark: ${COPILOT_WORDS.choiceOf} ${c.options.join(", ")}, ${COPILOT_WORDS.startingOn} ${c.start}`)
    .join("; ");
}

/** " (1 hr at $500/hr)" for a piece of work, or "" when no hours or rate were given. */
function workTime(it: DraftMatterItem): string {
  const rate = it.hourlyRate != null ? cents(it.hourlyRate) + "/hr" : "";
  if (it.hours == null) return rate ? " (" + rate + ")" : "";
  const unit = it.hours === 1 ? "hr" : "hrs";
  return " (" + it.hours + " " + unit + (rate ? " at " + rate : "") + ")";
}

function draftSummary(draft: Omit<BuiltDraft, "summary">, packageWords: string | null, request: DraftRequest): string {
  const lines = [`- ${COPILOT_WORDS.client}: ${draft.clientName}${draft.clientEmail ? ` (${draft.clientEmail})` : ""}`];
  if (request.matter) {
    const m = request.matter;
    lines.push(`- ${COPILOT_WORDS.matter}: ${m.title}`);
    for (const it of m.items) {
      const hours = workTime(it);
      lines.push(`- ${COPILOT_WORDS.work}: ${it.label}${hours}`);
    }
    lines.push(`- ${COPILOT_WORDS.flatFee}: ${cents(m.fee)}`);
    if (m.excludes.length > 0) lines.push(`- ${COPILOT_WORDS.notIncluded}: ${m.excludes.join("; ")}`);
  } else {
    if (request.packageName || packageWords) lines.push(`- ${COPILOT_WORDS.package}: ${draft.packageName}${packageWords ? ` (${packageWords})` : ""}`);
    request.brands.forEach((b, i) => {
      const marks = b.marks.length === 2 ? "word and logo marks" : `${b.marks[0]} mark`;
      const offer = draft.resolved[i] ? offerWords(draft.resolved[i]) : null;
      const bits = [`${marks}`, `classes: ${b.classes.join("; ")}`, ...(offer ? [offer] : []), ...(b.discountPercent != null ? [`${b.discountPercent}% ${COPILOT_WORDS.brandDiscount}`] : [])];
      lines.push(`- ${b.name}: ${bits.join("; ")}`);
    });
  }
  if (request.discount) {
    const amount = request.discount.kind === "amount" ? `${cents(request.discount.value)} off` : `${request.discount.value}% off`;
    lines.push(`- ${COPILOT_WORDS.discount}: ${request.discount.label}, ${amount}`);
  }
  lines.push(`- ${COPILOT_WORDS.payLink}: ${draft.payLink ?? COPILOT_WORDS.noPayLink}`);
  return lines.join("\n");
}

/** The leads a name search found, as the model may show them. */
export type LeadChoice = { id: string; name: string; businessName: string | null; email: string | null };

/* ───────────────────────── the confirmation ─────────────────────────────── */

/**
 * The firm and the resolved draft, hashed. Equal refs mean the same lead,
 * package, brand names, marks, classes, discount and pay link for the same firm.
 */
export function draftRef(
  orgId: string,
  draft: Pick<BuiltDraft, "leadId" | "packageName" | "payLink"> & { resolved?: ResolvedOffer[] },
  request: Pick<DraftRequest, "brands" | "discount"> & { matter?: DraftMatter | null },
): string {
  // Package names are the RESOLVED ones (the firm's spelling), so "concierge" and "Concierge" are the same request.
  const brands = request.brands.map((b) => [b.name, b.marks, b.classes, b.discountPercent]);
  const canonical = JSON.stringify([orgId, draft.leadId, draft.packageName, draft.resolved ?? [], brands, request.discount, draft.payLink, request.matter ?? null]);
  return hash("sha256", canonical, "hex").slice(0, 12);
}

export const refTag = (ref: string): string => `(draft ref ${ref})`;

/** What the user is asked, added to the answer by the server: the exact draft and the question. */
export function confirmationBlock(summary: string, ref: string): string {
  return [
    COPILOT_WORDS.heading,
    summary,
    COPILOT_WORDS.draftOnly,
    `${CONFIRM_QUESTION} ${refTag(ref)}`,
  ].join("\n");
}

/** The model's answer with any "Create this draft?" it wrote removed, then the server's block. */
export function withConfirmation(answer: string, summary: string, ref: string): string {
  const own = answer.replace(/create this draft\?/gi, "").trim();
  const block = confirmationBlock(summary, ref);
  return own ? `${own}\n\n${block}` : block;
}

const CONFIRM_WORDS =
  /^(?:(?:yes|yep|yeah|y|ok|okay|sure|confirm|confirmed|correct|please|go ahead|do it|please do|create it|create the draft|create this draft|create that draft|looks good|sounds good|that'?s right|thanks|thank you)\s*)+$/;

/** A plain yes, and nothing else: "yes", "Yes, create it.", "ok go ahead". "Yes but change the package" is not one. */
export function isConfirmation(message: string): boolean {
  const m = message
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.,!;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!m || m.length > 60) return false;
  if (/\b(?:no|not|don'?t|but|change|instead|wait|except|without|cancel|stop)\b/.test(m)) return false;
  return CONFIRM_WORDS.test(m);
}

/** True when the previous answer asked to confirm exactly this draft. */
export function confirmsDraft(previousAnswer: string | null, ref: string): boolean {
  return !!previousAnswer && previousAnswer.includes(`${CONFIRM_QUESTION} ${refTag(ref)}`);
}

/** A user turn in the visible thread asked for a proposal (or a quote). */
export function askedForProposal(userTurns: readonly string[]): boolean {
  return userTurns.some((t) => /\b(?:proposals?|quotes?)\b/i.test(t));
}

/** Everything the tool needs to know about the thread, computed by the server from the request. */
export type ConfirmationContext = {
  orgId: string;
  /** The user's current message, trimmed, without any page context. */
  question: string;
  /** The answer right before it, when the thread's last turn is an answer. */
  previousAnswer: string | null;
  /** Every user turn the request carried, the current one included. */
  userTurns: string[];
};

export function confirmationContext(orgId: string, question: string, history: ReadonlyArray<{ role: "user" | "assistant"; content: string }>): ConfirmationContext {
  const last = history[history.length - 1];
  return {
    orgId,
    question: question.trim(),
    previousAnswer: last && last.role === "assistant" ? last.content : null,
    userTurns: [...history.filter((t) => t.role === "user").map((t) => t.content), question],
  };
}

export type { ValidationIssue };
