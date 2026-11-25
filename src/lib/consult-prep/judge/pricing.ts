// The "Package" block of the brief, and the one place model prose is scrubbed.
//
// PORTED from lawmatics-mcp src/consult-brief/pricing.ts (see PORTED_FROM.md). Changes: every amount comes from the FIRM'S OWN package list
// (`normalisePackages`, cents), never a fixed table; the model's `choice` is a package NAME from that list, found by name (case-insensitive),
// so a firm with any packages works; the consult credit and its expiry are per-firm inputs (no credit line without a credit); money is
// formatted from cents with the app's one staff formatter.
//
// Amounts are shown only when the package is SETTLED:
//   - the trademark path, with a grounded, confirmed mark;
//   - a choice that is a package on the list;
//   - at least one class to file now;
//   - nothing pending.
// Otherwise the block is "Held — <what is open>" with no amount at all (no package price, no government fee, no consult-credit figure):
// never quote a price while the mark or the class count is open.

import { formatDollars } from "@/lib/proposal-editor/events";
import type { ProposalPricing } from "@/lib/proposals/types";
import { makeScrubber, type ScrubCounts } from "./scrub";
import { packageNamesOf } from "./judge";
import { PACKAGE_HELD, PACKAGE_NONE, type Judgment, type PackageJudgment, type Route } from "./schemas";

export type PackageBlock =
  | { kind: "settled"; package: ProposalPricing; lines: string[]; reasoning: string }
  | { kind: "held"; line: string; reasoning: string }
  | { kind: "none"; line: string; reasoning: string };

export const HELD_SUFFIX = "No price quoted until the mark and class count are settled.";
export const COMPLIMENTARY_LINE = "Complimentary consult — no consult-fee credit.";
export const NONE_LINE = "⚠️ Trademark packages don't fit this matter — no package or price is quoted.";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sentence(s: string): string {
  return s.trim().replace(/[.\s]+$/, "");
}

/** The firm's package the model named, by name, ignoring case; null when the name is not on the list (HELD and NONE never are). */
export function findListed(packages: readonly ProposalPricing[], choice: string): ProposalPricing | null {
  const key = choice.trim().toLowerCase();
  if (!key) return null;
  return packages.find((p) => p.package.trim().toLowerCase() === key) ?? null;
}

export type PackageLinesOptions = {
  markConfirmed: boolean;
  /** The firm's packages, from `normalisePackages`. Every price printed comes from here. */
  packages: readonly ProposalPricing[];
  /** Applied to every model-written string (pending, reasoning) before it is returned. */
  scrub: (s: string) => string;
  /** A complimentary consult had no fee, so there is nothing to credit (skill STEP 6). */
  complimentary?: boolean;
  /** The firm's strategy-session fee in cents, credited toward the legal fee. Null or 0: no credit line at all. */
  consultCreditCents?: number | null;
  /** "October 29, 2026": the day the credit offer ends. Null leaves the date clause out. */
  expiryLabel?: string | null;
};

/** The package block for a trademark-path brief. Pure. */
export function packageLines(pkg: PackageJudgment, opts: PackageLinesOptions): PackageBlock {
  const { scrub } = opts;
  const reasoning = scrub(pkg.reasoning);

  if (pkg.choice === PACKAGE_NONE) return { kind: "none", line: NONE_LINE, reasoning };

  const listed = pkg.choice === PACKAGE_HELD ? null : findListed(opts.packages, pkg.choice);
  const classes = pkg.classesToFileNow;
  const settled = listed !== null && opts.markConfirmed && classes.length >= 1 && pkg.pending === null;

  if (!settled || !listed) {
    let pending: string;
    if (pkg.pending) pending = sentence(scrub(pkg.pending));
    else if (!opts.markConfirmed) pending = "the mark is not confirmed yet";
    else pending = "the class count is still open";
    const leaning = listed ? ` (leaning ${listed.package})` : "";
    return { kind: "held", line: `Held${leaning} — ${pending}. ${HELD_SUFFIX}`, reasoning };
  }

  const n = classes.length;
  const extra = Math.max(0, n - listed.included_classes);
  const classList = classes.map((c) => `Class ${c}`).join(", ");
  const priority = pkg.priorityClass !== null ? ` (priority: Class ${pkg.priorityClass})` : "";
  const gov = formatDollars(listed.gov_per_class_cents);

  const lines = [
    `${listed.package} — ${formatDollars(listed.base_cents)} legal fee, ${plural(listed.included_classes, "class", "classes")} included.`,
    `Classes to file now: ${classList}${priority}.`,
  ];
  if (extra > 0) {
    lines.push(
      `${plural(extra, "additional class", "additional classes")} × ${formatDollars(listed.per_class_cents)} = ${formatDollars(extra * listed.per_class_cents)}`,
    );
  }
  lines.push(`Government filing fees: ${n} × ${gov} = ${formatDollars(n * listed.gov_per_class_cents)} (separate, never discounted; ${gov} per class).`);
  if (opts.complimentary) {
    lines.push(COMPLIMENTARY_LINE);
  } else if (opts.consultCreditCents && opts.consultCreditCents > 0) {
    const by = opts.expiryLabel ? ` if the client engages by ${opts.expiryLabel}` : "";
    lines.push(
      `Consult credit: the ${formatDollars(opts.consultCreditCents)} strategy-session fee is credited toward the legal fee${by}, once per proposal, and only if the fee cleared.`,
    );
  }
  return { kind: "settled", package: listed, lines, reasoning };
}

