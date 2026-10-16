import {
  MeetingAuthError,
  MeetingProviderError,
  cleanEmail,
  type FetchLike,
  type NormalizedMeeting,
  type TranscriptSegment,
} from "./types";

/**
 * Zoom, through the firm's own OAuth grant (a user-managed OAuth app that
 * Lectual registers once; docs/meetings-setup.md).
 *
 *   Authorize  https://zoom.us/oauth/authorize?response_type=code&client_id&redirect_uri
 *              &state&code_challenge&code_challenge_method=S256
 *   Token      POST https://zoom.us/oauth/token, HTTP Basic client_id:client_secret,
 *              grant_type=authorization_code (+ code, redirect_uri, code_verifier)
 *              or grant_type=refresh_token. Access tokens last one hour; the
 *              refresh token ROTATES on every refresh (90-day life), so the new
 *              one must be stored every time or the connection dies.
 *   Revoke     POST https://zoom.us/oauth/revoke, Basic, token=<access token>
 *   Recordings GET https://api.zoom.us/v2/users/me/recordings?from&to&page_size
 *              &next_page_token (from/to at most 30 days apart). A meeting's
 *              recording_files include file_type TRANSCRIPT (WebVTT) once Zoom
 *              has produced it; its download_url takes the access token as a
 *              Bearer header.
 *   Me         GET https://api.zoom.us/v2/users/me (shown as the account hint)
 *
 * Read-only: nothing here writes to Zoom.
 */

export const ZOOM_AUTHORIZE_URL = "https://zoom.us/oauth/authorize";
export const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
export const ZOOM_REVOKE_URL = "https://zoom.us/oauth/revoke";
export const ZOOM_API_BASE = "https://api.zoom.us/v2";
const WINDOW_DAYS = 30;
const MAX_PAGES_PER_WINDOW = 10;
const MAX_TRANSCRIPTS = 60;

export type ZoomClientCredentials = { clientId: string; clientSecret: string };
export type ZoomTokenSet = { accessToken: string; refreshToken: string; expiresAt: string; scopes: string[] };

export function zoomAuthorizeUrl(args: { clientId: string; redirectUri: string; nonce: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.nonce,
    code_challenge: args.challenge,
    code_challenge_method: "S256",
  });
  return `${ZOOM_AUTHORIZE_URL}?${q.toString()}`;
}

function basic(creds: ZoomClientCredentials): string {
  return `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`;
}

async function tokenRequest(creds: ZoomClientCredentials, body: URLSearchParams, fetchImpl: FetchLike, now: number): Promise<ZoomTokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(ZOOM_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: basic(creds), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    throw new MeetingProviderError("Couldn't reach Zoom.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // invalid_grant = the refresh token (or code) is dead: only a person can fix that.
    if (res.status === 400 || res.status === 401) throw new MeetingAuthError("Zoom no longer accepts your firm's sign-in.");
    throw new MeetingProviderError(`Zoom token request failed (${res.status}).`, res.status);
  }
  const access = typeof json.access_token === "string" ? json.access_token : "";
  const refresh = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!access || !refresh) throw new MeetingProviderError("Zoom's token response was missing a token.");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    scopes: typeof json.scope === "string" ? json.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

export function exchangeZoomCode(args: {
  creds: ZoomClientCredentials;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<ZoomTokenSet> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: args.code, redirect_uri: args.redirectUri, code_verifier: args.verifier });
  return tokenRequest(args.creds, body, args.fetchImpl ?? fetch, args.now ?? Date.now());
}

export function refreshZoomToken(args: { creds: ZoomClientCredentials; refreshToken: string; fetchImpl?: FetchLike; now?: number }): Promise<ZoomTokenSet> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: args.refreshToken });
  return tokenRequest(args.creds, body, args.fetchImpl ?? fetch, args.now ?? Date.now());
}

/** Best effort: a failed revoke never blocks a disconnect (the sealed tokens are deleted either way). */
export async function revokeZoomToken(args: { creds: ZoomClientCredentials; token: string; fetchImpl?: FetchLike }): Promise<void> {
  try {
    await (args.fetchImpl ?? fetch)(ZOOM_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basic(args.creds), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: args.token }).toString(),
      cache: "no-store",
    });
  } catch {
    /* ignore */
  }
}

async function zoomGet(accessToken: string, url: string, fetchImpl: FetchLike, as: "json" | "text" = "json"): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  } catch {
    throw new MeetingProviderError("Couldn't reach Zoom.");
  }
  if (res.status === 401) throw new MeetingAuthError("Zoom no longer accepts your firm's sign-in.");
  if (res.status === 429) throw new MeetingProviderError("Zoom is rate-limiting requests. Try again later.", 429);
  if (!res.ok) throw new MeetingProviderError(`Zoom returned ${res.status}.`, res.status);
  return as === "json" ? res.json() : res.text();
}

export async function getZoomUser(accessToken: string, fetchImpl: FetchLike = fetch): Promise<{ id: string | null; email: string | null }> {
  const me = (await zoomGet(accessToken, `${ZOOM_API_BASE}/users/me`, fetchImpl)) as { id?: string; email?: string };
  return { id: typeof me.id === "string" ? me.id : null, email: cleanEmail(me.email) };
}

