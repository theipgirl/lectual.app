// Packages PDF spec builder.
//
// Turns a consult's inputs (client, company, consult time, marks with their categories) and the FIRM (its name, time
// zone, package list, optional art) into a fully formatted spec: every string the renderer draws, ready to draw.
// Port of the spec half of lawmatics-mcp `src/consult-brief/pdf/spec.ts`.
//
// Prices come from the firm's package list and nowhere else (`normalisePackages` of `client_proposal_setting.pricing`, passed
// in). A firm's art (./art.ts) carries benefit copy per package NAME; its cells for classes, price and the additional-class fee
// are only COMPARED with the list, and any disagreement throws `template_config_mismatch`, so a stale template can never ship a
// wrong price. The firm with no art gets a plain table (classes, price, additional-class fee).
//
// Unfinished input is refused, never drawn: an attachment that ships with placeholders is worse than none, so this throws
// `PackagesSpecError` and the caller reports why the PDF is missing.
//
// Errors carry a code and a field name only. They never quote client, company, mark or category text.

import type { ProposalPricing } from "@/lib/proposals/types";
import { packagesArtForSlug, type PackageTemplate, type PackagesArt, type TemplateRow } from "./art";

export type { PackageTemplate, PackagesArt, TemplateRow };

// ------------------------------------------------------------------ errors

export const PACKAGES_SPEC_ERROR_CODES = [
  "missing_client",
  "missing_company",
  "missing_consult_date",
  "placeholder_text",
  "no_marks",
  "missing_mark_name",
  "mark_without_categories",
  "empty_category",
  "class_number_in_category",
  "too_many_marks",
  "template_config_mismatch",
  "content_overflow",
  "missing_firm",
  "no_packages",
  "too_many_packages",
  "invalid_expiry",
  "invalid_time_zone",
] as const;

export type PackagesSpecErrorCode = (typeof PACKAGES_SPEC_ERROR_CODES)[number];

/** Why no packages PDF can be built. `message` is made from `code` and `field` only. */
export class PackagesSpecError extends Error {
  readonly code: PackagesSpecErrorCode;
  readonly field: string;
  constructor(code: PackagesSpecErrorCode, field: string) {
    super(`packages PDF: ${code} (${field})`);
    this.name = "PackagesSpecError";
    this.code = code;
    this.field = field;
  }
}

/** A plain-language reason for each code, for the brief's attachment line. */
export const PACKAGES_SPEC_ERROR_REASONS: Readonly<Record<PackagesSpecErrorCode, string>> = Object.freeze({
  missing_client: "the client's name is not recorded",
  missing_company: "the company is not recorded on the intake",
  missing_consult_date: "the consult time is not on the appointment",
  placeholder_text: "a field still holds placeholder text",
  no_marks: "no mark is confirmed yet",
  missing_mark_name: "a mark has no name",
  mark_without_categories: "no class categories were named for the mark yet",
  empty_category: "a class category is blank",
  class_number_in_category: "a category names a class number, which never appears on the client PDF",
  too_many_marks: "more marks than the page can show",
  template_config_mismatch: "the firm's package copy disagrees with its package list",
  content_overflow: "the class descriptions are too long to fit the page",
  missing_firm: "the firm's name is not recorded",
  no_packages: "the firm has no packages saved",
  too_many_packages: "the firm has more packages than the page can show side by side",
  invalid_expiry: "the proposal's validity is not a number of days",
  invalid_time_zone: "the firm's time zone is not recognised",
});

// ------------------------------------------------------------------ constants

/** Tier order of the page's columns follows the list (or the art's template); at most this many fit side by side. */
export const MAX_TIERS = 4;

/** Rows whose cells the package list owns, by label. */
export const CONFIG_ROWS = Object.freeze({
  classes: "Classes Included",
  youPay: "YOU PAY",
  additionalClass: "Additional Class Fee",
});

/** At most this many mark cards fit side by side on page 2. */
export const MAX_MARKS = 3;

