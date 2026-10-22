import { markKey } from "@/lib/consult/details";
import { MAX_MARKS, type ConsultMark, type MarkType } from "@/lib/consult/vocab";
import type { ReviewedConsultRead } from "@/lib/consult/store";
import { cleanId } from "@/lib/proposal-editor/form";
import { findPackage } from "./package-list";
import { MARK_KIND_DEFAULT_DESC, type MarkKind, type ProposalName, type ProposalPricing } from "./types";
import { MAX_CLASSES_PER_BRAND } from "./validate";

export * from "./prefill-words";

/**
 * What New proposal fills in from a lead or matter. PURE: no database, no
 * clock, no model. The page reads the records through the caller's scoped
 * client and hands them here; the create action hands the consult details it
 * re-read here, so the page and the action cannot disagree about what a
 * consult's marks become.
 *
 * Two kinds of fact, kept apart:
 *  - the lead's and matter's own fields (name, email, company, mark) fill the
 *    client and the first brand name;
 *  - a consult's marks, classes and package fill more ONLY when a person has
 *    reviewed the newest consult details. An unreviewed, unreadable or empty
 *    record fills nothing, and the page says which.
 *
 * Nothing here reads a price from a record. The only prices on the form are the
 * chosen package's.
 */

/* ───────────────────────── the client and the first brand ───────────────── */

export type LeadFill = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  mark_text: string | null;
};

export type MatterFill = {
  id: string;
  lead_id: string | null;
  owner_name: string | null;
  mark_text: string | null;
  title: string | null;
  matter_number: string | null;
};

export type ClientFill = { fullName: string; firstName: string; company: string; clientEmail: string };

/** Full name, first name, company (only when there is both a person and a business) and email. */
export function clientFromLead(lead: LeadFill): ClientFill {
  const person = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  return {
    fullName: person || lead.business_name?.trim() || "",
    firstName: lead.first_name?.trim() ?? "",
    company: person && lead.business_name ? lead.business_name.trim() : "",
    clientEmail: lead.email?.trim() ?? "",
  };
}

/** A lead's brand: its mark, else its business name, else blank. */
export function leadBrand(lead: Pick<LeadFill, "mark_text" | "business_name"> | null): string {
  return lead?.mark_text?.trim() || lead?.business_name?.trim() || "";
}

/** A matter's brand: its mark, else its title, else what its lead gives. */
export function matterBrand(matter: Pick<MatterFill, "mark_text" | "title">, lead: Pick<LeadFill, "mark_text" | "business_name"> | null): string {
  return matter.mark_text?.trim() || matter.title?.trim() || leadBrand(lead);
}

/** How a matter is named on the page: its mark, else its title, else its number. */
export function matterTitle(matter: Pick<MatterFill, "mark_text" | "title" | "matter_number">): string {
  return matter.mark_text?.trim() || matter.title?.trim() || matter.matter_number?.trim() || "Unnamed matter";
}

/* ───────────────────────── the reviewed consult ─────────────────────────── */

/** Why nothing was filled from the consult. `none` is a lead with no consult details at all (the consult strip already says so). */
export type ConsultSkip = "not_reviewed" | "unreadable" | "no_marks" | "no_lead" | "none";

export type ConsultBrand = {
  /** The mark text as the consult gave it (first spelling). */
  name: string;
  kinds: MarkKind[];
  /** The goods/services as class labels, at most MAX_CLASSES_PER_BRAND. */
  classes: string[];
  /** Classes beyond the cap, left off. */
  dropped: number;
};

export type ConsultFill =
  | {
      state: "filled";
      brands: ConsultBrand[];
      reviewedBy: string | null;
      reviewedAt: string;
      recommendedPackage: string | null;
      /** Classes left off across all brand names (3 per brand name). */
      dropped: number;
    }
  | { state: ConsultSkip };

/** The consult marks as brand names: one per distinct mark (case and punctuation insensitive), word/design as the logo kind. */
export function consultBrands(marks: readonly ConsultMark[]): ConsultBrand[] {
  const groups = new Map<string, { name: string; types: MarkType[]; goods: string[] }>();
  for (const m of marks) {
    const name = m.mark.trim();
    if (!name) continue;
    const key = markKey(name) || name.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      if (groups.size >= MAX_MARKS) continue;
      g = { name, types: [], goods: [] };
      groups.set(key, g);
    }
    g.types.push(m.mark_type);
    for (const c of m.classes) {
      const goods = c.goods.trim();
      // A class with no goods has nothing to say to the client; the number is never carried.
      if (goods && !g.goods.some((x) => x.toLowerCase() === goods.toLowerCase())) g.goods.push(goods);
    }
  }
  return [...groups.values()].map((g) => ({
    name: g.name,
    kinds: kindsFor(g.types),
    classes: g.goods.slice(0, MAX_CLASSES_PER_BRAND),
    dropped: Math.max(0, g.goods.length - MAX_CLASSES_PER_BRAND),
  }));
}

/** A word mark is a word mark, a design mark a logo mark, both both; a mark whose type was not stated gets the default pair. Never a guess either way. */
function kindsFor(types: readonly MarkType[]): MarkKind[] {
  const kinds: MarkKind[] = [];
  if (types.includes("word")) kinds.push("word");
  if (types.includes("design")) kinds.push("logo");
  return kinds.length > 0 ? kinds : ["word", "logo"];
}

