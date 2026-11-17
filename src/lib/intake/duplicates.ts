/**
 * "Possible duplicate": another OPEN lead in the firm with the same email (case-insensitive) or the same first + last name
 * (case-insensitive, whitespace collapsed). PURE, from the leads the page already loaded: no new query, and nothing is
 * merged or changed. A lead is only ever compared with OTHER leads in an open-category stage; a name needs both parts.
 */
export type DupLead = { id: string; first_name: string; last_name: string; email: string; current_stage_id: string };
export type DupStage = { id: string; name: string; category?: string | null };
export type DuplicateOf = { leadId: string; name: string; stageName: string };

const norm = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const nameOf = (l: Pick<DupLead, "first_name" | "last_name">) => `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();

/**
 * For each lead in `shown`, the first OTHER open lead in `pool` that matches (same email wins over same name; ties go to
 * the pool's order). `pool` is every open lead the page loaded; `shown` may be a different list (the Lost set).
 */
export function findDuplicates(shown: readonly DupLead[], pool: readonly DupLead[], stages: readonly DupStage[]): Record<string, DuplicateOf> {
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const open = pool.filter((l) => stageById.get(l.current_stage_id)?.category === "open");
  const byEmail = new Map<string, DupLead[]>();
  const byName = new Map<string, DupLead[]>();
  for (const l of open) {
    const email = norm(l.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), l]);
    const first = norm(l.first_name);
    const last = norm(l.last_name);
    if (first && last) byName.set(`${first}|${last}`, [...(byName.get(`${first}|${last}`) ?? []), l]);
  }
  const out: Record<string, DuplicateOf> = {};
  for (const l of shown) {
    const email = norm(l.email);
    const first = norm(l.first_name);
    const last = norm(l.last_name);
    const other =
      (email ? byEmail.get(email)?.find((o) => o.id !== l.id) : undefined) ?? (first && last ? byName.get(`${first}|${last}`)?.find((o) => o.id !== l.id) : undefined);
    if (other) out[l.id] = { leadId: other.id, name: nameOf(other) || other.email, stageName: stageById.get(other.current_stage_id)?.name ?? "an unknown stage" };
  }
  return out;
}

/** The marker's tooltip: who the other lead is and where it sits. */
export function duplicateTitle(d: DuplicateOf): string {
  return `Possible duplicate of ${d.name}, in ${d.stageName}. Open it to compare; nothing is merged.`;
}
