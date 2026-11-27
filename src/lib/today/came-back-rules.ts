import type { CameBackCategory } from "@/lib/ui/words";

/**
 * "Came back" on Today: a Lost, Won or Nurture lead who made a new enquiry in Lawmatics (the Lawmatics daily sync
 * writes one `ai_insight` row per lead and Lawmatics id, `payload.source = "lawmatics-daily-sync"`,
 * `payload.kind = "came_back"`, ids and the category only). PURE: rows in, items out.
 *
 * Shown for 14 days, newest first, at most 10. A row is dropped once the lead has a `stage_changed` row after it (a
 * person dealt with it), once the lead is merged, or when the lead can't be found.
 */

export const CAME_BACK_SOURCE = "lawmatics-daily-sync";
export const CAME_BACK_KIND = "came_back";
export const CAME_BACK_DAYS = 14;
export const CAME_BACK_CAP = 10;

export type CameBackRow = { id: string; lead_id: string | null; created_at: string; payload: unknown };
export type CameBackLead = { id: string; first_name: string | null; last_name: string | null; business_name: string | null; email: string | null; merged_into_id?: string | null };
export type StageChangeRow = { lead_id: string | null; created_at: string };

export type CameBackItem = { id: string; leadId: string; name: string; category: CameBackCategory; at: string };
export type CameBackRead = { status: "ok"; items: CameBackItem[] } | { status: "unavailable" };

const CATEGORIES: ReadonlySet<string> = new Set(["won", "lost", "nurture"]);

/** True for the daily sync's "came back" rows, and only them: every other `ai_insight` reader keys on its own source. */
export function isCameBackRow(row: { type?: string; payload: unknown }): boolean {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  return (row.type === undefined || row.type === "ai_insight") && p.source === CAME_BACK_SOURCE && p.kind === CAME_BACK_KIND;
}

export function cameBackCategory(payload: unknown): CameBackCategory | null {
  const c = ((payload ?? {}) as Record<string, unknown>).stage_category;
  return typeof c === "string" && CATEGORIES.has(c) ? (c as CameBackCategory) : null;
}

function leadName(l: CameBackLead): string {
  return `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.business_name?.trim() || l.email?.trim() || "A lead";
}

export function cameBackItems(rows: readonly CameBackRow[], leads: readonly CameBackLead[], changes: readonly StageChangeRow[], nowMs: number): CameBackItem[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const since = nowMs - CAME_BACK_DAYS * 86_400_000;
  const lastChange = new Map<string, number>();
  for (const c of changes) {
    const t = Date.parse(c.created_at);
    if (!c.lead_id || !Number.isFinite(t)) continue;
    if (t > (lastChange.get(c.lead_id) ?? -Infinity)) lastChange.set(c.lead_id, t);
  }
  const out: CameBackItem[] = [];
  const seenLead = new Set<string>();
  for (const r of [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (!isCameBackRow(r) || !r.lead_id) continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at) || at < since) continue;
    const category = cameBackCategory(r.payload);
    const lead = byId.get(r.lead_id);
    if (!category || !lead || lead.merged_into_id) continue;
    if ((lastChange.get(r.lead_id) ?? -Infinity) > at) continue; // a person moved the lead since
    if (seenLead.has(r.lead_id)) continue; // one row per lead, the newest
    seenLead.add(r.lead_id);
    out.push({ id: r.id, leadId: r.lead_id, name: leadName(lead), category, at: r.created_at });
    if (out.length >= CAME_BACK_CAP) break;
  }
  return out;
}