// ---------------------------------------------------------------- finalising a judgment

export type FinalizeOptions = {
  route: Route;
  /** The plan's mark is confirmed AND grounded (`plan.markStatus === "confirmed"`). */
  markConfirmed: boolean;
  packages: readonly ProposalPricing[];
  complimentary?: boolean;
  consultCreditCents?: number | null;
  expiryLabel?: string | null;
};

export type FinalJudgment = {
  /** The judgment with every model-written string scrubbed. The trademark block is null off the trademark path. */
  judgment: Judgment;
  /** The printed package block: null off the trademark path. */
  package: PackageBlock | null;
  /** What the scrubbers removed (counts only, for the run's diagnostics). */
  scrubbed: ScrubCounts;
};

/**
 * The judgment as the brief may print it. Scrubs EVERY string the model wrote, once: currency and price sentences always, and the
 * firm's package names on the general and dispute paths (no package applies there). Prices printed come only from the firm's list.
 * The verbatim client text and the USPTO section are not here and are never scrubbed.
 */
export function finalizeJudgment(j: Judgment, opts: FinalizeOptions): FinalJudgment {
  const nonFiling = opts.route !== "TRADEMARK";
  const { scrub, counts } = makeScrubber(nonFiling, packageNamesOf(opts.packages));
  const many = (xs: readonly string[]) => xs.map(scrub);

  const trademark = !nonFiling && j.trademark
    ? {
        ...j.trademark,
        noClassesReason: j.trademark.noClassesReason === null ? null : scrub(j.trademark.noClassesReason),
        riskRead: scrub(j.trademark.riskRead),
        likelyClasses: j.trademark.likelyClasses.map((c) => ({ ...c, rationale: scrub(c.rationale) })),
        package: {
          ...j.trademark.package,
          reasoning: scrub(j.trademark.package.reasoning),
          pending: j.trademark.package.pending === null ? null : scrub(j.trademark.package.pending),
          pdfMarks: j.trademark.package.pdfMarks.map((m) => ({ ...m, categories: m.categories.map((c) => ({ ...c, text: scrub(c.text) })) })),
        },
      }
    : null;

  const judgment: Judgment = {
    clientSnapshot: scrub(j.clientSnapshot),
    markSubmitted: scrub(j.markSubmitted),
    natureOfMatter: scrub(j.natureOfMatter),
    flagsToProbe: many(j.flagsToProbe),
    questions: many(j.questions),
    trademark,
    general: j.general
      ? { scopeAndEngagement: scrub(j.general.scopeAndEngagement), documentsNeeded: many(j.general.documentsNeeded), jurisdictionNote: j.general.jurisdictionNote === null ? null : scrub(j.general.jurisdictionNote) }
      : null,
    dispute: j.dispute ? { disputeSnapshot: scrub(j.dispute.disputeSnapshot) } : null,
  };

  // The package prose is already scrubbed above; the block's own lines are built from the firm's list and must not be scrubbed again.
  const block = trademark
    ? packageLines(trademark.package, {
        markConfirmed: opts.markConfirmed,
        packages: opts.packages,
        scrub: (s) => s,
        complimentary: opts.complimentary,
        consultCreditCents: opts.consultCreditCents,
        expiryLabel: opts.expiryLabel,
      })
    : null;

  return { judgment, package: block, scrubbed: { ...counts } };
}
