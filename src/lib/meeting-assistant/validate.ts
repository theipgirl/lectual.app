import { clampTranscript } from "./prompt";
import { matchRecord } from "./match";
import {
  LIMITS,
  type AssistantRow,
  type Confidence,
  type DropCounts,
  type MeetingAssistantInput,
  type MeetingProposal,
  type ProposalRecord,
  type ValidationResult,
} from "./types";

/**
 * Checks the model's answer against what it was given. Pure. The model's output is a claim, not a fact.
 *
 * EVIDENCE RULE (as in Consult details: a fact counts only when the model quotes words really in the source):
 * a proposal whose evidence quote is not found in the transcript (case, whitespace and punctuation ignored,
 * whole words) is DROPPED, not kept-and-flagged. A proposal with no checkable quote cannot be reviewed on a
 * call, and a later one-click accept must never act on an invented one. Drops are counted in `dropped`.
 *
 * Other rules: record id must be a given row (else "unmatched"; a kind that disagrees with the row is also
 * unmatched); no id at all tries `matchRecord` by name; ownerId must be a given member (else null, flagged);
 * dueDate must be a real calendar date that the evidence states in words or numbers (else null, flagged);
 * lengths are cut; one proposal per record (the highest confidence wins, ties keep the first) and per
 * unmatched next step; at most LIMITS.proposals kept.
 */

const MIN_EVIDENCE_CHARS = 12;

/** Words and numbers only, lower-cased, single-spaced, padded so a substring test matches whole words. */
function matchText(text: string): string {
  const t = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return t ? ` ${t} ` : "";
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIndex = (w: string): number => {
  const lw = w.toLowerCase();
  if (lw === "sept") return 8;
  return MONTHS.findIndex((m) => m === lw || (lw.length === 3 && m.startsWith(lw)));
};

/** A real YYYY-MM-DD, or null. */
export function realIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** True when `evidence` states `date` (YYYY-MM-DD): ISO, "Nov 20 (2026)", "20 November", or "11/20(/26)". */
export function evidenceStatesDate(evidence: string, date: string, meetingDate: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const meetingYear = Number(meetingDate.slice(0, 4)) || y;
  const yearOk = (yr: number | null) => (yr == null ? y === meetingYear || y === meetingYear + 1 : yr === y || (yr < 100 && yr === y % 100));
  if (evidence.includes(date)) return true;
  const e = evidence.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  const re1 = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/g; // Nov 20, 2026
  for (const x of e.matchAll(re1)) {
    if (monthIndex(x[1]) === m - 1 && Number(x[2]) === d && yearOk(x[3] ? Number(x[3]) : null)) return true;
  }
  const re2 = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/g; // 20 November 2026
  for (const x of e.matchAll(re2)) {
    if (monthIndex(x[2]) === m - 1 && Number(x[1]) === d && yearOk(x[3] ? Number(x[3]) : null)) return true;
  }
  const re3 = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g; // 11/20/26
  for (const x of e.matchAll(re3)) {
    if (Number(x[1]) === m && Number(x[2]) === d && yearOk(x[3] ? Number(x[3]) : null)) return true;
  }
  return false;
}

const str = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const flat = v.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function validateProposals(raw: unknown, input: MeetingAssistantInput): ValidationResult {
  const dropped: DropCounts = { no_evidence: 0, empty_step: 0, duplicate: 0, over_cap: 0, malformed: 0 };
  const list = (raw as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return { proposals: [], dropped: { ...dropped, malformed: 1 } };

  const haystack = matchText(clampTranscript(input.transcript));
  const rowById = new Map<string, AssistantRow>(input.rows.map((r) => [r.id, r]));
  const memberIds = new Set(input.members.map((m) => m.id));

  const kept = new Map<string, MeetingProposal>();
  const order: string[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const p = item as Record<string, unknown>;
    const flags: string[] = [];

    const evidenceRaw = str(p.evidence, LIMITS.evidence * 4);
    const needle = matchText(evidenceRaw);
    if (needle.trim().length < MIN_EVIDENCE_CHARS || !haystack.includes(needle)) {
      dropped.no_evidence++;
      continue;
    }
    const evidence = str(evidenceRaw, LIMITS.evidence);
    // A truncated quote is still a prefix of a real one, but re-check so the stored text is exactly verifiable.
    if (!haystack.includes(matchText(evidence.replace(/…$/, "")))) {
      dropped.no_evidence++;
      continue;
    }

    const nextStep = str(p.nextStep, LIMITS.nextStep);
    if (!nextStep) {
      dropped.empty_step++;
      continue;
    }

    let record: ProposalRecord = "unmatched";
    const rec = p.record as { kind?: unknown; id?: unknown } | string | null | undefined;
    const recId = rec && typeof rec === "object" && typeof rec.id === "string" ? rec.id : null;
    const recKind = rec && typeof rec === "object" ? rec.kind : null;
    const recordName = str(p.recordName, LIMITS.recordName) || null;
    if (recId) {
      const row = rowById.get(recId);
      if (row && (recKind === row.kind || recKind == null)) record = { kind: row.kind, id: row.id };
      else flags.push("The record named wasn't one of this week's rows.");
    } else if (recordName) {
      record = matchRecord(recordName, input.rows);
    }

    let ownerId: string | null = null;
    if (typeof p.ownerId === "string" && p.ownerId) {
      if (memberIds.has(p.ownerId)) ownerId = p.ownerId;
      else flags.push("The owner named isn't a member of this firm, so none is proposed.");
    }

    let dueDate: string | null = null;
    if (p.dueDate != null && p.dueDate !== "") {
      const real = realIsoDate(p.dueDate);
      if (real && evidenceStatesDate(evidence, real, input.meetingDate)) dueDate = real;
      else flags.push("The due date wasn't stated on the call, so none is proposed.");
    }

    const confidence: Confidence = p.confidence === "high" || p.confidence === "medium" || p.confidence === "low" ? p.confidence : "low";

    const proposal: MeetingProposal = { record, recordName: record === "unmatched" ? recordName : null, nextStep, dueDate, ownerId, note: str(p.note, LIMITS.note), evidence, confidence, flags };
    const key = record === "unmatched" ? `u:${nextStep.toLowerCase()}` : `${record.kind}:${record.id}`;
    const prior = kept.get(key);
    if (prior) {
      dropped.duplicate++;
      if (RANK[confidence] > RANK[prior.confidence]) kept.set(key, proposal);
      continue;
    }
    kept.set(key, proposal);
    order.push(key);
  }

  let proposals = order.map((k) => kept.get(k)!);
  if (proposals.length > LIMITS.proposals) {
    dropped.over_cap = proposals.length - LIMITS.proposals;
    proposals = proposals.slice(0, LIMITS.proposals);
  }
  return { proposals, dropped };
}
