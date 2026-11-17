/**
 * Who "the person" behind a lead is, for the stop rules (M5, lectual 0107). PURE: the rows are read by the caller.
 *
 * A person is one LIVE lead (the asked lead, or its keeper when the asked lead was merged), every other live lead in
 * the same firm with exactly the same address (the asked lead's or the keeper's), and every lead merged into any of
 * those. A merged lead's quote, payment and matter facts stay on it, so leaving it out would let a paying client be
 * nudged again; a merged lead is never itself the match for an address (its live keeper is).
 */
export type PersonRow = { id?: unknown; org_id?: unknown; email?: unknown; merged_into_id?: unknown };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

export function personIds(lead: PersonRow, known: ReadonlyMap<string, PersonRow>, variants: (email: string | null) => string[]): string[] {
  const leadId = s(lead.id);
  if (!leadId) return [];
  const keeperId = s(lead.merged_into_id);
  const anchor = keeperId ? (known.get(keeperId) ?? null) : lead;
  const org = s(lead.org_id);
  const emails = new Set([...variants(s(lead.email)), ...(anchor ? variants(s(anchor.email)) : [])]);
  const base = new Set<string>([leadId]);
  if (anchor && s(anchor.id)) base.add(s(anchor.id) as string);
  for (const [id, row] of known) {
    if (s(row.merged_into_id)) continue;
    if (org && s(row.org_id) && s(row.org_id) !== org) continue;
    const email = s(row.email);
    if (email && emails.has(email)) base.add(id);
  }
  const out = new Set(base);
  for (const [id, row] of known) {
    const into = s(row.merged_into_id);
    if (into && base.has(into)) out.add(id);
  }
  return [...out];
}
