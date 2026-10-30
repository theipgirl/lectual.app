/**
 * The consults strip at the top of the proposals page: recent Zoom / Fathom recordings with
 * what can be done with each. Pure and client-safe; the clock and the firm's zone are
 * arguments. The reads live in `consults-load.ts`.
 *
 * A row is in one of four states (`consultRowState`):
 *
 *   drafted       the consult agent's `queue_drafted` marker names this meeting, or (no marker)
 *                 a proposal for the same lead was created after the meeting started
 *   unlinked      the meeting has no lead, and no matter whose lead can be used
 *   transcribing  no transcript yet (a summary alone is not enough for this strip)
 *   ready         a transcript, a lead and no draft yet
 *
 * A marker match always wins over the same-lead fallback.
 */

import { PROVIDER_LABEL, type MeetingProvider } from "@/lib/meetings/types";
import { relativeTime } from "@/lib/relative-time";
import { isConsultTitle } from "@/lib/calendar/outlook-parse";
import { dayMonth } from "./list-labels";

export type ConsultMeeting = {
  id: string;
  /** The lead to draft for: the meeting's own, else its matter's. Null when neither is known. */
  leadId: string | null;
  startedAt: string | null;
  hasTranscript: boolean;
};

export type ConsultDraftFacts = {
  /** `crm_activity` rows of type queue_drafted with payload.source = "consult-proposal". */
  markers: ReadonlyArray<{ meetingId: string | null; proposalId: string | null }>;
  /** The proposals the firm has (newest version of each), for the same-lead fallback. */
  proposals: ReadonlyArray<{ id: string; leadId: string | null; createdAt: string; source: string }>;
};

export type ConsultRowState = { state: "transcribing" | "ready" | "drafted" | "unlinked"; proposalId: string | null };

export function consultRowState(meeting: ConsultMeeting, facts: ConsultDraftFacts): ConsultRowState {
  const marker = facts.markers.find((m) => m.meetingId === meeting.id);
  if (marker) return { state: "drafted", proposalId: marker.proposalId };
  if (!meeting.leadId) return { state: "unlinked", proposalId: null };
  if (!meeting.hasTranscript) return { state: "transcribing", proposalId: null };

  const started = meeting.startedAt ? Date.parse(meeting.startedAt) : NaN;
  if (!Number.isNaN(started)) {
    // A revision is the same offer revised, not a draft made from this call; the earliest one after the call is the closest.
    const after = facts.proposals
      .filter((p) => p.leadId === meeting.leadId && p.source !== "revision" && Date.parse(p.createdAt) >= started)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (after.length > 0) return { state: "drafted", proposalId: after[0].id };
  }
  return { state: "ready", proposalId: null };
}

export const CONSULT_STATE_PILL: Record<ConsultRowState["state"], { label: string; tone: "ok" | "ox" | "mute" | "warn" }> = {
  drafted: { label: "Proposal created", tone: "ok" },
  ready: { label: "Ready to draft", tone: "ox" },
  transcribing: { label: "Transcript still processing", tone: "mute" },
  unlinked: { label: "Not linked", tone: "warn" },
};

export const CONSULT_WINDOW_DAYS = 14;
/** The newest N meetings the list holds; past it the list says "Showing the newest N". */
export const CONSULT_ROW_CAP = 30;

/**
 * Which meetings the "Consults and client meetings" list holds: a consult by title (the same
 * regex the calendar sync uses), or any meeting already linked to a lead or a matter.
 */
export function isListedMeeting(m: { title: string | null | undefined; leadId: string | null; matterId: string | null }): boolean {
  return isConsultTitle(m.title) || !!m.leadId || !!m.matterId;
}

/** The row's own link to the meeting page. The id is encoded; `from=proposals` makes the page offer a way back. */
export function meetingRowHref(id: string): string {
  return `/dashboard/meetings/${encodeURIComponent(id)}/?from=proposals`;
}

/** "Oct 28, 2:30 PM" in the firm's zone; "Date unknown" when the provider gave none. */
export function meetingWhen(iso: string | null, tz: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "Date unknown";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t));
}

/** The meeting page's back link: only the exact value `proposals` (a string, or a repeated key's first) shows one. */
export function meetingBackHref(from: string | string[] | undefined): string | null {
  const v = Array.isArray(from) ? from[0] : from;
  return v === "proposals" ? "/dashboard/proposals/" : null;
}

/** "today", "yesterday", a weekday within the last week, else "21 Aug" — all in the firm's zone. */
export function consultWhen(iso: string | null, now: number, tz: string): string {
  if (!iso) return "date unknown";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "date unknown";
  const civil = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const today = civil(now);
  const day = civil(t);
  if (day === today) return "today";
  if (day === civil(now - 86_400_000)) return "yesterday";
  if (now - t < 6 * 86_400_000) return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date(t));
  return dayMonth(iso, tz);
}

/** "Zoom consult · 21 Aug · 41 min · transcript synced". The duration is left out when the provider gave none. */
export function consultLine(input: { provider: MeetingProvider; startedAt: string | null; durationSeconds: number | null; hasTranscript: boolean; now: number; tz: string }): string {
  const parts = [`${PROVIDER_LABEL[input.provider]} consult`, consultWhen(input.startedAt, input.now, input.tz)];
  if (input.durationSeconds && input.durationSeconds > 0) parts.push(`${Math.max(1, Math.round(input.durationSeconds / 60))} min`);
  parts.push(input.hasTranscript ? "transcript synced" : "transcribing");
  return parts.join(" · ");
}

/* ─────────────────────────── the header ─────────────────────────────────── */

export type ConnectionSummary = { provider: MeetingProvider; status: "active" | "reauth" | "revoked"; last_import_at: string | null };
export type ConnectionHeader = {
  /** "Zoom consults", "Fathom consults", or "Consults" when both or neither is connected. */
  title: string;
  status:
    | { kind: "connected"; text: string }
    | { kind: "reauth"; text: string }
    | { kind: "none"; text: string }
    | { kind: "unavailable"; text: string };
};

/**
 * The strip's title and connection line. `null` is a connections read that failed, which is
 * not the same as "not connected": it says so. A connection that needs reconnecting outranks
 * a healthy one, so the problem is not hidden by the other provider working.
 */
export function connectionHeader(connections: readonly ConnectionSummary[] | null, now: number): ConnectionHeader {
  if (connections === null) return { title: "Consults", status: { kind: "unavailable", text: "connection status couldn't be loaded" } };
  const live = connections.filter((c) => c.status !== "revoked");
  if (live.length === 0) return { title: "Consults", status: { kind: "none", text: "not connected" } };
  const title = live.length === 1 ? `${PROVIDER_LABEL[live[0].provider]} consults` : "Consults";
  const broken = live.filter((c) => c.status === "reauth");
  if (broken.length > 0) {
    const who = broken.map((c) => PROVIDER_LABEL[c.provider]).join(" and ");
    return { title, status: { kind: "reauth", text: `${who} needs reconnecting` } };
  }
  const last = live
    .map((c) => (c.last_import_at ? Date.parse(c.last_import_at) : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0];
  const text = last === undefined ? "connected · no import yet" : `connected · last sync ${relativeTime(new Date(last).toISOString(), now)}`;
  return { title, status: { kind: "connected", text } };
}
