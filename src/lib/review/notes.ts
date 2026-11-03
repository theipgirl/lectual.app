/**
 * The sentences for a source that could not be read. Fixed text; the failing source is named, the
 * error never is. Pure.
 */

/** Sources the review cannot be drawn without: with any of them down there are no sections at all. */
export const CRITICAL_SOURCES = ["matters", "leads", "tasks"] as const;
export type CriticalSource = (typeof CRITICAL_SOURCES)[number];

/** Sources that only enrich a row: the rows still draw, and the gap is named. */
export const OPTIONAL_SOURCES = ["last contact", "deadlines", "approvals", "stage history", "team names"] as const;
export type OptionalSource = (typeof OPTIONAL_SOURCES)[number];

function list(names: readonly string[]): string {
  return names.join(", ");
}

/** One alert, shown INSTEAD of the sections, when a critical source failed. */
export function criticalAlert(failed: readonly CriticalSource[]): string {
  return `The weekly review can't be shown right now (${list(failed)} couldn't load). Refresh to try again.`;
}

/** One note above the sections when only optional sources failed. */
export function detailsNote(failed: readonly OptionalSource[]): string | null {
  if (failed.length === 0) return null;
  return `Some details couldn't load (${list(failed)}). Refresh to try again.`;
}
