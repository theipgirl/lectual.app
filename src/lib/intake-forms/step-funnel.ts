import { medianOf, percent } from "./performance";
import { parseAnswers } from "./submission";

/**
 * Drop-off by question (Sprint 10), as pure functions over rows already read
 * (the reads, with their three states, are in `load-steps.ts`). One
 * aggregation feeds both tabs, so Results and Performance cannot disagree.
 *
 * Inputs are the `step` events (lectual 0096: one per person and question
 * reached), the people, and the form's questions in the order they are asked.
 *
 *   reached   distinct people with a step event for the question;
 *   answered  of those, with a non-blank answer for it, read from the finished
 *             answers or, for someone who didn't finish, the saved progress;
 *   went on   of those, who reached a later question, or who finished (for
 *             their last one);
 *   drop-off  reached minus went on, with its percentage ("—" when nothing
 *             was reached).
 *
 * Time on a step is the gap from this step's event to the person's next
 * step event, and for their last question the gap to `submitted_at`. A person
 * who left (no later event, not finished) contributes nothing to that step,
 * and negative or unparseable gaps are ignored.
 */

export type StepEventRow = {
  submission_id: string | null;
  question_id: string | null;
  step_index: number | null;
  occurred_at: string;
};

export type StepPerson = {
  id: string;
  started_at: string;
  submitted_at: string | null;
  answers?: unknown;
  /** lectual 0096: answers so far for someone who hasn't finished. */
  progress?: unknown;
};

export type StepQuestionRef = { id: string; text: string };

export type StepRow = {
  key: string;
  question: string;
  /** False for a question the form no longer asks, reported under its stored text. */
  inForm: boolean;
  reached: number;
  answered: number;
  wentOn: number;
  dropOff: number;
  /** "12.5%", or "—" when nobody reached it. */
  dropOffPct: string;
  /** Milliseconds, or null ("—") when no gap remains. */
  medianMs: number | null;
};

export type StepFunnel = {
  rows: StepRow[];
  /** People with at least one step event. */
  people: number;
  /** True when the form has any step event in what was read. */
  recorded: boolean;
};

const time = (iso: string) => Date.parse(iso);

type PersonSteps = { person: StepPerson; steps: { question: string; index: number; at: string }[] };

/** Each person's step events, one per question (the earliest wins), in the order they were reached. */
function groupSteps(people: readonly StepPerson[], events: readonly StepEventRow[]): PersonSteps[] {
  const byId = new Map(people.map((p) => [p.id, p] as const));
  const steps = new Map<string, Map<string, { question: string; index: number; at: string }>>();
  for (const e of events) {
    if (!e.submission_id || !e.question_id || !byId.has(e.submission_id)) continue;
    const index = typeof e.step_index === "number" && Number.isFinite(e.step_index) ? e.step_index : null;
    if (index === null) continue;
    let mine = steps.get(e.submission_id);
    if (!mine) steps.set(e.submission_id, (mine = new Map()));
    const have = mine.get(e.question_id);
    if (!have || time(e.occurred_at) < time(have.at)) mine.set(e.question_id, { question: e.question_id, index, at: e.occurred_at });
  }
  return [...steps].map(([id, m]) => ({
    person: byId.get(id) as StepPerson,
    steps: [...m.values()].sort((a, b) => a.index - b.index || time(a.at) - time(b.at)),
  }));
}

function answeredText(p: StepPerson, questionId: string): string {
  if (p.submitted_at) return parseAnswers(p.answers).find((a) => a.id === questionId)?.answer.trim() ?? "";
  const prog = p.progress;
  if (typeof prog === "object" && prog !== null && !Array.isArray(prog)) {
    const v = (prog as Record<string, unknown>)[questionId];
    return typeof v === "string" ? v.trim() : "";
  }
  return "";
}

/** The text a removed question was last stored under, from finished answers. */
function storedText(people: readonly StepPerson[], questionId: string): string | null {
  const newest = [...people].filter((p) => p.submitted_at).sort((a, b) => time(b.submitted_at as string) - time(a.submitted_at as string));
  for (const p of newest) {
    const hit = parseAnswers(p.answers).find((a) => a.id === questionId && a.question);
    if (hit) return hit.question;
  }
  return null;
}

