import { isConsultTitle } from "./outlook-parse";
import { addDays, zonedParts } from "./grid";
import { TODAY_CONSULT_CAP, TODAY_CONSULT_DAYS, type OutlookRead, type TodayConsult } from "./outlook-read";
import type { UpcomingZoom, ZoomUpcoming } from "@/lib/meetings/zoom";
import { sameLeadSameTime, type LawmaticsGate } from "./booked-merge";
import {
  LAWMATICS_CONSULTS_NOT_CONNECTED,
  LAWMATICS_CONSULTS_NOT_READY,
  LAWMATICS_CONSULTS_RECONNECT,
  LAWMATICS_CONSULTS_UNAVAILABLE,
} from "@/lib/ui/words";

/**
 * Today's Consults card: three sources merged. Pure rules here; the reads are injected (`ConsultDeps`) so the
 * states are tested with fakes and the real wiring lives in consult-sources-live.ts.
 *
 *   Outlook    the events the daily sync stored (Mailboxes module + Calendars.Read)
 *   Lawmatics  the consults the Lawmatics daily sync stored (its own `lmsync:` rows; not behind Mailboxes)
 *   Zoom       a LIVE read of the firm's upcoming meetings; nothing is stored
 *
 * Each source answers on its own. One failing never hides the other's consults, and a failed or
 * unconnected source is named, so an empty list is only ever "none" when every source was read.
 */

export type SourceState =
  | "ok"
  | "not-connected" // no connection at all
  | "needs-calendar" // Outlook connected, Calendars.Read not granted
  | "needs-permission" // Zoom refused the list scope
  | "reconnect" // the stored sign-in is dead
  | "no-module" // Mailboxes module off (Outlook only)
  | "update-needed" // database update pending (Outlook only)
  | "unavailable"; // could not be read

export type ConsultSourceName = "outlook" | "lawmatics" | "zoom";

export type ConsultItem = {
  key: string;
  source: ConsultSourceName;
  title: string;
  startsAt: string;
  allDay: boolean;
  joinUrl: string | null;
  leadId: string | null;
  leadName: string | null;
};

/** `lawmatics` is absent only when the caller didn't wire that source (it is then not named on the card). */
export type TodayConsultsResult = { consults: ConsultItem[]; outlook: SourceState; zoom: SourceState; lawmatics?: SourceState };

export type OutlookConnections = { ok: true; active: number; withCalendar: number } | { ok: false };

export type ZoomAccessResult =
  | { state: "ok"; accessToken: string }
  | { state: "not-connected" | "reconnect" | "unreadable" };

export type LeadRef = { leadId: string; leadName: string | null };

export type ConsultDeps = {
  hasMailboxModule(): Promise<boolean>;
  outlookConnections(): Promise<OutlookConnections>;
  outlook(now: Date, timeZone: string): Promise<OutlookRead<{ consults: TodayConsult[] }>>;
  zoomAccess(): Promise<ZoomAccessResult>;
  zoomUpcoming(accessToken: string): Promise<UpcomingZoom>;
  /** Leads for Zoom meetings by an EXACT meeting-id / join-URL match to an imported meeting; never a guess. */
  zoomLeads(meetings: readonly ZoomUpcoming[]): Promise<ReadonlyMap<string, LeadRef>>;
  /** Is the firm's own Lawmatics connected? Both Lawmatics deps are optional: absent, that source isn't read or named. */
  lawmaticsGate?(): Promise<LawmaticsGate>;
  lawmatics?(now: Date, timeZone: string): Promise<OutlookRead<{ consults: TodayConsult[] }>>;
};

/** One key for "the same call": a Zoom /j/<id> link and a Zoom meeting id agree, any other link is its own URL. */
export function joinKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const zoom = u.pathname.match(/^\/(?:j\/|wc\/join\/|my\/[^/]+\/)?(\d{8,})/);
    if (/(^|\.)zoom\.(us|com)$/.test(u.hostname) && zoom) return `zoom:${zoom[1]}`;
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

export const zoomMeetingKey = (m: ZoomUpcoming): string => `zoom:${m.id}`;

export function outlookItem(c: TodayConsult): ConsultItem {
  return storedItem(c, "outlook");
}

export function lawmaticsItem(c: TodayConsult): ConsultItem {
  return storedItem(c, "lawmatics");
}

function storedItem(c: TodayConsult, source: "outlook" | "lawmatics"): ConsultItem {
  return {
    key: `${source}:${c.id}`,
    source,
    title: c.title?.trim() || "Consult",
    startsAt: c.starts_at,
    allDay: c.all_day === true,
    joinUrl: c.join_url,
    leadId: c.lead_id,
    leadName: c.lead_name,
  };
}