/** Proposal validity in days when the caller does not say (the source's firm config value). */
export const DEFAULT_PROPOSAL_EXPIRY_DAYS = 7;

export const NOT_RECORDED = "not recorded";

// ------------------------------------------------------------------ spec

export type Cell = { kind: "check" } | { kind: "dash" } | { kind: "text"; text: string };

export type SpecRow = {
  label: string;
  /** À-la-carte value, drawn after the label as "(value)". */
  value: string | null;
  /** Small italic line under the label. */
  note: string | null;
  cells: Cell[];
  /** Row style: disc / tev / pay / addl, or '' for a plain row. */
  cls: "" | "disc" | "tev" | "pay" | "addl";
};

export type SpecCategory = { text: string; priority: boolean };

export type SpecMark = {
  /** As given. */
  name: string;
  /** As drawn: word marks are shown in capitals, as on the USPTO record. */
  display: string;
  categories: SpecCategory[];
};

/** What the renderer draws as the firm's identity (from the firm's name, or its art). */
export type SpecChrome = {
  wordmark: string;
  established: string | null;
  footerBold: string;
  footerRest: string;
  author: string;
};

export type PackagesSpec = {
  /** Display name, with the intake prefix when there is one ("Ms. Kenasha Paul"). */
  client: string;
  /** The client's company, or null when the intake has none. Null drops the company segment from the eyebrow; it never drops the PDF. */
  company: string | null;
  /** Consult month in the firm's zone, "October 2026". */
  date: string;
  /** "October 28, 2026, 7", completed by the PDF as "… days from the date of receipt." */
  expiry: string;
  /** The full sentence, as drawn in both notes. */
  expirySentence: string;
  /** Page 2 heading and the PDF's Title. */
  title: string;
  /** `<Client>_Packages_<Mark>.pdf`. */
  filename: string;
  chrome: SpecChrome;
  tiers: { name: string; price: string }[];
  rows: SpecRow[];
  fees: {
    /** Legal fee per class beyond a package's included classes, "$N", or "$N to $M" when the packages differ. */
    additionalClass: string;
    /** USPTO filing fee, "$N per class" (or a range). */
    governmentPerClass: string;
  };
  marks: SpecMark[];
  /** The consult start; also the PDF's creation date, so a re-render is byte-identical. */
  consultStart: Date;
};

export type PackagesSpecInput = {
  /** Client name without prefix, e.g. "Kenasha Paul". Used for the filename. */
  client: string;
  /** Intake prefix ("Ms."), applied to the displayed name when present. */
  clientPrefix?: string | null;
  /** Absent when undefined, null, blank, or the facts' "not recorded" value. */
  company?: string | null;
  consultStart: Date | string;
  marks: { name: string; categories: { text: string; priority?: boolean }[] }[];
};

/** The firm, passed in by the caller (read through the scoped or org-fenced client). Nothing here is a default for one firm. */
export type PackagesFirm = {
  /** The firm's display name. */
  name: string;
  /** IANA zone the consult's calendar day and the expiry are counted in. */
  timeZone: string;
  /** `normalisePackages(client_proposal_setting.pricing)`: names and prices, first one the default. */
  packages: ProposalPricing[];
  /** Days a proposal stays open, counted from the day after the consult. Default `DEFAULT_PROPOSAL_EXPIRY_DAYS`. */
  expiryDays?: number;
  /** The org's slug, to look up the firm's art. Ignored when `art` is given. */
  slug?: string | null;
  /** Explicit art (tests): `null` forces the plain version, `undefined` looks it up from `slug`. */
  art?: PackagesArt | null;
};

// ------------------------------------------------------------------ helpers

/** Cents → "$1,950" (whole dollars) or "$1,950.50". */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString("en-US", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const BRACKETED = /\[[^\]]*\]/;

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

/** A required text field: non-blank and not a leftover [placeholder]. */
function required(value: unknown, missing: PackagesSpecErrorCode, field: string): string {
  const v = clean(value);
  if (!v) throw new PackagesSpecError(missing, field);
  if (BRACKETED.test(v)) throw new PackagesSpecError("placeholder_text", field);
  return v;
}

