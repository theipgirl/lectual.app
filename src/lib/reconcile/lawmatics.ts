import { normalizeStageName, resolveStage } from "@/lib/lawmatics/stage-map";
import type { LawmaticsSourceRecord } from "@/lib/lawmatics/normalize";
import { isPlaceholderEmail } from "@/lib/intake/email-match";
import type { SourceSignal, StageOpt } from "./types";

/**
 * What the firm's Lawmatics says about a lead's stage (read-only; see sources.ts).
 *
 * A lead finds its Lawmatics record by the Lawmatics id stored on it, else by ONE unambiguous email.
 * Two records sharing an email, or a placeholder address, never match. "Hired" and "Hired Client" are
 * the two names `stage-map.ts` deliberately leaves unmapped; here they mean the person is a client,
 * which is a `needs_matter` signal and never a stage. Any other name that does not map is shown as
 * unmapped and does not vote: "Discovery Call No Show" is not a client.
 */

export type LawmaticsIndex = {
  byId: Map<string, LawmaticsSourceRecord>;
  byEmail: Map<string, LawmaticsSourceRecord[]>;
};

export function indexLawmatics(records: readonly LawmaticsSourceRecord[]): LawmaticsIndex {
  const byId = new Map<string, LawmaticsSourceRecord>();
  const byEmail = new Map<string, LawmaticsSourceRecord[]>();
  for (const record of records) {
    byId.set(String(record.lawmaticsId), record);
    const email = record.email?.trim().toLowerCase();
    if (email && !isPlaceholderEmail(email)) {
      const list = byEmail.get(email);
      if (list) list.push(record);
      else byEmail.set(email, [record]);
    }
  }
  return { byId, byEmail };
}

const HIRED = new Set(["hired", "hired client"]);

export function isHiredStage(name: string): boolean {
  return HIRED.has(normalizeStageName(name));
}

export type LawmaticsMatch =
  | { kind: "record"; record: LawmaticsSourceRecord }
  | { kind: "none"; note?: string };

export function matchLawmatics(
  lead: { lawmaticsId: string | null; email: string | null },
  index: LawmaticsIndex,
): LawmaticsMatch {
  if (lead.lawmaticsId) {
    const byId = index.byId.get(String(lead.lawmaticsId));
    if (byId) return { kind: "record", record: byId };
  }
  const email = lead.email?.trim().toLowerCase();
  if (!email || isPlaceholderEmail(email)) return { kind: "none" };
  const candidates = index.byEmail.get(email) ?? [];
  if (candidates.length === 1) return { kind: "record", record: candidates[0] };
  if (candidates.length > 1) return { kind: "none", note: `${candidates.length} Lawmatics records share this email` };
  return { kind: "none" };
}

export function lawmaticsSignalFor(
  lead: { lawmaticsId: string | null; email: string | null },
  index: LawmaticsIndex,
  stages: readonly StageOpt[],
): SourceSignal {
  const match = matchLawmatics(lead, index);
  if (match.kind === "none") return { kind: "none", note: match.note };
  const name = match.record.stageName?.trim();
  if (!name) return { kind: "none", note: "the Lawmatics record has no stage" };
  if (isHiredStage(name)) return { kind: "needs_matter", wording: name };
  const resolved = resolveStage(name, stages);
  if (!resolved.ok) return { kind: "unmapped", wording: name };
  return { kind: "stage", stageId: resolved.stage.id, stageName: resolved.stage.name, wording: name, date: null };
}