/** Zoom meetings that are consults (the same title rule as Outlook's) and start in [today, today + 7 days]. */
export function zoomConsults(meetings: readonly ZoomUpcoming[], leads: ReadonlyMap<string, LeadRef>, now: Date, timeZone: string): ConsultItem[] {
  const today = zonedParts(now.toISOString(), timeZone).date;
  const last = addDays(today, TODAY_CONSULT_DAYS);
  return meetings
    .filter((m) => isConsultTitle(m.title))
    .filter((m) => {
      const date = zonedParts(m.startsAt, timeZone).date;
      return date >= today && date <= last;
    })
    .map((m): ConsultItem => {
      const lead = leads.get(zoomMeetingKey(m)) ?? null;
      return {
        key: zoomMeetingKey(m),
        source: "zoom",
        title: m.title || "Consult",
        startsAt: m.startsAt,
        allDay: false,
        joinUrl: m.joinUrl,
        leadId: lead?.leadId ?? null,
        leadName: lead?.leadName ?? null,
      };
    });
}

/** The keys one row is known by: its join link's key, and a Zoom meeting's own key. */
function callKeys(c: ConsultItem): string[] {
  return [joinKey(c.joinUrl), c.source === "zoom" ? c.key : null].filter((k): k is string => k !== null);
}

/**
 * Sorted by start; one row per call. Twins are a shared join key (a Zoom link and its meeting id agree), or the same
 * lead with starts within 15 minutes. The row kept is the first in the order Outlook, Lawmatics, Zoom, and a lead link
 * found on any twin is kept.
 */
export function mergeConsults(outlook: readonly ConsultItem[], zoom: readonly ConsultItem[], lawmatics: readonly ConsultItem[] = []): ConsultItem[] {
  const out: ConsultItem[] = [];
  const seen = new Map<string, ConsultItem>();
  for (const c of [...outlook, ...lawmatics, ...zoom]) {
    const keys = callKeys(c);
    const twin = keys.map((k) => seen.get(k)).find((x): x is ConsultItem => x !== undefined) ?? out.find((o) => sameLeadSameTime(o, c));
    if (twin) {
      if (!twin.leadId && c.leadId) {
        twin.leadId = c.leadId;
        twin.leadName = c.leadName;
      }
      for (const k of keys) if (!seen.has(k)) seen.set(k, twin);
      continue;
    }
    const kept = { ...c };
    out.push(kept);
    for (const k of keys) seen.set(k, kept);
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, TODAY_CONSULT_CAP);
}

async function readOutlook(now: Date, timeZone: string, deps: ConsultDeps): Promise<{ state: SourceState; items: ConsultItem[] }> {
  try {
    if (!(await deps.hasMailboxModule())) return { state: "no-module", items: [] };
    const conns = await deps.outlookConnections();
    if (!conns.ok) return { state: "unavailable", items: [] };
    if (conns.active === 0) return { state: "not-connected", items: [] };
    if (conns.withCalendar === 0) return { state: "needs-calendar", items: [] };
    const read = await deps.outlook(now, timeZone);
    if (read.status === "database-update-needed") return { state: "update-needed", items: [] };
    if (read.status === "unavailable") return { state: "unavailable", items: [] };
    return { state: "ok", items: read.consults.map(outlookItem) };
  } catch {
    return { state: "unavailable", items: [] };
  }
}

async function readZoom(now: Date, timeZone: string, deps: ConsultDeps): Promise<{ state: SourceState; items: ConsultItem[] }> {
  try {
    const access = await deps.zoomAccess();
    if (access.state === "not-connected") return { state: "not-connected", items: [] };
    if (access.state === "reconnect") return { state: "reconnect", items: [] };
    // A helper that refuses or returns nothing is "couldn't be read", never "no consults".
    if (access.state !== "ok" || !access.accessToken) return { state: "unavailable", items: [] };
    const read = await deps.zoomUpcoming(access.accessToken);
    if (read.status !== "ok") return { state: read.status, items: [] };
    const consults = read.meetings.filter((m) => isConsultTitle(m.title));
    let leads: ReadonlyMap<string, LeadRef> = new Map();
    try {
      leads = await deps.zoomLeads(consults);
    } catch {
      // The consults are still listed, just without a lead link.
    }
    return { state: "ok", items: zoomConsults(consults, leads, now, timeZone) };
  } catch {
    return { state: "unavailable", items: [] };
  }
}

