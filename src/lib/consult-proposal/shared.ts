import { createHash } from "node:crypto";
import type { ConsultSource, ConsultTranscriptTurn } from "./types";

/**
 * Pure pieces shared by the runner, the approve gate, the cron and the
 * actions. No database and no `server-only`, so a test can import them
 * without an environment.
 */

/** `payload.source` of the timeline rows that mark a call as drafted (and name its queue item + proposal). */
export const CONSULT_PROPOSAL_SOURCE = "consult-proposal";

/** Whitespace-normalised, so re-pasting the same transcript with different line breaks is the same transcript. */
export function pasteHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

/** crm_meeting.transcript (jsonb) as speaker turns; anything unreadable is dropped. */
export function toTranscript(value: unknown): ConsultTranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as Record<string, unknown>).text === "string")
    .map((s) => ({
      speaker: typeof s.speaker === "string" && s.speaker ? s.speaker : "Speaker",
      text: s.text as string,
      ...(typeof s.at === "string" ? { at: s.at } : {}),
    }));
}

export function meetingSource(m: {
  id: string;
  title: string | null;
  started_at: string | null;
  summary: string | null;
  transcript: unknown;
}): Extract<ConsultSource, { kind: "meeting" }> {
  const turns = toTranscript(m.transcript);
  return {
    kind: "meeting",
    meetingId: m.id,
    title: m.title?.trim() || "Untitled meeting",
    startedAt: m.started_at,
    summary: m.summary?.trim() || null,
    transcript: turns.length > 0 ? turns : null,
  };
}

/**
 * The firm's name as it is signed: the org's display name with ONE trailing
 * parenthetical dropped ("RPB Law (dev)" -> "RPB Law"). When the name is empty,
 * the org slug humanised ("rpb-law" -> "Rpb Law"). Null when there is neither.
 */
export function firmSignatureName(name: string | null | undefined, slug: string | null | undefined): string | null {
  const clean = (v: string) => v.replace(/\s+/g, " ").trim();
  const fromName = clean((name ?? "").replace(/\s*\([^()]*\)\s*$/, ""));
  if (fromName) return fromName;
  const fromSlug = clean((slug ?? "").replace(/[-_]+/g, " ")).replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return fromSlug || null;
}

/**
 * The sign-off line of the proposal email: always "The <Firm> Team" (Rebecca's
 * rule: signed by the firm team, never a personal block, never the org's
 * email_signature). Null when the firm has no usable name at all: the caller
 * must refuse to draft rather than sign it "The Team".
 */
export function firmTeamSignOff(name: string | null | undefined, slug: string | null | undefined): string | null {
  const firm = firmSignatureName(name, slug);
  if (!firm) return null;
  const bare = firm.replace(/^the\s+/i, "").replace(/\s+team$/i, "").trim() || firm;
  return `The ${bare} Team`;
}