/**
 * What the newest consult details give. `read` is null when there is no lead to
 * read notes for. The newest record decides (`loadReviewedConsult`), so an older
 * reviewed record is never used while a newer one is unreviewed or unreadable.
 */
export function consultPrefill(read: ReviewedConsultRead | null): ConsultFill {
  if (!read) return { state: "no_lead" };
  if (read.status !== "ok") return { state: "unreadable" };
  if (read.unreadable) return { state: "unreadable" };
  if (read.unreviewed) return { state: "not_reviewed" };
  const details = read.details;
  if (!details) return { state: "none" };
  // loadReviewedConsult only returns reviewed details; this is the same rule, held here too.
  if (!details.review) return { state: "not_reviewed" };
  const brands = consultBrands(details.marks);
  if (brands.length === 0) return { state: "no_marks" };
  return {
    state: "filled",
    brands,
    reviewedBy: details.review.reviewed_by_name?.trim() || null,
    reviewedAt: details.review.reviewed_at,
    recommendedPackage: details.recommended_package?.trim() || null,
    dropped: brands.reduce((n, b) => n + b.dropped, 0),
  };
}

/**
 * The brand names a new proposal starts with. `typed` is the "First brand name"
 * field; `brands` is empty when the consult is not used (then this is exactly
 * today's single typed name with the default pair and no classes).
 *
 *  - a typed name that matches a consult mark is that mark's brand name (the
 *    typed text is the name), and the other marks follow;
 *  - a typed name that matches none stays first with the default pair and no
 *    classes, and the consult marks follow;
 *  - a blank one creates only the consult marks.
 * At most MAX_MARKS names. Every id is unique.
 */
export function buildBrandNames(input: { typed: string; brands: readonly ConsultBrand[]; rand: () => string }): ProposalName[] {
  const taken = new Set<string>();
  const typed = input.typed.trim();
  const typedKey = typed ? markKey(typed) || typed.toLowerCase() : "";
  const keyOf = (b: ConsultBrand) => markKey(b.name) || b.name.toLowerCase();
  const matched = typedKey ? input.brands.find((b) => keyOf(b) === typedKey) : undefined;

  const make = (name: string, kinds: readonly MarkKind[], classes: readonly string[]): ProposalName => ({
    id: cleanId("", "n", taken, input.rand),
    name,
    marks: kinds.map((kind) => ({ id: cleanId("", "m", taken, input.rand), kind, desc: MARK_KIND_DEFAULT_DESC[kind], preselected: true })),
    classes: classes.map((label) => ({ id: cleanId("", "c", taken, input.rand), label, preselected: true })),
  });

  const names: ProposalName[] = [];
  if (typed && !matched) names.push(make(typed, ["word", "logo"], []));
  if (matched) names.push(make(typed, matched.kinds, matched.classes));
  for (const b of input.brands) {
    if (b === matched) continue;
    names.push(make(b.name, b.kinds, b.classes));
  }
  return names.slice(0, MAX_MARKS);
}

/* ───────────────────────── the package ──────────────────────────────────── */

export type PackageFill = { kind: "match"; name: string } | { kind: "unlisted"; asked: string } | { kind: "none" };

/**
 * The consult's package against the firm's CURRENT list, by name (trimmed, case
 * insensitive). `packages` is null when the firm's settings couldn't be read:
 * there is nothing to check against, so nothing is selected and nothing said.
 */
export function packageFromConsult(recommended: string | null | undefined, packages: readonly ProposalPricing[] | null): PackageFill {
  const asked = recommended?.trim() ?? "";
  if (!asked || !packages) return { kind: "none" };
  const found = findPackage(packages, asked);
  return found ? { kind: "match", name: found.package } : { kind: "unlisted", asked };
}

/* ───────────────────────── the words on the page ────────────────────────── */

/** "Oct 21, 2026" in the firm's zone; empty when the stamp is not a date. */
export function reviewDate(value: string | null | undefined, tz: string): string {
  const ms = Date.parse(value ?? "");
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
}

/**
 * The "Filled from" line: each source that was used, and only those. Null when
 * nothing was chosen. Classes left off by the per-brand limit are said here too.
 */
export function filledFromLine(input: {
  matter?: string | null;
  lead?: string | null;
  consult?: { reviewedBy: string | null; reviewedAt: string } | null;
  packageName?: string | null;
  droppedClasses?: number;
  tz: string;
}): string | null {
  const parts: string[] = [];
  if (input.matter) parts.push(`matter ${input.matter}`);
  if (input.lead) parts.push(`lead ${input.lead}`);
  if (input.consult) {
    const date = reviewDate(input.consult.reviewedAt, input.tz);
    parts.push(`consult details reviewed${input.consult.reviewedBy ? ` by ${input.consult.reviewedBy}` : ""}${date ? ` on ${date}` : ""}`);
  }
  if (input.packageName) parts.push(`package ${input.packageName}`);
  if (parts.length === 0) return null;
  const dropped = input.droppedClasses ?? 0;
  const left =
    dropped > 0 ? ` ${dropped} more ${dropped === 1 ? "class wasn't" : "classes weren't"} added (${MAX_CLASSES_PER_BRAND} per brand name).` : "";
  return `Filled from: ${parts.join("; ")}.${left}`;
}
