import {
  MeetingAuthError,
  MeetingProviderError,
  cleanEmail,
  type FetchLike,
  type NormalizedMeeting,
  type TranscriptSegment,
} from "./types";

/**
 * Fathom's public API, with the FIRM'S OWN API key (docs/meetings-setup.md).
 *
 *   Base URL  https://api.fathom.ai/external/v1
 *   Auth      X-Api-Key: <key>   (User Settings → API Access in Fathom)
 *   List      GET /meetings?created_after=…&include_transcript=true
 *                 &include_summary=true&cursor=…   → { items, next_cursor, limit }
 *
 * A key sees the meetings its owner recorded or that were shared with them or
 * their team, and nothing else. Read-only: nothing here writes to Fathom.
 * Requests with include_transcript / include_summary are Fathom's "heavy"
 * class (30 per minute), so a run pages at most MAX_PAGES times.
 */

export const FATHOM_API_BASE = "https://api.fathom.ai/external/v1";
export const MAX_PAGES = 25;

type FathomInvitee = { name?: string | null; email?: string | null };
type FathomTranscriptItem = {
  speaker?: { display_name?: string | null; matched_calendar_invitee_email?: string | null } | null;
  text?: string | null;
  timestamp?: string | null;
};
export type FathomMeetingItem = {
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  created_at?: string | null;
  scheduled_start_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  recording_id?: number | string | null;
  calendar_invitees?: FathomInvitee[] | null;
  recorded_by?: { name?: string | null; email?: string | null } | null;
  transcript?: FathomTranscriptItem[] | null;
  default_summary?: { template_name?: string | null; markdown_formatted?: string | null } | null;
};
type FathomListResponse = { items?: FathomMeetingItem[] | null; next_cursor?: string | null };

function seconds(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/** One Fathom meeting → the shape crm_meeting stores. Pure. */
export function mapFathomMeeting(item: FathomMeetingItem): NormalizedMeeting | null {
  if (item.recording_id === null || item.recording_id === undefined || item.recording_id === "") return null;
  const transcript: TranscriptSegment[] = (item.transcript ?? [])
    .filter((t) => typeof t?.text === "string" && t.text.trim())
    .map((t) => ({
      speaker: t.speaker?.display_name?.trim() || "Speaker",
      text: (t.text as string).trim(),
      ...(t.timestamp ? { at: t.timestamp } : {}),
    }));
  const recorder = cleanEmail(item.recorded_by?.email);
  return {
    externalId: String(item.recording_id),
    title: item.meeting_title?.trim() || item.title?.trim() || "Untitled meeting",
    startedAt: item.recording_start_time ?? item.scheduled_start_time ?? item.created_at ?? null,
    durationSeconds: seconds(item.recording_start_time, item.recording_end_time),
    attendees: (item.calendar_invitees ?? []).map((a) => ({ name: a.name?.trim() || a.email?.trim() || "", email: cleanEmail(a.email) })),
    summary: item.default_summary?.markdown_formatted?.trim() || null,
    transcript: transcript.length > 0 ? transcript : null,
    shareUrl: item.share_url ?? item.url ?? null,
    cursorAt: item.created_at ?? null,
    hostEmails: recorder ? [recorder] : [],
  };
}

async function fathomGet(key: string, path: string, fetchImpl: FetchLike): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${FATHOM_API_BASE}${path}`, { headers: { "X-Api-Key": key, Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new MeetingProviderError("Couldn't reach Fathom.");
  }
  if (res.status === 401 || res.status === 403) throw new MeetingAuthError("Fathom didn't accept your firm's API key.");
  if (res.status === 429) throw new MeetingProviderError("Fathom is rate-limiting requests. Try again in a minute.", 429);
  if (!res.ok) throw new MeetingProviderError(`Fathom returned ${res.status}.`, res.status);
  try {
    return await res.json();
  } catch {
    throw new MeetingProviderError("Fathom returned something that wasn't JSON.", res.status);
  }
}

/** One cheap call (the ten most recent meetings, no transcripts) before a key is saved. */
export async function verifyFathomKey(key: string, fetchImpl: FetchLike = fetch): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await fathomGet(key, "/meetings", fetchImpl);
    return { ok: true };
  } catch (err) {
    if (err instanceof MeetingAuthError) return { ok: false, reason: "Fathom didn't accept that API key. Check it and try again." };
    return { ok: false, reason: "We couldn't reach Fathom to check the key. Try again shortly." };
  }
}

export function checkFathomKeyShape(raw: string): { ok: true; key: string } | { ok: false; reason: string } {
  const key = raw.trim();
  if (!key) return { ok: false, reason: "Paste your Fathom API key." };
  if (/\s/.test(key)) return { ok: false, reason: "That key has spaces in it. Copy it again from Fathom." };
  if (key.length < 16 || key.length > 1024) return { ok: false, reason: "That doesn't look like a Fathom API key." };
  return { ok: true, key };
}

export type FathomPull = { meetings: NormalizedMeeting[]; truncated: boolean };

/** Every meeting created after `since`, newest pages first, up to MAX_PAGES. */
export async function listFathomMeetings(args: { key: string; since: string; fetchImpl?: FetchLike; maxPages?: number }): Promise<FathomPull> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const maxPages = args.maxPages ?? MAX_PAGES;
  const meetings: NormalizedMeeting[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ created_after: args.since, include_transcript: "true", include_summary: "true" });
    if (cursor) q.set("cursor", cursor);
    const body = (await fathomGet(args.key, `/meetings?${q.toString()}`, fetchImpl)) as FathomListResponse;
    for (const item of body.items ?? []) {
      const m = mapFathomMeeting(item);
      if (m) meetings.push(m);
    }
    cursor = body.next_cursor || null;
    if (!cursor) return { meetings, truncated: false };
  }
  return { meetings, truncated: true };
}