/**
 * WebVTT → speaker turns. Zoom writes each cue as "Name: words"; some
 * exporters use <v Name>words</v>. Consecutive cues from one speaker merge.
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const at = lines[timeIdx].split("-->")[0].trim().replace(/\.\d+$/, "");
    const text = lines.slice(timeIdx + 1).join(" ").trim();
    if (!text) continue;
    let speaker = "Speaker";
    let words = text;
    const v = text.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/);
    if (v) {
      speaker = v[1].trim();
      words = v[2].trim();
    } else {
      const colon = text.indexOf(": ");
      if (colon > 0 && colon <= 80) {
        speaker = text.slice(0, colon).trim();
        words = text.slice(colon + 2).trim();
      }
    }
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text = `${last.text} ${words}`;
    else out.push({ speaker, text: words, ...(at ? { at } : {}) });
  }
  return out;
}

type ZoomRecordingFile = { file_type?: string; download_url?: string; status?: string; recording_type?: string };
export type ZoomMeeting = {
  uuid?: string;
  id?: number | string;
  topic?: string;
  start_time?: string;
  duration?: number;
  host_email?: string;
  share_url?: string;
  recording_files?: ZoomRecordingFile[];
};

/** One Zoom recording (+ its transcript, if downloaded) → the crm_meeting shape. Pure. */
export function mapZoomMeeting(m: ZoomMeeting, transcript: TranscriptSegment[] | null): NormalizedMeeting | null {
  const externalId = m.uuid || (m.id !== undefined ? String(m.id) : "");
  if (!externalId) return null;
  const host = cleanEmail(m.host_email);
  // Zoom's recording list names no participants; the transcript's speakers are
  // the best we have (names only, no email, so they never auto-link).
  const speakers = [...new Set((transcript ?? []).map((s) => s.speaker).filter((s) => s && s !== "Speaker"))];
  return {
    externalId,
    title: m.topic?.trim() || "Zoom meeting",
    startedAt: m.start_time ?? null,
    durationSeconds: typeof m.duration === "number" ? m.duration * 60 : null,
    attendees: speakers.map((name) => ({ name, email: null })),
    summary: null,
    transcript: transcript && transcript.length > 0 ? transcript : null,
    shareUrl: m.share_url ?? null,
    cursorAt: m.start_time ?? null,
    hostEmails: host ? [host] : [],
  };
}

function day(iso: number): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** 30-day windows from `since` to `now` (Zoom refuses a longer from/to range). */
export function zoomWindows(since: string, now: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start = Date.parse(since);
  if (!Number.isFinite(start) || start > now) start = now;
  while (start <= now) {
    const end = Math.min(start + (WINDOW_DAYS - 1) * 86_400_000, now);
    out.push({ from: day(start), to: day(end) });
    start = end + 86_400_000;
  }
  return out;
}

export type ZoomPull = { meetings: NormalizedMeeting[]; truncated: boolean };

export async function listZoomMeetings(args: { accessToken: string; since: string; now?: number; fetchImpl?: FetchLike }): Promise<ZoomPull> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.now ?? Date.now();
  const sinceMs = Date.parse(args.since);
  const raw: ZoomMeeting[] = [];
  let truncated = false;
  for (const w of zoomWindows(args.since, now)) {
    let token = "";
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES_PER_WINDOW) {
        truncated = true;
        break;
      }
      const q = new URLSearchParams({ from: w.from, to: w.to, page_size: "30" });
      if (token) q.set("next_page_token", token);
      const body = (await zoomGet(args.accessToken, `${ZOOM_API_BASE}/users/me/recordings?${q.toString()}`, fetchImpl)) as {
        meetings?: ZoomMeeting[];
        next_page_token?: string;
      };
      raw.push(...(body.meetings ?? []));
      token = body.next_page_token ?? "";
      if (!token) break;
    }
  }
  // from/to are whole days; drop what the cursor already covered.
  const fresh = raw.filter((m) => !m.start_time || !Number.isFinite(sinceMs) || Date.parse(m.start_time) > sinceMs);
  const meetings: NormalizedMeeting[] = [];
  let downloads = 0;
  for (const m of fresh) {
    const file = (m.recording_files ?? []).find((f) => f.file_type === "TRANSCRIPT" && (f.status ?? "completed") === "completed" && f.download_url);
    let transcript: TranscriptSegment[] | null = null;
    if (file?.download_url && downloads < MAX_TRANSCRIPTS && /^https:\/\/([a-z0-9-]+\.)*zoom\.us\//i.test(file.download_url)) {
      downloads++;
      transcript = parseVtt(String(await zoomGet(args.accessToken, file.download_url, fetchImpl, "text")));
    } else if (file) {
      truncated = truncated || downloads >= MAX_TRANSCRIPTS;
    }
    const mapped = mapZoomMeeting(m, transcript);
    if (mapped) meetings.push(mapped);
  }
  return { meetings, truncated };
}
