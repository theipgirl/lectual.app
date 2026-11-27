/**
 * Intake opens on the BOARD when the address has no `view`. The LIST therefore always carries its explicit value.
 * This is the ONE place that value is written for a link that means "the list" (see BOARD-DEFAULT.md in the audit folder).
 * Pure, no imports, so the nav, the server pages and the client workspace can all use it.
 */
export const INTAKE_LIST_VALUE = "table";
export const INTAKE_LIST_PATH = `/dashboard/intake/?view=${INTAKE_LIST_VALUE}`;

/** The Intake LIST's address, with any further query parts (`"set=open"`, `"?agent=today"`) after the view. */
export function intakeListHref(extra?: string): string {
  const more = (extra ?? "").replace(/^[?&]+/, "");
  return more ? `${INTAKE_LIST_PATH}&${more}` : INTAKE_LIST_PATH;
}
