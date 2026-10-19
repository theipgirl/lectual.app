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