/** The company, or null when absent (undefined, null, blank, "not recorded"). A leftover [placeholder] is refused. */
function optionalCompany(value: unknown): string | null {
  const v = clean(value);
  if (!v || v.toLowerCase() === NOT_RECORDED) return null;
  if (BRACKETED.test(v)) throw new PackagesSpecError("placeholder_text", "company");
  return v;
}

/** "Ms." + "Kenasha Paul" -> "Ms. Kenasha Paul", without doubling a prefix the name already carries. */
function withPrefix(prefix: string | null, name: string): string {
  const p = prefix?.trim();
  if (!p) return name;
  return name.toLowerCase().startsWith(`${p.toLowerCase()} `) ? name : `${p} ${name}`;
}

/** Page-1 eyebrow: "Prepared for <client> · <company> · <Month YYYY>", without an empty segment. */
export function eyebrowText(spec: Pick<PackagesSpec, "client" | "company" | "date">): string {
  return `Prepared for ${[spec.client, spec.company, spec.date].filter((x): x is string => !!x).join(" · ")}`;
}

function tierDisplayName(name: string): string {
  return `${name.toUpperCase()}™`;
}

function classesCell(n: number): string {
  return `${n} ${n === 1 ? "Class" : "Classes"}`;
}

/** Template tier names carry a trailing ™ and are upper-case; compare loosely on the words. */
function sameTierName(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[™®]/g, "").trim().toLowerCase();
  return norm(a) === norm(b);
}

function cellFor(v: string): Cell {
  const t = v.trim();
  if (t === "✔" || t === "✓") return { kind: "check" };
  if (t === "—" || t === "-" || t === "") return { kind: "dash" };
  return { kind: "text", text: t };
}

function rowCls(cls: string | undefined): SpecRow["cls"] {
  return cls === "disc" || cls === "tev" || cls === "pay" || cls === "addl" ? cls : "";
}

function mismatch(field: string): never {
  throw new PackagesSpecError("template_config_mismatch", field);
}

/** Filename-safe: accents dropped, anything but letters and digits becomes "_". */
export function filenamePart(s: string, fallback: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['"‘’“”`]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return out || fallback;
}

/** `<Client>_Packages_<Mark>.pdf`; with several marks the FIRST mark names the file. */
export function packagesFilename(client: string, marks: { name: string }[]): string {
  return `${filenamePart(client, "Client")}_Packages_${filenamePart(marks[0]?.name ?? "", "Marks")}.pdf`;
}

// ------------------------------------------------------------------ dates

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The local calendar date (YYYY-MM-DD) of `now` in `timeZone`. */
export function localDateKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The local calendar date `days` after the one containing `now`. */
export function localDateKeyOffset(now: Date, timeZone: string, days: number): string {
  const [y, m, d] = localDateKey(now, timeZone).split("-").map(Number);
  // Date.UTC normalises overflow, so the shift rolls the month and year correctly.
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)).toISOString().slice(0, 10);
}

export type ProposalExpiry = { dateKey: string; dateLabel: string; days: number; text: string };

/**
 * When a proposal from this consult expires: counted from the day AFTER the consult, on the consult's LOCAL calendar day
 * (an 11pm ET call on Oct 20 is Oct 21 in UTC but still an Oct 20 consult, so it expires Oct 21 + 7 = Oct 28).
 * `text` is the fragment "October 28, 2026, 7" that the PDF's note completes as "... 7 days from the date of receipt."
 */
export function proposalExpiry(consultStart: Date, timeZone: string, days: number): ProposalExpiry {
  let dateKey: string;
  try {
    dateKey = localDateKeyOffset(consultStart, timeZone, 1 + days);
  } catch {
    throw new PackagesSpecError("invalid_time_zone", "timeZone");
  }
  const [y, m, d] = dateKey.split("-").map(Number);
  const dateLabel = `${MONTHS[m - 1]} ${d}, ${y}`;
  return { dateKey, dateLabel, days, text: `${dateLabel}, ${days}` };
}

