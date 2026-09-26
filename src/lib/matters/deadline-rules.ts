/**
 * Reference intervals for the dated obligations in RPB Law's 11-phase
 * trademark SOP, plus the seven litigation event kinds added for Tracey
 * Cabanis's Florida state-court practice (0052/0053), plus the date
 * arithmetic that turns an anchor date into a SUGGESTED due date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE DOES NOT DECIDE LEGAL DEADLINES.
 *
 * Lectual is software, not a law firm (AGENTS.md, UPL firewall). Everything
 * here is a *reference interval* — a docketing convenience that pre-fills a
 * date the attorney then checks against the office's own notice and confirms.
 * A suggestion produced here is stored with `source = 'calculated'` and
 * `attorney_confirmed = false`, is labelled as unconfirmed everywhere it is
 * displayed, and is freely overridable. Nothing in the app writes a deadline
 * on its own: every row comes from an explicit human action.
 *
 * Intervals also change (the USPTO cut the standard trademark Office Action
 * response period from six months to three, extendable once, for actions
 * issued on or after 3 December 2022) and vary by filing basis (a §66(a)
 * Madrid case gets a non-extendable six months). That is exactly why the
 * confirmed-by-attorney flag exists and why `calculation_basis` records, in
 * plain words, which interval was used.
 *
 * The litigation kinds carry NO reference interval at all (`interval: null`
 * on every one, including notice_of_appeal): unlike a USPTO clock, there is
 * no single confirmed procedural period behind them yet, only one rule
 * citation and an attorney's own note to "verify all RULE items." Encoding a
 * guessed Florida procedural period here would be exactly the legal
 * determination this file is not allowed to make.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure module: no server imports, no DB access — the deadline form (a client
 * component) and the server writer both use it.
 */

import type { Database } from "@/lib/db/types";
import type { FilingBasis } from "./ip-fields";

export type DeadlineKind = Database["public"]["Enums"]["crm_deadline_kind"];
export type DeadlineSource = Database["public"]["Enums"]["crm_deadline_source"];
export type DeadlineStatus = Database["public"]["Enums"]["crm_deadline_status"];

export const DEADLINE_KINDS = [
  "office_action_response",
  "statement_of_use",
  "sou_extension_request",
  "opposition_window",
  "section_8_declaration",
  "section_15_declaration",
  "section_9_renewal",
  "priority_filing",
  "hearing",
  "hearing_request",
  "motion_response",
  "notice_of_appeal",
  "set_aside_default",
  "status_check",
  "trial",
  "other",
] as const;

export const DEADLINE_SOURCES = ["calculated", "official_notice", "manual"] as const;
export const DEADLINE_STATUSES = ["open", "satisfied", "waived", "superseded"] as const;

/** Shown next to every calculated date the attorney has not yet confirmed. */
export const CALCULATED_DEADLINE_NOTICE =
  "Calculated reminder from a reference interval — not a legal determination. Check it against the office's notice and confirm it before relying on it.";

export type DeadlineRule = {
  kind: DeadlineKind;
  /** Full label used as the entry's default title. */
  label: string;
  /** What starts the clock, in the firm's own words. */
  anchorLabel: string;
  /**
   * The reference interval, or null when there is no general one and the date
   * must be read off the file. `months` uses calendar months with end-of-month
   * clamping; `days` is exact.
   */
  interval: { months: number } | { days: number } | null;
  extendable: boolean;
  /** Number of further periods available, when extendable. */
  maxExtensions: number | null;
  /** Length of one extension period, for the note text. */
  extensionLabel: string | null;
  /** Plain-language sentence stored in `calculation_basis`. */
  basis: string | null;
  /** Anything the docketer should know that the interval alone doesn't say. */
  note: string | null;
  /** True when the filing is optional rather than an obligation. */
  optional?: boolean;
};