async function readLawmatics(now: Date, timeZone: string, deps: ConsultDeps): Promise<{ state: SourceState; items: ConsultItem[] } | null> {
  if (!deps.lawmaticsGate || !deps.lawmatics) return null;
  try {
    const gate = await deps.lawmaticsGate();
    if (gate === "not-connected") return { state: "not-connected", items: [] };
    if (gate === "unavailable") return { state: "unavailable", items: [] };
    const read = await deps.lawmatics(now, timeZone);
    if (read.status === "database-update-needed") return { state: "update-needed", items: [] };
    if (read.status === "unavailable") return { state: "unavailable", items: [] };
    // A refused key: the consults already stored are shown, and the card says to reconnect.
    return { state: gate === "invalid" ? "reconnect" : "ok", items: read.consults.map(lawmaticsItem) };
  } catch {
    return { state: "unavailable", items: [] };
  }
}

export async function loadTodayConsults(now: Date, timeZone: string, deps: ConsultDeps): Promise<TodayConsultsResult> {
  const [o, z, l] = await Promise.all([readOutlook(now, timeZone, deps), readZoom(now, timeZone, deps), readLawmatics(now, timeZone, deps)]);
  const result: TodayConsultsResult = { consults: mergeConsults(o.items, z.items, l?.items ?? []), outlook: o.state, zoom: z.state };
  if (l) result.lawmatics = l.state;
  return result;
}

/** The sources a card names, in its order. Lawmatics only when it was wired. */
export function consultSources(result: TodayConsultsResult): Array<{ source: ConsultSourceName; state: SourceState }> {
  return [
    { source: "outlook" as const, state: result.outlook },
    ...(result.lawmatics !== undefined ? [{ source: "lawmatics" as const, state: result.lawmatics }] : []),
    { source: "zoom" as const, state: result.zoom },
  ];
}

/** What the card says about each source that was not read. Words only; the link is the next step. */
export type SourceNote = { source: ConsultSourceName; text: string; link: { label: string; href: string } | null };

const INTEGRATIONS = "/dashboard/settings/integrations/";
const MEETINGS_SETTINGS = "/dashboard/settings/integrations/meetings/";
const LAWMATICS_SETTINGS = "/dashboard/settings/integrations/lawmatics/";

export function sourceNote(source: ConsultSourceName, state: SourceState): SourceNote | null {
  if (state === "ok") return null;
  if (source === "lawmatics") {
    switch (state) {
      case "not-connected":
        return { source, text: LAWMATICS_CONSULTS_NOT_CONNECTED, link: { label: "Connect Lawmatics", href: LAWMATICS_SETTINGS } };
      case "reconnect":
        return { source, text: LAWMATICS_CONSULTS_RECONNECT, link: { label: "Reconnect Lawmatics", href: LAWMATICS_SETTINGS } };
      case "update-needed":
        return { source, text: LAWMATICS_CONSULTS_NOT_READY, link: { label: "See Integrations", href: INTEGRATIONS } };
      default:
        return { source, text: LAWMATICS_CONSULTS_UNAVAILABLE, link: { label: "See Integrations", href: INTEGRATIONS } };
    }
  }
  if (source === "zoom") {
    switch (state) {
      case "needs-permission":
        return { source, text: "Zoom needs permission to read upcoming meetings.", link: { label: "Reconnect Zoom", href: MEETINGS_SETTINGS } };
      case "reconnect":
        return { source, text: "Zoom no longer accepts your firm's sign-in.", link: { label: "Reconnect Zoom", href: MEETINGS_SETTINGS } };
      case "not-connected":
        return { source, text: "Zoom isn't connected, so Zoom consults aren't shown.", link: { label: "Connect Zoom", href: MEETINGS_SETTINGS } };
      default:
        return { source, text: "Zoom meetings couldn't be read.", link: { label: "Check Zoom", href: MEETINGS_SETTINGS } };
    }
  }
  switch (state) {
    case "needs-calendar":
      return { source, text: "Outlook calendar isn't connected.", link: { label: "Reconnect to read the calendar", href: INTEGRATIONS } };
    case "not-connected":
      return { source, text: "Outlook calendar isn't connected.", link: { label: "Connect Outlook", href: INTEGRATIONS } };
    case "no-module":
      return { source, text: "Outlook calendar isn't switched on for your firm.", link: { label: "See Integrations", href: INTEGRATIONS } };
    case "update-needed":
      return { source, text: "Consults from Outlook aren't switched on for your firm yet. Lectual will turn them on.", link: { label: "See Integrations", href: INTEGRATIONS } };
    case "reconnect":
      return { source, text: "Outlook no longer accepts your firm's sign-in.", link: { label: "Reconnect Outlook", href: INTEGRATIONS } };
    default:
      return { source, text: "Outlook consults couldn't be read just now.", link: { label: "See Integrations", href: INTEGRATIONS } };
  }
}
