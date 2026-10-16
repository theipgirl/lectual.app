/**
 * Meetings (lectual 0081): a firm's consult and meeting recordings, imported
 * from its OWN Fathom or Zoom account. Pure types, shared by the provider
 * clients, the importer and the pages.
 */

export type MeetingProvider = "fathom" | "zoom";
export const MEETING_PROVIDERS: readonly MeetingProvider[] = ["fathom", "zoom"];
export const PROVIDER_LABEL: Record<MeetingProvider, string> = { fathom: "Fathom", zoom: "Zoom" };

export function isMeetingProvider(value: unknown): value is MeetingProvider {
  return value === "fathom" || value === "zoom";
}

/** Names and email addresses only. Nothing else about a person is stored. */
export type Attendee = { name: string; email: string | null };

/** One speaker turn. `at` is the provider's offset ("00:05:32"), when it gives one. */
export type TranscriptSegment = { speaker: string; text: string; at?: string };

/** A meeting as the importer writes it, whichever provider it came from. */
export type NormalizedMeeting = {
  externalId: string;
  title: string;
  startedAt: string | null;
  durationSeconds: number | null;
  attendees: Attendee[];
  summary: string | null;
  transcript: TranscriptSegment[] | null;
  shareUrl: string | null;
  /** The provider's own "created" time, which the import cursor advances on. */
  cursorAt: string | null;
  /** Emails that belong to the firm's side of the call (the recorder / host). Never used to match a client. */
  hostEmails: string[];
};

/** A provider refused the firm's credential (401/403): the connection needs an admin. */
export class MeetingAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeetingAuthError";
  }
}

/** Anything else that went wrong talking to a provider. */
export class MeetingProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MeetingProviderError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_TITLE = 500;
const MAX_SUMMARY = 100_000;
const MAX_ATTENDEES = 200;
const MAX_SEGMENTS = 20_000;

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 320 ? e : null;
}

/** Bounds every field to what the 0081 CHECKs accept, so an odd payload is trimmed, not refused. */
export function boundMeeting(m: NormalizedMeeting): NormalizedMeeting {
  const seen = new Set<string>();
  const attendees: Attendee[] = [];
  for (const a of m.attendees) {
    const email = cleanEmail(a.email);
    const name = (a.name ?? "").trim().slice(0, 200) || email || "";
    if (!name) continue;
    const key = email ?? `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attendees.push({ name, email });
    if (attendees.length >= MAX_ATTENDEES) break;
  }
  const url = m.shareUrl && /^https:\/\//.test(m.shareUrl) && m.shareUrl.length <= 2000 ? m.shareUrl : null;
  const duration =
    m.durationSeconds !== null && Number.isFinite(m.durationSeconds) && m.durationSeconds >= 0 && m.durationSeconds <= 172_800
      ? Math.round(m.durationSeconds)
      : null;
  return {
    ...m,
    externalId: m.externalId.slice(0, 200),
    title: (m.title ?? "").trim().slice(0, MAX_TITLE) || "Untitled meeting",
    attendees,
    summary: m.summary ? m.summary.slice(0, MAX_SUMMARY) : null,
    transcript: m.transcript && m.transcript.length > 0 ? m.transcript.slice(0, MAX_SEGMENTS) : null,
    shareUrl: url,
    durationSeconds: duration,
  };
}
