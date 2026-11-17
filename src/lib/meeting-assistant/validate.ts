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
 * whole words) is DROPPED, not kept-and-flagged: a proposal with no checkable quote can't be reviewed on a
 * call, and a later one-click accept must never act on an invented one. A quote over 300 characters or too
 * short (under 4 words and under 25 characters) is dropped too, never truncated. Drops are counted.
 * The quote is located in the transcript (the first occurrence); everything below uses that SPAN of the
 * original text, never the model's own string.
 *
 * TIES TO THE QUOTE. The record is kept only if its client, mark or matter number appears in the span or
 * within ~300 characters either side; the owner only if their first or full name does. Otherwise the record
 * is "unmatched" / the owner null, with a flag. So a valid id on a generic quote ("okay, next one") keeps nothing.
 *
 * DATES come from the span's own text. A date counts when the span states it (ISO, "Nov 20 (2026)", "20 November",
 * "11/20(/26)"); with no year it is the first such date on or after the meeting date; a past date is refused;
 * "May"/"Mar" count only when capitalised and followed by a day with an ordinal, a separator or a year; and a
 * date with "not / don't / won't / isn't / no longer" within five words before it is refused. An invalid meeting
 * date means no dates at all.
 *
 * Also: unknown record ids are "unmatched"; ownerId must be a given member; lengths are cut; one proposal per
 * record (highest confidence wins, ties keep the first) and per unmatched name+step; at most 50 kept.
 */

const MIN_EVIDENCE_WORDS = 4;
const MIN_EVIDENCE_CHARS = 25;
const WINDOW = 300;

type Mapped = { text: string; start: number[]; end: number[] };

/** Words and numbers only, lower-cased, single-spaced. `start`/`end` map each output char back to the source. */
function normalizeMapped(src: string): Mapped {
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  let space = false;
  let i = 0;
  for (const ch of src) {
    const len = ch.length;
    for (const c of ch.normalize("NFKC").toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(c)) {
        if (space && text) {
          text += " ";
          start.push(i);
          end.push(i);
        }
        space = false;
        for (let k = 0; k < c.length; k++) {
          text += c[k];
          start.push(i);
          end.push(i + len);
        }
      } else {
        space = true;
      }
    }
    i += len;
  }
  return { text, start, end };
}
const norm = (s: string): string => normalizeMapped(s).text;
const hasWords = (hay: string, needle: string): boolean => needle !== "" && ` ${hay} `.includes(` ${needle} `);

/** The [start, end) span in the ORIGINAL text of the first whole-word occurrence of `needle`, or null. */
function findSpan(hay: Mapped, needle: string): [number, number] | null {
  let from = 0;
  while (needle) {
    const idx = hay.text.indexOf(needle, from);
    if (idx < 0) return null;
    const after = idx + needle.length;
    if ((idx === 0 || hay.text[idx - 1] === " ") && (after === hay.text.length || hay.text[after] === " ")) {
      return [hay.start[idx], hay.end[after - 1]];
    }
    from = idx + 1;
  }
  return null;
}

/** A real YYYY-MM-DD, or null. */
export function realIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIndex = (w: string): number => {
  const lw = w.toLowerCase();
  if (lw === "sept") return 8;
  return MONTHS.findIndex((m) => m === lw || (lw.length === 3 && m.startsWith(lw)));
};
const pad = (n: number) => String(n).padStart(2, "0");

/** No year stated: the first real date with this month and day on or after the meeting date. */
function firstOnOrAfter(m: number, d: number, meetingDate: string): string | null {
  const y0 = Number(meetingDate.slice(0, 4));
  for (let y = y0; y <= y0 + 4; y++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    if (realIsoDate(iso) && iso >= meetingDate) return iso;
  }
  return null;
}

type Mention = { index: number; date: string };

/** Every date the text states, with where, resolved as the rules above say. */
export function statedDates(text: string, meetingDate: string): Mention[] {
  if (!realIsoDate(meetingDate)) return [];
  const out: Mention[] = [];
  const t = text;
  const resolve = (m: number, d: number, yr: number | null): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return yr == null ? firstOnOrAfter(m, d, meetingDate) : realIsoDate(`${yr}-${pad(m)}-${pad(d)}`);
  };
  /** May / Mar are ordinary words: capitalised, and an ordinal, a year or a separator after the day. */
  const weakOk = (word: string, mi: number, ordinal: boolean, year: boolean, after: string): boolean => {
    if (mi !== 4 && !(mi === 2 && word.length === 3)) return true;
    if (!/^[A-Z]/.test(word)) return false;
    return ordinal || year || /^(?:[,.;:)!?]|$)/.test(after);
  };
  const push = (index: number, date: string | null) => {
    if (date) out.push({ index, date });
  };

  for (const x of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(x.index!, realIsoDate(x[0]));

  const re1 = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/g; // Nov 20, 2026
  for (const x of t.matchAll(re1)) {
    const mi = monthIndex(x[1]);
    if (mi < 0) continue;
    if (!weakOk(x[1], mi, !!x[3], !!x[4], t.slice(x.index! + x[0].length))) continue;
    push(x.index!, resolve(mi + 1, Number(x[2]), x[4] ? Number(x[4]) : null));
  }
  const re2 = /\b(\d{1,2})(st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?(?:,?\s+(\d{4})\b)?/g; // 20 November 2026
  for (const x of t.matchAll(re2)) {
    const mi = monthIndex(x[3]);
    if (mi < 0) continue;
    if (!weakOk(x[3], mi, !!x[2], !!x[4], t.slice(x.index! + x[0].length))) continue;
    push(x.index!, resolve(mi + 1, Number(x[1]), x[4] ? Number(x[4]) : null));
  }
  for (const x of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g)) {
    const yr = x[3] ? (x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3])) : null;
    push(x.index!, resolve(Number(x[1]), Number(x[2]), yr));
  }
  return out;
}

