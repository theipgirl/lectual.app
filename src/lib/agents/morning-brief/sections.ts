import type { SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";
import { joinHref } from "@/lib/calendar/outlook-format";
import { deadlineKindLabel, type DeadlineKind } from "@/lib/matters/deadline-rules";
import { SIGNAL_LABEL } from "@/lib/stage-keeper/signals";
import {
  REVIEW_SOURCE,
  SUGGESTION_SOURCE,
  WHY_TEXT,
  pendingStageSuggestions,
  type ActivityRow,
} from "@/lib/stage-keeper/moves";
import type { QueueItem } from "@/lib/queue/api";
import { IN_CHUNK, addCivilDays, chunk, civilDay, leadLabel, text } from "../shared";
import type { BriefLead, BriefStage } from "./rules";

/**
 * The six sections of the morning brief, each read on its own so one failing never hides the
 * others. Every statement carries the firm's `org_id`. A reader returns a `Section`:
 *   ok                      we reached it (an empty list means "nothing today")
 *   blocked                 a firm-level switch is off (the Mailboxes module), a state of its own
 *   database-update-needed  the Outlook columns are not there yet (lectual 0098)
 *   unavailable             we could not reach it, so it is not known either way
 * A failed read is never an empty one.
 */

export type Section<T> =
  | { state: "ok"; items: T[] }
  | { state: "blocked"; reason: string }
  | { state: "database-update-needed" }
  | { state: "unavailable"; reason: string };

export const SECTION_PAGE = 1000;
const SECTION_PAGES = 10;
const SUGGESTION_ROW_CAP = 2000;
export const DEADLINE_DAYS = 14;

const LEAD_COLUMNS =
  "id, first_name, last_name, business_name, email, practice_area, mark_text, current_stage_id, stage_entered_at, last_activity_at, last_inbound_at, last_outbound_at, created_at";

// ── stages and leads ─────────────────────────────────────────────────────────

/** Throws on a failed read: the sections that need stages turn that into `unavailable`. */
export async function readStages(admin: SupabaseClient, orgId: string): Promise<Map<string, BriefStage>> {
  const { data, error } = await admin.from("crm_stage").select("id, name, category, aging_threshold_days").eq("org_id", orgId);
  if (error) throw new Error("stage read failed");
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string; category: string; aging_threshold_days: number | null }>).map((s) => [
      s.id,
      { id: s.id, name: s.name, category: String(s.category), aging_threshold_days: s.aging_threshold_days ?? null },
    ]),
  );
}

/** Every lead in an open stage, paged. Throws on a failed read, and when the firm has more than the pages allow. */
export async function readOpenLeads(admin: SupabaseClient, orgId: string, stages: ReadonlyMap<string, BriefStage>): Promise<BriefLead[]> {
  const openIds = [...stages.values()].filter((s) => s.category === "open").map((s) => s.id);
  if (openIds.length === 0) return [];
  const out: BriefLead[] = [];
  for (let page = 0; page < SECTION_PAGES; page += 1) {
    const { data, error } = await admin
      .from("crm_lead")
      .select(LEAD_COLUMNS)
      .eq("org_id", orgId)
      .in("current_stage_id", openIds)
      .order("id", { ascending: true })
      .range(page * SECTION_PAGE, page * SECTION_PAGE + SECTION_PAGE - 1);
    if (error) throw new Error("lead read failed");
    const rows = (data ?? []) as BriefLead[];
    out.push(...rows);
    if (rows.length < SECTION_PAGE) return out;
  }
  throw new Error("lead read cut short");
}

/** Display names for the given lead ids. Throws on a failed read. */
export async function readLeadNames(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const batch of chunk([...new Set(ids)], IN_CHUNK)) {
    const { data, error } = await admin.from("crm_lead").select("id, first_name, last_name, business_name").eq("org_id", orgId).in("id", batch);
    if (error) throw new Error("lead name read failed");
    for (const row of (data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; business_name: string | null }>) {
      names.set(row.id, leadLabel(row));
    }
  }
  return names;
}

// ── 1. today's consults ──────────────────────────────────────────────────────

export type ConsultItem = { eventId: string; leadId: string | null; startsAt: string; joinUrl: string | null };

/**
 * Outlook consults that start on the firm's calendar day (not the UTC day). The database window is
 * deliberately wider than any zone's day; the exact day is decided here, in the firm's zone.
 */
export async function readTodaysConsults(admin: SupabaseClient, orgId: string, nowMs: number, tz: string): Promise<Section<ConsultItem>> {
  try {
    const today = civilDay(nowMs, tz);
    const lo = new Date(`${addCivilDays(today, -1)}T00:00:00Z`).toISOString();
    const hi = new Date(`${addCivilDays(today, 2)}T00:00:00Z`).toISOString();
    const { data, error } = await admin
      .from("crm_calendar_event")
      .select("id, lead_id, starts_at, join_url, all_day")
      .eq("org_id", orgId)
      .eq("source", "outlook")
      .eq("is_consult", true)
      .gte("starts_at", lo)
      .lt("starts_at", hi)
      .order("starts_at", { ascending: true });
    if (error) return isDatabaseUpdateNeeded(error) ? { state: "database-update-needed" } : { state: "unavailable", reason: "the calendar did not answer" };
    const items = ((data ?? []) as Array<{ id: string; lead_id: string | null; starts_at: string; join_url: string | null; all_day: boolean | null }>)
      .filter((e) => !e.all_day && civilDay(new Date(e.starts_at), tz) === today)
      .map((e) => ({ eventId: e.id, leadId: e.lead_id ?? null, startsAt: e.starts_at, joinUrl: joinHref(e.join_url) }));
    return { state: "ok", items };
  } catch {
    return { state: "unavailable", reason: "the calendar did not answer" };
  }
}

