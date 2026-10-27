/**
 * The lead the transcript form should open on, from `?lead=<id>` (a link from a lead, or a bookmark). Pure.
 *
 * Only an id that is really in the list the form offers is used: an id for a lead the person can't see, a
 * malformed one, a repeated parameter or nothing at all leaves the select on its prompt. The id is matched
 * exactly (never searched), and it only ever chooses which option is selected: the draft action re-reads the lead
 * itself, so a forged value cannot reach another firm's lead.
 */
export function preselectedLeadId(requested: string | string[] | undefined, leads: ReadonlyArray<{ id: string }>): string {
  const value = (Array.isArray(requested) ? requested[0] : requested)?.trim() ?? "";
  if (!value) return "";
  return leads.some((lead) => lead.id === value) ? value : "";
}