const NEGATION = /\b(?:not|don't|won't|isn't|no longer)\b/;
/** "not / don't / won't / isn't / no longer" within five words before `index`. */
function negatedBefore(text: string, index: number): boolean {
  const words = text.slice(0, index).replace(/[’‘]/g, "'").toLowerCase().match(/[\p{L}']+/gu) ?? [];
  return NEGATION.test(words.slice(-5).join(" "));
}

/** True when the SOURCE text states `date` (not negated, not in the past). */
export function evidenceStatesDate(sourceSpan: string, date: string, meetingDate: string): boolean {
  if (!realIsoDate(meetingDate) || !realIsoDate(date) || date < meetingDate) return false;
  return statedDates(sourceSpan, meetingDate).some((m) => m.date === date && !negatedBefore(sourceSpan, m.index));
}

const str = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const flat = v.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function validateProposals(raw: unknown, input: MeetingAssistantInput): ValidationResult {
  const dropped: DropCounts = { no_evidence: 0, evidence_too_long: 0, empty_step: 0, duplicate: 0, over_cap: 0, malformed: 0 };
  const list = (raw as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return { proposals: [], dropped: { ...dropped, malformed: 1 } };

  const transcript = clampTranscript(input.transcript);
  const hay = normalizeMapped(transcript);
  const rows = input.rows.slice(0, LIMITS.rows); // only rows the model was shown
  const rowById = new Map<string, AssistantRow>(rows.map((r) => [r.id, r]));
  const memberIds = new Set(input.members.map((m) => m.id));
  const memberById = new Map(input.members.map((m) => [m.id, m]));

  const kept = new Map<string, MeetingProposal>();
  const order: string[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") {
      dropped.malformed++;
      continue;
    }
    const p = item as Record<string, unknown>;
    const flags: string[] = [];

    const evidence = typeof p.evidence === "string" ? p.evidence.replace(/\s+/g, " ").trim() : "";
    if (evidence.length > LIMITS.evidence) {
      dropped.evidence_too_long++;
      continue;
    }
    const needle = norm(evidence);
    const words = needle ? needle.split(" ").length : 0;
    if (words < MIN_EVIDENCE_WORDS && needle.length < MIN_EVIDENCE_CHARS) {
      dropped.no_evidence++;
      continue;
    }
    const span = findSpan(hay, needle);
    if (!span) {
      dropped.no_evidence++;
      continue;
    }
    const spanText = transcript.slice(span[0], span[1]);
    const windowNorm = norm(transcript.slice(Math.max(0, span[0] - WINDOW), Math.min(transcript.length, span[1] + WINDOW)));

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
      record = matchRecord(recordName, rows);
    }
    if (record !== "unmatched") {
      const row = rowById.get(record.id)!;
      const terms = [row.client, row.mark, row.matterNumber].map((t) => norm(t ?? "")).filter(Boolean);
      if (!terms.some((t) => hasWords(windowNorm, t))) {
        record = "unmatched";
        flags.push("That part of the call doesn't name this record, so none is proposed.");
      }
    }

    let ownerId: string | null = null;
    if (typeof p.ownerId === "string" && p.ownerId) {
      if (!memberIds.has(p.ownerId)) {
        flags.push("The owner named isn't a member of this firm, so none is proposed.");
      } else {
        const name = norm(memberById.get(p.ownerId)!.displayName);
        const first = name.split(" ")[0];
        if (hasWords(windowNorm, name) || hasWords(windowNorm, first)) ownerId = p.ownerId;
        else flags.push("That part of the call doesn't name this person, so no owner is proposed.");
      }
    }

    let dueDate: string | null = null;
    if (p.dueDate != null && p.dueDate !== "") {
      const real = realIsoDate(p.dueDate);
      if (real && evidenceStatesDate(spanText, real, input.meetingDate)) dueDate = real;
      else flags.push("The due date wasn't stated on the call, so none is proposed.");
    }

    const confidence: Confidence = p.confidence === "high" || p.confidence === "medium" || p.confidence === "low" ? p.confidence : "low";

    const proposal: MeetingProposal = { record, recordName: record === "unmatched" ? recordName : null, nextStep, dueDate, ownerId, note: str(p.note, LIMITS.note), evidence, confidence, flags };
    const key = record === "unmatched" ? `u:${(recordName ?? "").toLowerCase()}|${nextStep.toLowerCase()}` : `${record.kind}:${record.id}`;
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
