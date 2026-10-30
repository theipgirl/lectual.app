import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMeetings } from "@/lib/meetings/read";
import { listMeetingConnections } from "@/lib/meetings/connection";
import type { MeetingProvider } from "@/lib/meetings/types";
import { CONSULT_PROPOSAL_SOURCE } from "@/lib/consult-proposal/shared";
import {
  CONSULT_ROW_CAP,
  CONSULT_WINDOW_DAYS,
  connectionHeader,
  consultLine,
  consultRowState,
  isListedMeeting,
  meetingWhen,
  type ConnectionHeader,
  type ConsultDraftFacts,
  type ConsultRowState,
} from "./consult-row";

/**
 * What the consults strip shows, read through the caller's own scoped client (RLS on org_id
 * is the boundary: another firm's meeting is never in the list).
 *
 * Three states, never two. A failed meetings read is `unavailable` ("Couldn't load consults"),
 * never an empty strip; a failed connections read is its own header line ("connection status
 * couldn't be loaded"), never "not connected". The reads that only decorate a row (the lead's
 * name, the matter's lead, the "already drafted" markers) degrade quietly: a missing name falls
 * back to the meeting's title, and a missing marker falls back to the same-lead proposal rule.
 * The draft action re-checks "already drafted" itself, so a missed marker can't make a second draft.
 */

export type ConsultRowView = {
  id: string;
  provider: MeetingProvider;
  /** The meeting's own title. */
  title: string;
  /** Start time in the firm's zone. */
  whenLabel: string;
  /** The lead's or matter's name, or null when the meeting is not linked. */
  linkedTo: string | null;
  clientName: string;
  company: string | null;
  line: string;
  state: ConsultRowState["state"];
  proposalId: string | null;
  leadId: string | null;
  /** The meeting's own matter, kept when a lead is linked from the strip. */
  matterId?: string | null;
};

export type ConsultsStripData = {
  header: ConnectionHeader;
  meetings: { status: "ok"; rows: ConsultRowView[]; more: number } | { status: "unavailable" };
};

type LeadName = { first_name: string | null; last_name: string | null; business_name: string | null };

export async function loadConsultsStrip(input: {
  now: number;
  tz: string;
  proposals: ConsultDraftFacts["proposals"];
}): Promise<ConsultsStripData> {
  const [conns, read] = await Promise.all([listMeetingConnections(), listMeetings()]);
  const header = connectionHeader(conns.ok ? conns.connections : null, input.now);
  if (read.status !== "ok") return { header, meetings: { status: "unavailable" } };

  const since = input.now - CONSULT_WINDOW_DAYS * 86_400_000;
  const recent = read.meetings
    .filter((m) => m.started_at !== null && Date.parse(m.started_at) >= since)
    .filter((m) => isListedMeeting({ title: m.title, leadId: m.lead_id, matterId: m.matter_id }))
    .sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string));
  if (recent.length === 0) return { header, meetings: { status: "ok", rows: [], more: 0 } };

  const shown = recent.slice(0, CONSULT_ROW_CAP);
  const supabase = await getScopedClient();

  // A meeting linked to a matter but not a lead uses the matter's lead, as the meeting page does.
  const matterIds = [...new Set(shown.filter((m) => !m.lead_id && m.matter_id).map((m) => m.matter_id as string))];
  const matterLead = new Map<string, string>();
  const matterTitle = new Map<string, string>();
  if (matterIds.length > 0) {
    try {
      const { data } = await supabase.from("crm_matter").select("id, lead_id, title").in("id", matterIds);
      for (const r of (data ?? []) as Array<{ id: string; lead_id: string | null; title: string | null }>) {
        if (r.lead_id) matterLead.set(r.id, r.lead_id);
        if (r.title?.trim()) matterTitle.set(r.id, r.title.trim());
      }
    } catch {
      /* the row then reads as not linked and points at the meeting page */
    }
  }
  const leadOf = (m: (typeof shown)[number]) => m.lead_id ?? (m.matter_id ? (matterLead.get(m.matter_id) ?? null) : null);
  const leadIds = [...new Set(shown.map(leadOf).filter((id): id is string => !!id))];

  const names = new Map<string, LeadName>();
  const markers: Array<{ meetingId: string | null; proposalId: string | null }> = [];
  if (leadIds.length > 0) {
    const [leads, marks] = await Promise.all([
      supabase.from("crm_lead").select("id, first_name, last_name, business_name").in("id", leadIds).then(
        (r) => r,
        () => null,
      ),
      supabase
        .from("crm_activity")
        .select("payload")
        .eq("type", "queue_drafted")
        .eq("payload->>source", CONSULT_PROPOSAL_SOURCE)
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false })
        .limit(200)
        .then(
          (r) => r,
          () => null,
        ),
    ]);
    for (const l of (leads?.data ?? []) as Array<LeadName & { id: string }>) names.set(l.id, l);
    const found: Array<{ meetingId: string | null; proposalId: string | null }> = [];
    for (const row of (marks?.data ?? []) as Array<{ payload: unknown }>) {
      const p = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
      found.push({
        meetingId: typeof p.meeting_id === "string" ? p.meeting_id : null,
        proposalId: typeof p.proposal_id === "string" ? p.proposal_id : null,
      });
    }
    markers.push(...found);
  }

  const rows = shown.map((m): ConsultRowView => {
    const leadId = leadOf(m);
    const lead = leadId ? names.get(leadId) : undefined;
    const person = `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim();
    const company = lead?.business_name?.trim() || null;
    const facts = consultRowState(
      { id: m.id, leadId, startedAt: m.started_at, hasTranscript: m.has_transcript },
      { markers, proposals: input.proposals },
    );
    // A name that couldn't be read still says the meeting IS linked; only a meeting with neither link reads "Not linked".
    const linkedTo = person || company || (m.matter_id ? matterTitle.get(m.matter_id) : undefined) || (leadId ? "A lead" : m.matter_id ? "A matter" : null);
    return {
      id: m.id,
      provider: m.provider,
      title: m.title,
      whenLabel: meetingWhen(m.started_at, input.tz),
      linkedTo,
      clientName: person || company || m.title,
      company: person && company ? company : null,
      line: consultLine({ provider: m.provider, startedAt: m.started_at, durationSeconds: m.duration_seconds, hasTranscript: m.has_transcript, now: input.now, tz: input.tz }),
      state: facts.state,
      proposalId: facts.proposalId,
      leadId,
      matterId: m.matter_id ?? null,
    };
  });
  return { header, meetings: { status: "ok", rows, more: recent.length - shown.length } };
}