/**
 * The base rule table. The trademark kinds are keyed to the SOP phases:
 *   phase 7  → office_action_response
 *   phase 8  → statement_of_use
 *   phase 9  → sou_extension_request (extension in lieu of the SOU)
 *   phase 10 → opposition_window
 *   phase 11 → section_8_declaration / section_15_declaration / section_9_renewal
 *
 * The litigation kinds (hearing, hearing_request, motion_response,
 * notice_of_appeal, set_aside_default, status_check, trial — 0052/0053) have
 * no SOP phase; they come from a real Florida state-court litigation docket
 * and every one carries `interval: null` on purpose (see the comment at that
 * section, below).
 */
const RULES: Record<DeadlineKind, DeadlineRule> = {
  office_action_response: {
    kind: "office_action_response",
    label: "Office Action response",
    anchorLabel: "Office Action issuance date",
    interval: { months: 3 },
    extendable: true,
    maxExtensions: 1,
    extensionLabel: "one 3-month extension, fee required",
    basis: "3 months from the Office Action issuance date",
    note: "Standard trademark response period for Office Actions issued on or after 3 December 2022: 3 months, extendable once by 3 months for a fee (6 months total). Confirm the period stated on the Action itself.",
  },
  statement_of_use: {
    kind: "statement_of_use",
    label: "Statement of Use",
    anchorLabel: "Notice of Allowance date",
    interval: { months: 6 },
    extendable: true,
    maxExtensions: 5,
    extensionLabel: "up to five 6-month extensions",
    basis: "6 months from the Notice of Allowance date",
    note: "§1(b) intent-to-use matters. Extendable in 6-month increments, up to 5 extensions (36 months from the Notice of Allowance). Each extension carries a fee — keep the NOA date as the anchor.",
  },
  sou_extension_request: {
    kind: "sou_extension_request",
    label: "Request for extension of time to file the SOU",
    anchorLabel: "Current Statement of Use deadline",
    // No general interval: the request is due on whatever the current SOU
    // deadline is, which the file — not a formula — establishes.
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "Due on or before the current Statement of Use deadline. Enter the date from the file rather than deriving it.",
  },
  opposition_window: {
    kind: "opposition_window",
    label: "Publication / opposition window closes",
    anchorLabel: "Publication date (Official Gazette)",
    interval: { days: 30 },
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: "30 days from the Official Gazette publication date",
    note: "A watch window, not a filing of ours: third parties may oppose (or request an extension of time to oppose) within it. §1(b) matters route to the Notice of Allowance afterwards; §1(a) matters route to registration.",
  },
  section_8_declaration: {
    kind: "section_8_declaration",
    label: "Section 8 Declaration of Continued Use",
    anchorLabel: "Registration date",
    interval: { months: 72 },
    extendable: true,
    maxExtensions: 1,
    extensionLabel: "6-month grace period, surcharge required",
    basis: "6th anniversary of the registration date",
    note: "Filing window opens at the 5th anniversary and closes at the 6th, with a 6-month grace period on payment of a surcharge. Missing it cancels the registration.",
  },
  section_15_declaration: {
    kind: "section_15_declaration",
    label: "Section 15 Declaration of Incontestability",
    anchorLabel: "Registration date",
    interval: { months: 72 },
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: "6th anniversary of the registration date (commonly filed with the Section 8)",
    note: "Optional but recommended. Available after 5 years of continuous use; typically filed combined with the Section 8 in years 5–6.",
    optional: true,
  },
  section_9_renewal: {
    kind: "section_9_renewal",
    label: "Section 8 + 9 Renewal",
    anchorLabel: "Registration date (or last renewal date)",
    interval: { months: 120 },
    extendable: true,
    maxExtensions: 1,
    extensionLabel: "6-month grace period, surcharge required",
    basis: "10th anniversary of the registration (or of the last renewal)",
    note: "Filing window opens at the 9th anniversary and closes at the 10th, with a 6-month grace period on payment of a surcharge; then every 10 years.",
  },
  priority_filing: {
    kind: "priority_filing",
    label: "Foreign priority filing window closes",
    anchorLabel: "Foreign application filing date",
    interval: { months: 6 },
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: "6 months from the foreign application filing date",
    note: "§44(d) priority claim window.",
  },

  // ── LITIGATION KINDS (0052/0053) ───────────────────────────────────────────
  // Sourced from a real Florida state-court litigation docket. Every one of
  // these carries `interval: null` — NOT an oversight. These are court- and
  // rule-set dates that vary by county, division, judge, and the specific
  // motion or order involved; the source material contains exactly one rule
  // citation, and the attorney's own note on it says "verify all RULE items."
  // Lectual is software, not a law firm (AGENTS.md UPL firewall): encoding a
  // procedural period here — a 30-day notice-of-appeal clock, a rule-based
  // motion response period — would be asserting a legal determination this
  // product does not make. `interval: null` means the app suggests no date;
  // the docketer reads it off the court's order, notice, or the controlling
  // rule and enters it directly. `basis: null` for the same reason: there is
  // no interval to cite as calculation_basis. If a specific procedural period
  // is ever added, it must come only from a rule the attorney confirms in
  // writing with her own citation — not from this file.
  hearing: {
    kind: "hearing",
    label: "Hearing",
    anchorLabel: "Date and time set by the court's notice of hearing or order setting hearing",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "Enter the date and time exactly as set by the court's notice of hearing or order setting hearing — there is no general interval to calculate this from.",
  },
  hearing_request: {
    kind: "hearing_request",
    label: "Request that a hearing be set",
    anchorLabel: "The pending motion or matter the hearing is being requested for",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "Whether and when a hearing request itself has a target date depends on the judge's practice preferences and local procedure. Enter the date from the file, not a calculated one.",
  },
  motion_response: {
    kind: "motion_response",
    label: "Response or opposition to a pending motion",
    anchorLabel: "Date the motion was served or filed",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "How much time there is to respond is set by the applicable rule of procedure and the specific motion. Read the response date off the motion, the court's order, or the controlling rule, and enter it directly.",
  },
  notice_of_appeal: {
    kind: "notice_of_appeal",
    label: "Notice of appeal window",
    anchorLabel: "Date of the order or judgment being appealed",
    // Deliberately null — see the section header above. No appellate-rule
    // clock is encoded here.
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "The window to file a notice of appeal is set by the applicable rule of appellate procedure and runs from the order or judgment being appealed. Verify the controlling rule and citation before docketing this date — enter the date the attorney confirms, not a calculated one.",
  },
  set_aside_default: {
    kind: "set_aside_default",
    label: "Motion to set aside default",
    anchorLabel: "Date the default was entered, or the date set for an emergency hearing on the motion",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "Enter the date from the motion, the notice of hearing, or the court's order. There is no general interval for an emergency motion to set aside a default.",
  },
  status_check: {
    kind: "status_check",
    label: "Docket status check",
    anchorLabel: "Last status check, or the date the case otherwise went quiet",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "A self-imposed periodic re-check on an otherwise quiet case, not a court-set deadline. Pick a re-check interval that fits the case and enter that date directly.",
  },
  trial: {
    kind: "trial",
    label: "Trial",
    anchorLabel: "Date and time set by the court's trial order or notice of trial",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: "Docket the date exactly as set by the court in the trial order or notice of trial — there is no general interval to calculate this from.",
  },

  other: {
    kind: "other",
    label: "Other deadline",
    anchorLabel: "Anchor date",
    interval: null,
    extendable: false,
    maxExtensions: null,
    extensionLabel: null,
    basis: null,
    note: null,
  },
};