export function stepFunnel(args: {
  /** The form's questions in the order they are asked (an assessment: the card's, then the firm's own). */
  questions: readonly StepQuestionRef[];
  people: readonly StepPerson[];
  events: readonly StepEventRow[];
}): StepFunnel {
  const grouped = groupSteps(args.people, args.events);
  const tally = new Map<string, { reached: number; answered: number; wentOn: number; gaps: number[]; indexSum: number }>();
  const slot = (q: string) => {
    let t = tally.get(q);
    if (!t) tally.set(q, (t = { reached: 0, answered: 0, wentOn: 0, gaps: [], indexSum: 0 }));
    return t;
  };

  for (const { person, steps } of grouped) {
    steps.forEach((s, i) => {
      const t = slot(s.question);
      t.reached++;
      t.indexSum += s.index;
      if (answeredText(person, s.question)) t.answered++;
      const next = steps[i + 1];
      const finishedHere = !next && person.submitted_at !== null;
      if (next || finishedHere) t.wentOn++;
      // The gap to the next step, or to finishing for the last one; someone who left has no gap.
      const end = next ? next.at : person.submitted_at;
      if (end) {
        const gap = time(end) - time(s.at);
        if (Number.isFinite(gap) && gap >= 0) t.gaps.push(gap);
      }
    });
  }

  const known = new Set(args.questions.map((q) => q.id));
  const removed = [...tally.keys()]
    .filter((id) => !known.has(id))
    .sort((a, b) => (tally.get(a)!.indexSum / tally.get(a)!.reached) - (tally.get(b)!.indexSum / tally.get(b)!.reached) || a.localeCompare(b));
  const order: { id: string; text: string; inForm: boolean }[] = [
    ...args.questions.map((q) => ({ id: q.id, text: q.text, inForm: true })),
    ...removed.map((id) => ({ id, text: storedText(args.people, id) ?? "A question since removed", inForm: false })),
  ];

  const rows: StepRow[] = order.map((q) => {
    const t = tally.get(q.id) ?? { reached: 0, answered: 0, wentOn: 0, gaps: [] as number[], indexSum: 0 };
    return {
      key: q.id,
      question: q.text,
      inForm: q.inForm,
      reached: t.reached,
      answered: t.answered,
      wentOn: t.wentOn,
      dropOff: t.reached - t.wentOn,
      dropOffPct: percent(t.reached - t.wentOn, t.reached),
      medianMs: medianOf(t.gaps),
    };
  });
  return { rows, people: grouped.length, recorded: args.events.some((e) => e.submission_id && e.question_id) };
}

// ── where an unfinished person stopped ───────────────────────────────────────

export type StoppedAt =
  | { kind: "finished" }
  /** `n` counts from 1: the step index of the last question they reached, plus one. */
  | { kind: "at"; n: number }
  | { kind: "before_first" }
  | { kind: "not_recorded" };

/**
 * Where one person stopped. A finished person has no reading. Otherwise the
 * last question they reached ("Stopped at Q3"). With no step events the rule is
 * (deviation 7): a form with no step events at all, or a person who started
 * before the form's earliest one, predates step recording and reads "not
 * recorded"; anyone later reached no question, "Stopped before Q1".
 */
export function stoppedAt(
  person: Pick<StepPerson, "id" | "started_at" | "submitted_at">,
  events: readonly StepEventRow[],
  earliestStepAt: string | null,
): StoppedAt {
  if (person.submitted_at) return { kind: "finished" };
  let last = -1;
  for (const e of events) {
    if (e.submission_id === person.id && typeof e.step_index === "number" && e.step_index > last) last = e.step_index;
  }
  if (last >= 0) return { kind: "at", n: last + 1 };
  if (!earliestStepAt || !(time(person.started_at) >= time(earliestStepAt))) return { kind: "not_recorded" };
  return { kind: "before_first" };
}

/** The words for a reading; null for a finished person. */
export function stoppedAtLabel(s: StoppedAt): string | null {
  switch (s.kind) {
    case "finished":
      return null;
    case "at":
      return `Stopped at Q${s.n}`;
    case "before_first":
      return "Stopped before Q1";
    case "not_recorded":
      return "not recorded";
  }
}
