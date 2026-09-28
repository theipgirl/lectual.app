import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Attendee, MeetingProvider, TranscriptSegment } from "./types";

/**
 * Meetings as the pages read them: through the caller's scoped client, so RLS
 * on org_id is the boundary (another firm's meeting id is just "not found").
 *
 * Every read is TWO-STATE-PLUS-ONE, never two: `ok` with rows (possibly none)
 * or `unavailable`. A failed read must never render as "no meetings", the same
 * rule as the approval queue (AGENTS.md).
 */

const LIST_COLUMNS =
  "id, provider, title, started_at, duration_seconds, attendees, share_url, lead_id, matter_id, suggested_lead_id, suggested_matter_id, link_source, has_summary:summary, transcript_first:transcript->0";

export type MeetingListItem = {
  id: string;
  provider: MeetingProvider;
  title: string;
  started_at: string | null;
  duration_seconds: number | null;
  attendees: Attendee[];
  share_url: string | null;
  lead_id: string | null;
  matter_id: string | null;
  suggested_lead_id: string | null;
  suggested_matter_id: string | null;
  link_source: string | null;
  has_transcript: boolean;
  has_summary: boolean;
};

export type MeetingDetail = MeetingListItem & {
  summary: string | null;
  transcript: TranscriptSegment[];
  linked_by: string | null;
  linked_at: string | null;
  imported_at: string;
};

export type ListRead = { status: "ok"; meetings: MeetingListItem[] } | { status: "unavailable" };
export type DetailRead = { status: "ok"; meeting: MeetingDetail | null } | { status: "unavailable" };

export type MeetingFilters = { provider?: MeetingProvider | null; linked?: "linked" | "unlinked" | null };

export function asAttendees(value: unknown): Attendee[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({ name: typeof a.name === "string" ? a.name : "", email: typeof a.email === "string" ? a.email : null }))
    .filter((a) => a.name || a.email);
}

export function asTranscript(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof s.text === "string")
    .map((s) => ({
      speaker: typeof s.speaker === "string" && s.speaker ? s.speaker : "Speaker",
      text: s.text as string,
      ...(typeof s.at === "string" ? { at: s.at } : {}),
    }));
}

function toItem(r: Record<string, unknown>): MeetingListItem {
  return {
    id: String(r.id),
    provider: r.provider === "zoom" ? "zoom" : "fathom",
    title: String(r.title ?? "Untitled meeting"),
    started_at: (r.started_at as string | null) ?? null,
    duration_seconds: (r.duration_seconds as number | null) ?? null,
    attendees: asAttendees(r.attendees),
    share_url: (r.share_url as string | null) ?? null,
    lead_id: (r.lead_id as string | null) ?? null,
    matter_id: (r.matter_id as string | null) ?? null,
    suggested_lead_id: (r.suggested_lead_id as string | null) ?? null,
    suggested_matter_id: (r.suggested_matter_id as string | null) ?? null,
    link_source: (r.link_source as string | null) ?? null,
    has_transcript: r.transcript_first !== null && r.transcript_first !== undefined,
    has_summary: Boolean(r.has_summary ?? r.summary),
  };
}

export async function listMeetings(filters: MeetingFilters = {}, limit = 200): Promise<ListRead> {
  try {
    const supabase = await getScopedClient();
    let q = supabase.from("crm_meeting").select(LIST_COLUMNS).order("started_at", { ascending: false, nullsFirst: false }).limit(limit);
    if (filters.provider) q = q.eq("provider", filters.provider);
    if (filters.linked === "linked") q = q.or("lead_id.not.is.null,matter_id.not.is.null");
    if (filters.linked === "unlinked") q = q.is("lead_id", null).is("matter_id", null);
    const { data, error } = await q;
    if (error) return { status: "unavailable" };
    return { status: "ok", meetings: ((data ?? []) as unknown as Record<string, unknown>[]).map(toItem) };
  } catch {
    return { status: "unavailable" };
  }
}

/** Meetings linked to one lead or one matter (the small section on those pages). */
export async function meetingsFor(target: { leadId?: string; matterId?: string }, limit = 20): Promise<ListRead> {
  try {
    const supabase = await getScopedClient();
    let q = supabase.from("crm_meeting").select(LIST_COLUMNS).order("started_at", { ascending: false, nullsFirst: false }).limit(limit);
    if (target.leadId) q = q.eq("lead_id", target.leadId);
    else if (target.matterId) q = q.eq("matter_id", target.matterId);
    else return { status: "ok", meetings: [] };
    const { data, error } = await q;
    if (error) return { status: "unavailable" };
    return { status: "ok", meetings: ((data ?? []) as unknown as Record<string, unknown>[]).map(toItem) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getMeeting(id: string): Promise<DetailRead> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "ok", meeting: null };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_meeting")
      .select(
        "id, provider, title, started_at, duration_seconds, attendees, share_url, lead_id, matter_id, suggested_lead_id, suggested_matter_id, link_source, summary, transcript, linked_by, linked_at, imported_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return { status: "unavailable" };
    if (!data) return { status: "ok", meeting: null };
    const r = data as unknown as Record<string, unknown>;
    const transcript = asTranscript(r.transcript);
    return {
      status: "ok",
      meeting: {
        ...toItem({ ...r, transcript_first: transcript[0] ?? null }),
        summary: (r.summary as string | null) ?? null,
        transcript,
        linked_by: (r.linked_by as string | null) ?? null,
        linked_at: (r.linked_at as string | null) ?? null,
        imported_at: String(r.imported_at),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

export type LinkLabels = { leads: Map<string, string>; matters: Map<string, string> };

/** Display names for the leads / matters a page's meetings point at. Best effort: a failed read shows ids as "Linked". */
export async function linkLabels(leadIds: string[], matterIds: string[]): Promise<LinkLabels> {
  const out: LinkLabels = { leads: new Map(), matters: new Map() };
  try {
    const supabase = await getScopedClient();
    const [leads, matters] = await Promise.all([
      leadIds.length
        ? supabase.from("crm_lead").select("id, first_name, last_name, business_name, email").in("id", [...new Set(leadIds)].slice(0, 500))
        : Promise.resolve({ data: [], error: null }),
      matterIds.length
        ? supabase.from("crm_matter").select("id, matter_number, mark_text, title").in("id", [...new Set(matterIds)].slice(0, 500))
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const l of (leads.data ?? []) as { id: string; first_name: string; last_name: string; business_name: string | null; email: string }[]) {
      out.leads.set(l.id, `${l.first_name} ${l.last_name}`.trim() || l.business_name || l.email);
    }
    for (const m of (matters.data ?? []) as { id: string; matter_number: string; mark_text: string | null; title: string | null }[]) {
      out.matters.set(m.id, [m.mark_text || m.title, m.matter_number].filter(Boolean).join(" · ") || "Matter");
    }
  } catch {
    /* labels are cosmetic */
  }
  return out;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
