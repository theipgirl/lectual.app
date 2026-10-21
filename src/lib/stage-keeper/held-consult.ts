import type { SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";

/**
 * A consult that took place is real contact: it moves the lead's last touch forward to the end
 * of the call, so the Intake list's "last thing that happened" sort sees it.
 *
 * Runs right after the calendar sync for every firm with the mailbox module, whether or not the
 * Stage Keeper is switched on: it records a fact, not an agent's decision. Service role, so every
 * statement carries the firm's `org_id`. Forward only: a lead already touched later is left
 * alone, and an update that would move the date backwards matches no row. Never throws.
 *
 * Before lectual 0098 the event columns it reads do not exist: that is reported as
 * `database-update-needed`, not as "no consults held".
 */

export type HeldConsultResult = { orgId: string; state: "ok" | "database-update-needed" | "error"; bumped: number };

const DAY_MS = 86_400_000;
/** The calendar sync keeps seven days of the past, so that is as far back as this looks. */
const LOOKBACK_DAYS = 7;
const CHUNK = 100;

type EventRow = { id: string; lead_id: string | null; starts_at: string; ends_at: string | null };

export async function bumpHeldConsults(admin: SupabaseClient, orgId: string, nowMs: number = Date.now()): Promise<HeldConsultResult> {
  try {
    const nowIso = new Date(nowMs).toISOString();
    const { data, error } = await admin
      .from("crm_calendar_event")
      .select("id, lead_id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("source", "outlook")
      .eq("is_consult", true)
      .not("lead_id", "is", null)
      .gte("starts_at", new Date(nowMs - (LOOKBACK_DAYS + 1) * DAY_MS).toISOString())
      .lt("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(500);
    if (error) return { orgId, state: isDatabaseUpdateNeeded(error) ? "database-update-needed" : "error", bumped: 0 };

    // The newest end per lead, for events that have actually ended.
    const endByLead = new Map<string, number>();
    for (const row of (data ?? []) as EventRow[]) {
      if (!row.lead_id) continue;
      const end = Date.parse(row.ends_at ?? row.starts_at);
      if (!Number.isFinite(end) || end > nowMs) continue;
      if (end > (endByLead.get(row.lead_id) ?? Number.NEGATIVE_INFINITY)) endByLead.set(row.lead_id, end);
    }
    if (endByLead.size === 0) return { orgId, state: "ok", bumped: 0 };

    const ids = [...endByLead.keys()];
    const touched = new Map<string, number | null>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data: leads, error: leadErr } = await admin
        .from("crm_lead")
        .select("id, last_activity_at")
        .eq("org_id", orgId)
        .in("id", ids.slice(i, i + CHUNK));
      if (leadErr) return { orgId, state: "error", bumped: 0 };
      for (const l of (leads ?? []) as Array<{ id: string; last_activity_at: string | null }>) {
        const at = l.last_activity_at ? Date.parse(l.last_activity_at) : NaN;
        touched.set(l.id, Number.isFinite(at) ? at : null);
      }
    }

    let bumped = 0;
    for (const [leadId, end] of endByLead) {
      if (!touched.has(leadId)) continue; // not this firm's lead, or unreadable: leave it
      const last = touched.get(leadId) ?? null;
      if (last !== null && last >= end) continue; // already touched later: never backwards
      const endIso = new Date(end).toISOString();
      const base = admin.from("crm_lead").update({ last_activity_at: endIso }).eq("id", leadId).eq("org_id", orgId);
      // Conditional on what was read, so a note written a moment ago is never overwritten with an older date.
      const { error: upErr } = await (last === null ? base.is("last_activity_at", null) : base.lt("last_activity_at", endIso));
      if (upErr) return { orgId, state: "error", bumped };
      bumped += 1;
    }
    return { orgId, state: "ok", bumped };
  } catch {
    return { orgId, state: "error", bumped: 0 };
  }
}
