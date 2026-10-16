/**
 * The defined vocabulary for `crm_matter.status`.
 *
 * Before 0035 this column was unconstrained free text and the list page's
 * filter tabs were built from whatever strings happened to exist in the data —
 * so a typo became a permanent tab and no caller could rely on the value.
 * 0035 adds the matching CHECK constraint (`crm_matter_status_vocab`); this
 * module is the app-side half of the same contract and must not drift from it.
 *
 * Scope, deliberately: this is Lectual's MATTER LIFECYCLE only. The USPTO's own
 * prosecution state (published, allowed, registered, abandoned…) is not
 * squeezed in here — it lives in `crm_matter.uspto_status`, transcribed from
 * the office record, alongside the date it was read.
 *
 * Pure module: no server imports, so client components can use it directly.
 */

export const MATTER_STATUSES = ["open", "on_hold", "closed"] as const;

export type MatterStatus = (typeof MATTER_STATUSES)[number];

const STATUS_LABEL: Record<MatterStatus, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export function isMatterStatus(value: unknown): value is MatterStatus {
  return typeof value === "string" && (MATTER_STATUSES as readonly string[]).includes(value);
}

/**
 * Friendly label for a status. Values outside the vocabulary are humanized
 * rather than dropped: 0035's constraint is added NOT VALID precisely so a
 * pre-existing legacy value cannot break a firm's data, and the UI must be able
 * to render one honestly if it turns up.
 */
export function matterStatusLabel(status: string): string {
  return isMatterStatus(status) ? STATUS_LABEL[status] : status.replace(/_/g, " ");
}

/**
 * The status filter/select options for a given set of matters: always the full
 * defined vocabulary, plus any legacy value actually present in the data (so a
 * row holding an out-of-vocabulary status stays reachable instead of becoming
 * invisible the day the vocabulary landed).
 */
export function matterStatusOptions(present: readonly string[] = []): string[] {
  const legacy = Array.from(new Set(present.filter((s) => !isMatterStatus(s)))).sort();
  return [...MATTER_STATUSES, ...legacy];
}
