import { BAND_LABEL } from "@/lib/assessment-card/score";
import { TEMPERATURE_TEXT } from "@/lib/intake-forms/assessment";
import { boothAnswerPairs } from "@/lib/intake-forms/booth-results";
import { rereadAnswers } from "@/lib/intake-forms/reread-answers";
import { parseAnswers } from "@/lib/intake-forms/submission";

/**
 * The "Intake & assessment answers" card's items, as pure functions over rows
 * already read (`load-answers.ts`). Three kinds, merged newest first:
 * an intake submission, a booth scorecard, and a completed intake request.
 */

export type AnswerPair = { question: string; answer: string };

/** What an assessment scored, as stored. `gaps` is null when they could not be re-read ("Gaps unavailable"). */
export type ScoreSummary = {
  score: number | null;
  /** Display wording ("Partially protected"), or the stored value when it isn't a known band. */
  band: string | null;
  temperature: string | null;
  gaps: string[] | null;
};

export type AnswerItem =
  | {
      kind: "submission";
      id: string;
      at: string;
      startedAt: string;
      finishedAt: string | null;
      formName: string;
      formKind: "intake" | "assessment";
      pairs: AnswerPair[];
      summary: ScoreSummary | null;
    }
  | {
      kind: "booth";
      id: string;
      at: string;
      startedAt: string;
      finishedAt: string | null;
      eventCode: string;
      track: string | null;
      pairs: AnswerPair[];
      summary: ScoreSummary | null;
    }
  | { kind: "request"; id: string; at: string; startedAt: string; finishedAt: string | null; pairs: AnswerPair[] };

export type SubmissionAnswerRow = {
  id: string;
  form_id: string;
  mode: string;
  answers: unknown;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
};

export type FormRef = { id: string; name: string; kind: "intake" | "assessment" };

export type BoothAnswerRow = {
  id: string;
  event_code: string;
  track: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
  answers: unknown;
  gaps: string[] | null;
  created_at: string;
  completed_at: string | null;
};

export type RequestAnswerRow = { id: string; sent_at: string; completed_at: string | null; answers: unknown; status: string };

const bandWord = (band: string | null): string | null => (band === null ? null : ((BAND_LABEL as Record<string, string>)[band] ?? band));
const tempWord = (t: string | null): string | null => (t === null ? null : ((TEMPERATURE_TEXT as Record<string, string>)[t] ?? t));

/** "Score 72/100 (Partially protected)": the wording of the lead timeline's staff line, without the temperature or staff prompt. */
export function scoreLine(s: Pick<ScoreSummary, "score" | "band">): string | null {
  if (s.score === null) return null;
  return `Score ${s.score}/100${s.band ? ` (${s.band})` : ""}`;
}

export function submissionItem(row: SubmissionAnswerRow, form: FormRef | undefined): AnswerItem {
  const isAssessment = (form?.kind ?? (row.mode === "assessment" ? "assessment" : "intake")) === "assessment";
  const list = parseAnswers(row.answers);
  let summary: ScoreSummary | null = null;
  if (isAssessment && row.submitted_at) {
    const reread = rereadAnswers(list);
    // Shown only when the re-score agrees with the stored result (a card that changed since would not).
    const agrees = reread.ok && (row.score === null || reread.score.score === row.score) && (!row.temperature || reread.score.temperature === row.temperature);
    summary = {
      score: row.score,
      band: bandWord(row.band),
      temperature: tempWord(row.temperature),
      gaps: reread.ok && agrees ? reread.score.gaps : null,
    };
  }
  return {
    kind: "submission",
    id: row.id,
    at: row.submitted_at ?? row.started_at,
    startedAt: row.started_at,
    finishedAt: row.submitted_at,
    formName: form?.name ?? "Intake",
    formKind: isAssessment ? "assessment" : "intake",
    // An unfinished contact-first row has no answers: the list is empty, not an error.
    pairs: row.submitted_at ? list.map((a) => ({ question: a.question || "Question", answer: a.answer || "—" })) : [],
    summary,
  };
}

export function boothItem(row: BoothAnswerRow): AnswerItem {
  const finished = row.completed_at !== null;
  return {
    kind: "booth",
    id: row.id,
    at: row.completed_at ?? row.created_at,
    startedAt: row.created_at,
    finishedAt: row.completed_at,
    eventCode: row.event_code,
    track: row.track,
    pairs: finished ? boothAnswerPairs(row.answers, row.track) : [],
    summary: finished
      ? { score: row.score, band: bandWord(row.band), temperature: tempWord(row.temperature), gaps: Array.isArray(row.gaps) ? row.gaps : [] }
      : null,
  };
}

export function requestItem(row: RequestAnswerRow): AnswerItem | null {
  if (row.status !== "completed") return null;
  return {
    kind: "request",
    id: row.id,
    at: row.completed_at ?? row.sent_at,
    startedAt: row.sent_at,
    finishedAt: row.completed_at,
    pairs: parseAnswers(row.answers).map((a) => ({ question: a.question || "Question", answer: a.answer || "—" })),
  };
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Newest first by finished time, else started time; ties keep a stable order by id. */
export function mergeAnswerItems(items: readonly AnswerItem[]): AnswerItem[] {
  return [...items].sort((a, b) => time(b.at) - time(a.at) || a.id.localeCompare(b.id));
}
