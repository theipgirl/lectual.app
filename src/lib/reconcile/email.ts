import { resolveStage } from "@/lib/lawmatics/stage-map";
import type { EmailType } from "@/lib/intake/email-match";
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
export type StoredMail = { type: string | null; sensitive: boolean; at: string | null };

function time(at: string | null): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** The email source's reading of one lead from that lead's stored mail rows. */
export function emailSignalFor(mail: readonly StoredMail[], stages: readonly StageOpt[]): SourceSignal {
  const mapped = mail.filter((m) => !m.sensitive && m.type !== null && m.type in EMAIL_STAGE_TABLE);
  if (mapped.length === 0) {
    return { kind: "none", note: mail.length > 0 ? "mail found, but none of it names a stage" : undefined };
  }
  // The newest mapped email wins. Ties keep the first one read.
  const newest = mapped.reduce((best, m) => (time(m.at) > time(best.at) ? m : best));
  const entry = EMAIL_STAGE_TABLE[newest.type as EmailType]!;
  const wording = `${entry.label} email`;
  const resolved = resolveStage(entry.stageName, stages);
  if (!resolved.ok) return { kind: "unmapped", wording };
  return { kind: "stage", stageId: resolved.stage.id, stageName: resolved.stage.name, wording, date: newest.at };
}