function monthLabel(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", year: "numeric" }).format(d);
  } catch {
    throw new PackagesSpecError("invalid_time_zone", "timeZone");
  }
}

// ------------------------------------------------------------------ consistency

type Tier = { name: string; price: string; pkg: ProposalPricing };

/** One value when the packages agree, else "low to high". */
function uniformOrRange(values: number[]): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? formatUsd(lo) : `${formatUsd(lo)} to ${formatUsd(hi)}`;
}

function cellsFor(tiers: Tier[]): Record<keyof typeof CONFIG_ROWS, string[]> {
  return {
    classes: tiers.map((t) => classesCell(t.pkg.included_classes)),
    youPay: tiers.map((t) => t.price),
    additionalClass: tiers.map((t) => `${formatUsd(t.pkg.per_class_cents)} per class`),
  };
}

/**
 * The tiers to draw and the cells the list owns. With art: the template's tiers, each found in the list by name, and the
 * template's own cells for those three rows compared with the list's; the first disagreement throws `template_config_mismatch`.
 * Without art: the list itself, in its order.
 */
export function tiersAndConfigRows(
  packages: ProposalPricing[],
  template: PackageTemplate | null,
): { tiers: Tier[]; configRows: Record<keyof typeof CONFIG_ROWS, string[]> } {
  if (packages.length === 0) throw new PackagesSpecError("no_packages", "packages");
  let tiers: Tier[];
  if (template) {
    const tTiers = template.packages?.tiers ?? [];
    tiers = tTiers.map((t, i) => {
      const pkg = packages.find((p) => sameTierName(p.package, t.name));
      if (!pkg) return mismatch(`tiers[${i}].name`);
      return { name: tierDisplayName(pkg.package), price: formatUsd(pkg.base_cents), pkg };
    });
    tTiers.forEach((t, i) => {
      if (t.price !== tiers[i].price) mismatch(`tiers[${i}].price`);
    });
  } else {
    tiers = packages.map((pkg) => ({ name: tierDisplayName(pkg.package), price: formatUsd(pkg.base_cents), pkg }));
  }
  if (tiers.length === 0) throw new PackagesSpecError("no_packages", "packages");
  if (tiers.length > MAX_TIERS) throw new PackagesSpecError("too_many_packages", "packages");

  const configRows = cellsFor(tiers);
  if (template) {
    const rows = template.packages.rows ?? [];
    for (const key of Object.keys(CONFIG_ROWS) as (keyof typeof CONFIG_ROWS)[]) {
      const label = CONFIG_ROWS[key];
      const row = rows.find((r) => r.label === label);
      if (!row) mismatch(`rows["${label}"]`);
      if (row.cells.length !== tiers.length) mismatch(`rows["${label}"].cells.length`);
      row.cells.forEach((c, i) => {
        if (c.trim() !== configRows[key][i]) mismatch(`rows["${label}"].cells[${i}]`);
      });
    }
    for (const [i, row] of rows.entries()) {
      if (row.cells.length !== tiers.length) mismatch(`rows[${i}].cells.length`);
    }
  }
  return { tiers, configRows };
}

/** The plain version's table: only what the package list holds. */
function plainRows(configRows: Record<keyof typeof CONFIG_ROWS, string[]>): SpecRow[] {
  const row = (label: string, cells: string[], cls: SpecRow["cls"]): SpecRow => ({
    label,
    value: null,
    note: null,
    cells: cells.map(cellFor),
    cls,
  });
  return [
    row(CONFIG_ROWS.classes, configRows.classes, "disc"),
    row(CONFIG_ROWS.youPay, configRows.youPay, "pay"),
    row(CONFIG_ROWS.additionalClass, configRows.additionalClass, "addl"),
  ];
}

// ------------------------------------------------------------------ builder

