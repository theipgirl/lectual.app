import type { SheetEntry } from "@/lib/intake/sheet-read";
import type { SourceSignal } from "./types";

/**
 * Which sheet row belongs to which lead.
 *
 * A lead stores `sheet_key` (owner + mark + status code, hashed). Matching tries the key exactly
 * first. Failing that it tries the same owner and mark under any other intake status code, because a
 * row that moved on the sheet has a new key (see `intakeCodeKeys`). One lead per sheet row and one
 * sheet row per lead: any other count is reported as ambiguous and never silently picked. That includes
 * two leads with different keys reaching the same row (the importer starts a new lead when a row's status
 * code changes, so a stale lead and a current one can both name it): neither gets the row.
 */

export type LeadKeyRef = { id: string; sheetKey: string | null };

export type SheetLeadMatch =
  | { kind: "entry"; entry: SheetEntry }
  | { kind: "ambiguous"; note: string };

export type SheetMatchResult = {
  byLead: Map<string, SheetLeadMatch>;
  /** Sheet rows that name an intake lead the app does not have. Listed, never created. */
  withoutLead: SheetEntry[];
  /** Leads that could not be matched to one sheet row (or share a key with another lead). */
  ambiguousLeads: number;
};

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function matchSheetToLeads(entries: readonly SheetEntry[], leads: readonly LeadKeyRef[]): SheetMatchResult {
  const exact = new Map<string, SheetEntry[]>();
  const anyCode = new Map<string, SheetEntry[]>();
  for (const entry of entries) {
    if (entry.exactKey) pushTo(exact, entry.exactKey, entry);
    for (const key of entry.anyCodeKeys) pushTo(anyCode, key, entry);
  }

  const leadsPerKey = new Map<string, number>();
  for (const lead of leads) {
    if (lead.sheetKey) leadsPerKey.set(lead.sheetKey, (leadsPerKey.get(lead.sheetKey) ?? 0) + 1);
  }

  const byLead = new Map<string, SheetLeadMatch>();
  const used = new Set<SheetEntry>();
  let ambiguousLeads = 0;

  for (const lead of leads) {
    if (!lead.sheetKey) continue;
    const sharing = leadsPerKey.get(lead.sheetKey) ?? 0;
    const candidates = exact.get(lead.sheetKey) ?? anyCode.get(lead.sheetKey) ?? [];
    for (const c of candidates) used.add(c);

    if (sharing > 1) {
      byLead.set(lead.id, { kind: "ambiguous", note: `${sharing} leads share this sheet key` });
      ambiguousLeads += 1;
    } else if (candidates.length > 1) {
      byLead.set(lead.id, { kind: "ambiguous", note: `${candidates.length} sheet rows match this lead` });
      ambiguousLeads += 1;
    } else if (candidates.length === 1) {
      byLead.set(lead.id, { kind: "entry", entry: candidates[0] });
    }
  }

  // A row claimed by more than one lead (say the lead holding its current key and a stale duplicate that
  // reaches it through another status code) belongs to none of them.
  const claims = new Map<SheetEntry, string[]>();
  for (const [leadId, match] of byLead) {
    if (match.kind === "entry") pushTo(claims, match.entry, leadId);
  }
  for (const leadIds of claims.values()) {
    if (leadIds.length < 2) continue;
    for (const leadId of leadIds) {
      byLead.set(leadId, { kind: "ambiguous", note: `${leadIds.length} leads match this sheet row` });
      ambiguousLeads += 1;
    }
  }

  // Only rows that would be intake leads count as "no lead in the app": client rows are not leads.
  const withoutLead = entries.filter((e) => e.reading.kind === "ok" && !used.has(e));
  return { byLead, withoutLead, ambiguousLeads };
}

export function sheetSignalFor(match: SheetLeadMatch | undefined): SourceSignal {
  if (!match) return { kind: "none" };
  if (match.kind === "ambiguous") return { kind: "none", note: match.note };
  const { reading } = match.entry;
  switch (reading.kind) {
    case "ok":
      return { kind: "stage", stageId: reading.stageId, stageName: reading.stageName, wording: reading.wording, date: reading.date };
    case "client":
      return { kind: "needs_matter", wording: reading.wording };
    case "unmapped":
      return { kind: "unmapped", wording: reading.wording };
  }
}
