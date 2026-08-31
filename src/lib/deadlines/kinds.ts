/**
 * Display labels for the docket's deadline kinds.
 *
 * LABELS ONLY — AND THAT IS THE WHOLE POINT
 * -----------------------------------------
 * The main repo's `src/lib/matters/deadline-rules.ts` carries, alongside these
 * labels, a table of reference intervals used to pre-fill a suggested date.
 * Every one of the litigation kinds there has `interval: null`, deliberately:
 * a notice-of-appeal window, a motion response period, a hearing date — these
 * vary by county, division, judge and the specific order involved, and
 * encoding one would be asserting a legal determination this product does not
 * make. Lectual is software, not a law firm.
 *
 * This module therefore takes the labels and nothing else. There is no
 * interval table here, no `suggestDeadline`, no anchor arithmetic. A date on
 * this docket is read off the court's order, notice, or the controlling rule
 * and entered by a human. If a procedural period is ever encoded anywhere in
 * this app, it must come from a rule the attorney confirms in writing with her
 * own citation — not from a file like this one.
 *
 * Pure module: no DB access, no server imports. Safe in a client component.
 */

import type { Database } from "@/lib/db/types.generated";

export type DeadlineKind = Database["public"]["Enums"]["crm_deadline_kind"];
export type DeadlineSource = Database["public"]["Enums"]["crm_deadline_source"];
export type DeadlineStatus = Database["public"]["Enums"]["crm_deadline_status"];

/**
 * Every kind the enum allows, grouped by practice for the sake of anyone
 * reading this list. IP kinds come from the trademark SOP; the litigation
 * kinds come from a real Florida state-court docket.
 */
export const DEADLINE_KINDS = [
  // Trademark / USPTO
  "office_action_response",
  "statement_of_use",
  "sou_extension_request",
  "opposition_window",
  "section_8_declaration",
  "section_15_declaration",
  "section_9_renewal",
  "priority_filing",
  // Florida state-court litigation
  "hearing",
  "hearing_request",
  "motion_response",
  "notice_of_appeal",
  "set_aside_default",
  "status_check",
  "trial",
  // Catch-all
  "other",
] as const satisfies readonly DeadlineKind[];

/** Full labels — used as a row's title when the row carries none of its own. */
const KIND_LABEL: Record<DeadlineKind, string> = {
  office_action_response: "Office Action response",
  statement_of_use: "Statement of Use",
  sou_extension_request: "Request for extension of time to file the SOU",
  opposition_window: "Publication / opposition window closes",
  section_8_declaration: "Section 8 Declaration of Continued Use",
  section_15_declaration: "Section 15 Declaration of Incontestability",
  section_9_renewal: "Section 8 + 9 Renewal",
  priority_filing: "Foreign priority filing window closes",
  hearing: "Hearing",
  hearing_request: "Request that a hearing be set",
  motion_response: "Response or opposition to a pending motion",
  notice_of_appeal: "Notice of appeal window",
  set_aside_default: "Motion to set aside default",
  status_check: "Docket status check",
  trial: "Trial",
  other: "Other deadline",
};

/**
 * Short labels for the deadline hero and the calendar, where a row has a
 * matter number and a weekday competing for the same line. Truncating in CSS
 * would cut "Notice of appeal window" to "Notice of appeal wi…"; picking the
 * short form by hand keeps every row readable.
 */
const KIND_SHORT_LABEL: Record<DeadlineKind, string> = {
  office_action_response: "Office Action",
  statement_of_use: "Statement of Use",
  sou_extension_request: "SOU extension",
  opposition_window: "Opposition window",
  section_8_declaration: "Section 8",
  section_15_declaration: "Section 15",
  section_9_renewal: "Renewal",
  priority_filing: "Priority filing",
  hearing: "Hearing",
  hearing_request: "Hearing request",
  motion_response: "Motion response",
  notice_of_appeal: "Appeal window",
  set_aside_default: "Set aside default",
  status_check: "Status check",
  trial: "Trial",
  other: "Deadline",
};

export function deadlineKindLabel(kind: DeadlineKind): string {
  return KIND_LABEL[kind];
}

export function deadlineKindShortLabel(kind: DeadlineKind): string {
  return KIND_SHORT_LABEL[kind];
}

/** Kinds that belong to the Florida litigation docket rather than the USPTO. */
export const LITIGATION_DEADLINE_KINDS = [
  "hearing",
  "hearing_request",
  "motion_response",
  "notice_of_appeal",
  "set_aside_default",
  "status_check",
  "trial",
] as const satisfies readonly DeadlineKind[];

export function isLitigationDeadlineKind(kind: DeadlineKind): boolean {
  return (LITIGATION_DEADLINE_KINDS as readonly DeadlineKind[]).includes(kind);
}

export function isDeadlineKind(value: unknown): value is DeadlineKind {
  return typeof value === "string" && (DEADLINE_KINDS as readonly string[]).includes(value);
}

/**
 * How a date got onto the docket. `calculated` is listed because the enum
 * carries it and rows written by the other app may use it; nothing in this app
 * ever writes it. A date this app suggests is docketed as `manual` with the
 * attorney's own basis sentence recorded alongside it.
 */
const SOURCE_LABEL: Record<DeadlineSource, string> = {
  calculated: "Calculated",
  official_notice: "From office notice",
  manual: "Entered manually",
};

export function deadlineSourceLabel(source: DeadlineSource): string {
  return SOURCE_LABEL[source];
}

const STATUS_LABEL: Record<DeadlineStatus, string> = {
  open: "Open",
  satisfied: "Satisfied",
  waived: "Waived",
  superseded: "Superseded",
};

export function deadlineStatusLabel(status: DeadlineStatus): string {
  return STATUS_LABEL[status];
}

/** Title for a docket row: its own title if it has one, else the kind label. */
export function deadlineTitle(row: { title?: string | null; kind: DeadlineKind }): string {
  const own = row.title?.trim();
  return own && own.length > 0 ? own : deadlineKindLabel(row.kind);
}