export function buildPackagesSpec(input: PackagesSpecInput, firm: PackagesFirm): PackagesSpec {
  const firmName = clean(firm?.name);
  if (!firmName) throw new PackagesSpecError("missing_firm", "firm.name");
  const art = firm.art === undefined ? packagesArtForSlug(firm.slug) : firm.art;
  const days = firm.expiryDays ?? DEFAULT_PROPOSAL_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new PackagesSpecError("invalid_expiry", "firm.expiryDays");

  const plainClient = required(input?.client, "missing_client", "client");
  const prefix = clean(input.clientPrefix);
  if (prefix && BRACKETED.test(prefix)) throw new PackagesSpecError("placeholder_text", "clientPrefix");
  const client = withPrefix(prefix || null, plainClient);
  const company = optionalCompany(input.company);

  const start = input.consultStart instanceof Date ? input.consultStart : new Date(input.consultStart ?? "");
  if (Number.isNaN(start.getTime())) throw new PackagesSpecError("missing_consult_date", "consultStart");

  const rawMarks = Array.isArray(input.marks) ? input.marks : [];
  if (rawMarks.length === 0) throw new PackagesSpecError("no_marks", "marks");
  if (rawMarks.length > MAX_MARKS) throw new PackagesSpecError("too_many_marks", "marks");
  const marks: SpecMark[] = rawMarks.map((m, i) => {
    const name = required(m?.name, "missing_mark_name", `marks[${i}].name`);
    const cats = Array.isArray(m.categories) ? m.categories : [];
    if (cats.length === 0) throw new PackagesSpecError("mark_without_categories", `marks[${i}].categories`);
    return {
      name,
      display: name.toUpperCase(),
      categories: cats.map((c, j) => {
        const text = required(c?.text, "empty_category", `marks[${i}].categories[${j}].text`);
        // The PDF is client-facing: never a class number (process-consult HARD RULE 10).
        if (/\b(?:class(?:es)?|IC)\s*0*\d{1,2}\b/i.test(text)) {
          throw new PackagesSpecError("class_number_in_category", `marks[${i}].categories[${j}].text`);
        }
        return { text, priority: c.priority === true };
      }),
    };
  });

  const { tiers, configRows } = tiersAndConfigRows(firm.packages ?? [], art?.template ?? null);
  const rows: SpecRow[] = art
    ? art.template.packages.rows.map((r) => {
        const configKey = (Object.keys(CONFIG_ROWS) as (keyof typeof CONFIG_ROWS)[]).find((k) => CONFIG_ROWS[k] === r.label);
        // List-owned rows are rebuilt from the list; the template copy was only compared.
        const cells = configKey ? configRows[configKey] : r.cells;
        return { label: r.label, value: r.value?.trim() || null, note: r.note?.trim() || null, cells: cells.map(cellFor), cls: rowCls(r.cls) };
      })
    : plainRows(configRows);

  const expiry = proposalExpiry(start, firm.timeZone, days);
  const date = monthLabel(start, firm.timeZone);
  const titleFirm = art?.titleFirm ?? firmName;

  return {
    client,
    company,
    date,
    expiry: expiry.text,
    expirySentence: `This Trademark Proposal shall expire on ${expiry.text} days from the date of receipt.`,
    title: `${client} – ${titleFirm} Trademark Proposal`,
    filename: packagesFilename(plainClient, marks),
    chrome: art
      ? { wordmark: art.wordmark, established: art.established, footerBold: art.footerBold, footerRest: art.footerRest, author: art.author }
      : { wordmark: firmName.toUpperCase(), established: null, footerBold: firmName, footerRest: "", author: firmName },
    tiers: tiers.map((t) => ({ name: t.name, price: t.price })),
    rows,
    fees: {
      additionalClass: uniformOrRange(tiers.map((t) => t.pkg.per_class_cents)),
      governmentPerClass: `${uniformOrRange(tiers.map((t) => t.pkg.gov_per_class_cents))} per class`,
    },
    marks,
    consultStart: start,
  };
}