/**
 * The rule for a kind, adjusted for the matter's filing basis where the basis
 * genuinely changes the interval.
 *
 * The only such case today: an Office Action in a §66(a) Madrid Protocol
 * matter carries a non-extendable 6-month response period rather than the
 * 3-months-plus-one-extension of a domestic application.
 */
export function deadlineRule(kind: DeadlineKind, filingBasis?: FilingBasis | null): DeadlineRule {
  const base = RULES[kind];
  if (kind === "office_action_response" && filingBasis === "66a") {
    return {
      ...base,
      interval: { months: 6 },
      extendable: false,
      maxExtensions: null,
      extensionLabel: null,
      basis: "6 months from the Office Action issuance date (§66(a) Madrid Protocol matter)",
      note: "Office Actions in §66(a) matters carry a non-extendable 6-month response period. Confirm the period stated on the Action itself.",
    };
  }
  return base;
}

export function isDeadlineKind(value: unknown): value is DeadlineKind {
  return typeof value === "string" && (DEADLINE_KINDS as readonly string[]).includes(value);
}

export function isDeadlineSource(value: unknown): value is DeadlineSource {
  return typeof value === "string" && (DEADLINE_SOURCES as readonly string[]).includes(value);
}

export function isDeadlineStatus(value: unknown): value is DeadlineStatus {
  return typeof value === "string" && (DEADLINE_STATUSES as readonly string[]).includes(value);
}