// ── 3. pending stage suggestions ─────────────────────────────────────────────

export type SuggestionItem = { leadId: string | null; from: string | null; to: string | null; reason: string };

/** The Stage Keeper's cards still waiting for a person, through the same logic the lead page uses. */
export async function readPendingSuggestions(admin: SupabaseClient, orgId: string): Promise<Section<SuggestionItem>> {
  try {
    const { data, error } = await admin
      .from("crm_activity")
      .select("id, lead_id, type, actor_type, created_at, payload")
      .eq("org_id", orgId)
      .eq("type", "ai_insight")
      .in("payload->>source", [SUGGESTION_SOURCE, REVIEW_SOURCE])
      .order("created_at", { ascending: false })
      .limit(SUGGESTION_ROW_CAP);
    if (error) return { state: "unavailable", reason: "the timeline did not answer" };
    const rows = (data ?? []) as ActivityRow[];
    // A cut-short read could hide a decision and so list a settled card as pending.
    if (rows.length >= SUGGESTION_ROW_CAP) return { state: "unavailable", reason: "there are too many suggestion records to read at once" };
    const items = pendingStageSuggestions(rows).map((s) => ({
      leadId: s.leadId,
      from: s.fromStage,
      to: s.toStage,
      reason: s.why ? WHY_TEXT[s.why] : s.signal ? SIGNAL_LABEL[s.signal] : "The record shows it has moved on.",
    }));
    return { state: "ok", items };
  } catch {
    return { state: "unavailable", reason: "the timeline did not answer" };
  }
}

// ── 5. deadlines in the next 14 days ─────────────────────────────────────────

export type DeadlineItem = { id: string; matterLabel: string; kind: string; dueDay: string; confirmed: boolean };

function kindLabel(kind: string): string {
  try {
    return deadlineKindLabel(kind as DeadlineKind);
  } catch {
    return "Deadline";
  }
}

/** Open deadlines due from today through DEADLINE_DAYS days out, inclusive, in the firm's civil days. */
export async function readUpcomingDeadlines(admin: SupabaseClient, orgId: string, nowMs: number, tz: string): Promise<Section<DeadlineItem>> {
  try {
    const today = civilDay(nowMs, tz);
    const last = addCivilDays(today, DEADLINE_DAYS);
    const { data, error } = await admin
      .from("crm_matter_deadline")
      .select("id, matter_id, kind, title, due_date, attorney_confirmed, status")
      .eq("org_id", orgId)
      .eq("status", "open")
      .gte("due_date", today)
      .lte("due_date", last)
      .order("due_date", { ascending: true });
    if (error) return { state: "unavailable", reason: "the docket did not answer" };
    const rows = ((data ?? []) as Array<{ id: string; matter_id: string; kind: string; title: string | null; due_date: string; attorney_confirmed: boolean; status: string }>).filter(
      (d) => d.status === "open" && d.due_date >= today && d.due_date <= last,
    );
    const labels = new Map<string, string>();
    try {
      for (const batch of chunk([...new Set(rows.map((r) => r.matter_id))], IN_CHUNK)) {
        const res = await admin.from("crm_matter").select("id, matter_number, title, mark_text").eq("org_id", orgId).in("id", batch);
        if (res.error) throw new Error("matter read failed");
        for (const m of (res.data ?? []) as Array<{ id: string; matter_number: string | null; title: string | null; mark_text: string | null }>) {
          labels.set(m.id, [m.matter_number, m.mark_text || m.title].filter(Boolean).join(" ") || "A matter");
        }
      }
    } catch {
      labels.clear(); // the deadlines still list; each says its matter's name could not be read
    }
    return {
      state: "ok",
      items: rows.map((d) => ({
        id: d.id,
        matterLabel: labels.get(d.matter_id) ?? "A matter (name could not be read)",
        kind: text(d.title) ?? kindLabel(d.kind),
        dueDay: d.due_date,
        confirmed: Boolean(d.attorney_confirmed),
      })),
    };
  } catch {
    return { state: "unavailable", reason: "the docket did not answer" };
  }
}

// ── 6. the queue count ───────────────────────────────────────────────────────

export type QueueRead = { state: "ok"; items: QueueItem[] } | { state: "unavailable"; reason: string };

/** The pending list, once. A reader that is absent or rejects is "unknown", never an empty queue. */
export async function readPending(listPending: (() => Promise<QueueItem[]>) | undefined): Promise<QueueRead> {
  if (!listPending) return { state: "unavailable", reason: "the approval queue could not be listed" };
  try {
    const rows = await listPending();
    if (!Array.isArray(rows)) return { state: "unavailable", reason: "the approval queue returned something unexpected" };
    return { state: "ok", items: rows };
  } catch {
    return { state: "unavailable", reason: "the approval queue could not be reached" };
  }
}
