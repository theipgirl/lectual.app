import { resolveStage } from "@/lib/lawmatics/stage-map";
import type { EmailType } from "@/lib/intake/email-match";
import { SIGNAL_LABEL } from "@/lib/stage-keeper/signals";
import { currentAgentMoves, evidenceOwnDate, pendingStageSuggestions, type ActivityRow } from "@/lib/stage-keeper/moves";
import type { SourceSignal, StageOpt } from "./types";

/**
 * What stored mail implies about a lead's stage.
 *
 * The mailbox sync already classified each message it matched (`classifyEmail`) and stored the
 * result on the lead's timeline row. This reads those stored rows; it does not read mail.
 *
 * Only the types that name a position in the pipeline have an entry. Follow-up, welcome,
 * questionnaire, opinion letter and "other" imply nothing, and a thread flagged sensitive
 * contributes nothing at all. The value is a stage NAME resolved against the firm's own stages
 * with `resolveStage`, so a firm that has no such stage gets "unmapped", never a guess.
 */
export const EMAIL_STAGE_TABLE: Partial<Record<EmailType, { label: string; stageName: string }>> = {
  "strategy-session-link": { label: "Strategy session link", stageName: "Potential New Client" },
  "discovery-call": { label: "Discovery call", stageName: "Consultation Scheduled" },
  "post-consult": { label: "Post-consultation", stageName: "Post Consultation Email Sent" },
  "loe-invoice": { label: "LOE and invoice", stageName: "LOE & Invoice Sent" },
};

/** One stored mail row, as read from the timeline. */
export type StoredMail = {
  type: string | null;
  sensitive: boolean;
  at: string | null;
  /** From the timeline row's own type (`email_sent` / `email_received`); absent on a row of unknown direction. */
  direction?: "sent" | "received";
  /** The subject the sync stored. Classified in memory for the screen; never written anywhere. */
  subject?: string | null;
};

function time(at: string | null): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * What the Stage Keeper did for a lead, read back from its timeline rows: the move it made (if it
 * is still the lead's latest stage change) and the suggestions still waiting for a person. Both
 * name a stage by id, so they are compared with the firm's own stages, never by name.
 */
export type AgentEvidence = { stageId: string; wording: string; date: string | null };

/** The Stage Keeper's rows for ONE lead (any order) as evidence for the email / calendar source. */
export function agentEvidenceFor(rows: readonly ActivityRow[]): AgentEvidence[] {
  const out: AgentEvidence[] = [];
  const label = (signal: keyof typeof SIGNAL_LABEL | null) => (signal ? SIGNAL_LABEL[signal] : "stage change");
  for (const move of currentAgentMoves(rows, new Date(), Number.POSITIVE_INFINITY).values()) {
    if (!move.toStageId) continue;
    const evidenceDate = evidenceOwnDate(move.evidence);
    out.push({ stageId: move.toStageId, wording: `Stage Keeper: ${label(move.signal)}`, date: evidenceDate ?? move.at });
  }
  for (const s of pendingStageSuggestions(rows)) {
    if (!s.toStageId) continue;
    const evidenceDate = evidenceOwnDate(s.evidence);
    out.push({ stageId: s.toStageId, wording: `Stage Keeper suggests: ${label(s.signal)}`, date: evidenceDate ?? s.at });
  }
  return out;
}

/**
 * The email / calendar source's reading of one lead: its stored mail rows and what the Stage
 * Keeper did from mail and calendar consults. The newest mapped evidence wins; a sensitive thread
 * contributes nothing; a stage id that is not one of the firm's stages is unmapped, never a vote.
 */
export function emailSignalFor(mail: readonly StoredMail[], stages: readonly StageOpt[], agent: readonly AgentEvidence[] = []): SourceSignal {
  const mapped = mail.filter((m) => !m.sensitive && m.type !== null && m.type in EMAIL_STAGE_TABLE);
  if (mapped.length === 0 && agent.length === 0) {
    return { kind: "none", note: mail.length > 0 ? "mail found, but none of it names a stage" : undefined };
  }
  // The newest mapped email wins. Ties keep the first one read.
  const newestMail = mapped.length > 0 ? mapped.reduce((best, m) => (time(m.at) > time(best.at) ? m : best)) : null;
  const newestAgent = agent.length > 0 ? agent.reduce((best, a) => (time(a.date) > time(best.date) ? a : best)) : null;

  if (newestAgent && (!newestMail || time(newestAgent.date) > time(newestMail.at))) {
    const known = stages.find((s) => s.id === newestAgent.stageId);
    if (!known) return { kind: "unmapped", wording: newestAgent.wording };
    return { kind: "stage", stageId: known.id, stageName: known.name, wording: newestAgent.wording, date: newestAgent.date };
  }
  const entry = EMAIL_STAGE_TABLE[newestMail!.type as EmailType]!;
  const wording = `${entry.label} email`;
  const resolved = resolveStage(entry.stageName, stages);
  if (!resolved.ok) return { kind: "unmapped", wording };
  return { kind: "stage", stageId: resolved.stage.id, stageName: resolved.stage.name, wording, date: newestMail!.at };
}