export function deadlineKindLabel(kind: DeadlineKind): string {
  return RULES[kind].label;
}

const SOURCE_LABEL: Record<DeadlineSource, string> = {
  calculated: "Calculated",
  official_notice: "From office notice",
  manual: "Entered manually",
};

export function deadlineSourceLabel(source: DeadlineSource): string {
  return SOURCE_LABEL[source];
}

// ── Date arithmetic (civil dates, UTC, no time component) ────────────────────

function parseISODate(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Adds calendar months to a civil date, clamping to the last day of the target
 * month when the day-of-month does not exist there (31 Aug + 6 months →
 * 28/29 Feb). This is the ordinary docketing convention; it is applied to a
 * suggestion the attorney confirms, never to an authoritative date.
 */
export function addMonths(iso: string, months: number): string | null {
  const parsed = parseISODate(iso);
  if (!parsed) return null;
  const total = parsed.y * 12 + (parsed.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toISODate(y, m, Math.min(parsed.d, daysInMonth(y, m)));
}

/** Adds exact days to a civil date. */
export function addDays(iso: string, days: number): string | null {
  const parsed = parseISODate(iso);
  if (!parsed) return null;
  const t = Date.UTC(parsed.y, parsed.m - 1, parsed.d) + days * 86_400_000;
  const d = new Date(t);
  return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export type DeadlineSuggestion = {
  dueDate: string;
  basis: string;
  extendable: boolean;
  maxExtensions: number | null;
};

/**
 * Suggests a due date from an anchor date. Returns null when the kind has no
 * reference interval or the anchor is not a real date — in which case the form
 * asks for the date instead of guessing one.
 *
 * The returned `basis` is what gets stored in `calculation_basis`: a record of
 * the interval used, so anyone reading the docket later can see how the
 * suggestion was reached and what the attorney confirmed.
 */
export function suggestDeadline(
  kind: DeadlineKind,
  anchorDate: string,
  filingBasis?: FilingBasis | null,
): DeadlineSuggestion | null {
  const rule = deadlineRule(kind, filingBasis);
  if (!rule.interval || !rule.basis) return null;

  const dueDate =
    "months" in rule.interval
      ? addMonths(anchorDate, rule.interval.months)
      : addDays(anchorDate, rule.interval.days);
  if (!dueDate) return null;

  return {
    dueDate,
    basis: rule.basis,
    extendable: rule.extendable,
    maxExtensions: rule.maxExtensions,
  };
}

/**
 * Whole days from `today` to a civil due date. Negative when past due. Both
 * sides are reduced to UTC midnight so the count never depends on the hour the
 * page happened to render.
 */
export function daysUntil(dueDate: string, today: Date = new Date()): number | null {
  const parsed = parseISODate(dueDate);
  if (!parsed) return null;
  const due = Date.UTC(parsed.y, parsed.m - 1, parsed.d);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - now) / 86_400_000);
}
