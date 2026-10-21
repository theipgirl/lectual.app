import { describe, expect, it } from "vitest";
import { stepFunnel, stoppedAt, stoppedAtLabel, type StepEventRow, type StepPerson } from "@/lib/intake-forms/step-funnel";
import { buildFunnel } from "@/lib/intake-forms/performance";

/**
 * Sprint 10 F21 to F23 and D5: drop-off by question, median time per step and
 * the stopped-at reading, from ten people through a four-question form.
 */

const BASE = Date.UTC(2026, 9, 21, 12, 0, 0);
const at = (sec: number) => new Date(BASE + sec * 1000).toISOString();
const QUESTIONS = [
  { id: "q1", text: "What name do you want to protect?" },
  { id: "q2", text: "Have you used it publicly?" },
  { id: "q3", text: "Which goods or services?" },
  { id: "q4", text: "When do you hope to file? (optional)" },
];
const answers = (...ids: string[]) => ids.map((id) => ({ id, question: QUESTIONS.find((q) => q.id === id)?.text ?? id, answer: `answer ${id}` }));

type Plan = { id: string; steps: [string, number][]; done?: number; answers?: string[]; progress?: string[]; startedAt?: number };

/** One person's events and row from a plan: steps are [question, seconds], `done` is when they finished. */
function build(plans: Plan[]) {
  const people: StepPerson[] = [];
  const events: StepEventRow[] = [];
  for (const p of plans) {
    people.push({
      id: p.id,
      started_at: at(p.startedAt ?? -5),
      submitted_at: p.done === undefined ? null : at(p.done),
      answers: p.done === undefined ? [] : answers(...(p.answers ?? [])),
      progress: p.done === undefined ? Object.fromEntries((p.progress ?? []).map((id) => [id, `answer ${id}`])) : null,
    });
    for (const [q, sec] of p.steps) events.push({ submission_id: p.id, question_id: q, step_index: QUESTIONS.findIndex((x) => x.id === q), occurred_at: at(sec) });
  }
  return { people, events };
}

const TEN: Plan[] = [
  { id: "P1", steps: [["q1", 0], ["q2", 10], ["q3", 30], ["q4", 40]], done: 100, answers: ["q1", "q2", "q3", "q4"] },
  // Finished, and skipped the optional last question: reached it, gave no answer.
  { id: "P2", steps: [["q1", 0], ["q2", 20], ["q3", 50], ["q4", 60]], done: 70, answers: ["q1", "q2", "q3"] },
  { id: "P3", steps: [["q1", 0]], progress: ["q1"] },
  { id: "P4", steps: [["q1", 0], ["q2", 30]], progress: ["q1"] },
  { id: "P5", steps: [["q1", 0], ["q2", 20], ["q3", 50]], progress: ["q1", "q2"] },
  { id: "P6", steps: [["q1", 0], ["q2", 10], ["q3", 20], ["q4", 30]], progress: ["q1", "q2", "q3"] },
  { id: "P7", steps: [["q1", 0], ["q2", 40], ["q3", 50], ["q4", 80]], done: 90, answers: ["q1", "q2", "q3", "q4"] },
  { id: "P8", steps: [["q1", 0], ["q2", 10], ["q3", 20], ["q4", 30]], done: 500, answers: ["q1", "q2", "q3", "q4"] },
  // Never reached the first question.
  { id: "P9", steps: [], startedAt: 1 },
  { id: "P10", steps: [], startedAt: 2 },
];

describe("drop-off by question (F21)", () => {
  const funnel = stepFunnel({ questions: QUESTIONS, ...build(TEN) });
  const row = (id: string) => funnel.rows.find((r) => r.key === id)!;

  it("counts reached, answered, went on and drop-off for each question, in the order they are asked", () => {
    expect(funnel.rows.map((r) => r.key)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(funnel.rows.map((r) => [r.reached, r.answered, r.wentOn, r.dropOff])).toEqual([
      [8, 8, 7, 1],
      [7, 6, 6, 1],
      [6, 5, 5, 1],
      [5, 3, 4, 1],
    ]);
  });

  it("gives the percentages", () => {
    expect(funnel.rows.map((r) => r.dropOffPct)).toEqual(["12.5%", "14.3%", "16.7%", "20.0%"]);
  });

  it("makes the last question's went-on the number who finished", () => {
    expect(row("q4").wentOn).toBe(TEN.filter((p) => p.done !== undefined).length);
  });

  it("counts the two who never reached Q1 nowhere, and says how many reached at least one", () => {
    expect(funnel.people).toBe(8);
    expect(funnel.recorded).toBe(true);
  });

  it("answered counts a finished person's answer and an unfinished person's saved progress, and a skipped optional as unanswered", () => {
    // P2 reached Q4 and skipped it; P6 reached Q4 and had typed nothing yet.
    expect(row("q4").reached - row("q4").answered).toBe(2);
    expect(row("q2").reached - row("q2").answered).toBe(1);
  });

  it("returns '—' where nothing was reached, and zeros without dividing", () => {
    const empty = stepFunnel({ questions: QUESTIONS, ...build([{ id: "A", steps: [["q1", 0]], progress: [] }]) });
    expect(empty.rows[1]).toMatchObject({ reached: 0, answered: 0, wentOn: 0, dropOff: 0, dropOffPct: "—", medianMs: null });
    expect(empty.rows[0]).toMatchObject({ reached: 1, dropOff: 1, dropOffPct: "100.0%" });
    const none = stepFunnel({ questions: QUESTIONS, people: [], events: [] });
    expect(none.rows.every((r) => r.reached === 0 && r.dropOffPct === "—")).toBe(true);
    expect(none.recorded).toBe(false);
  });

  it("reports a question the form no longer asks under its stored text, after the live ones", () => {
    const { people, events } = build(TEN);
    people[0].answers = [...answers("q1", "q2", "q3", "q4"), { id: "q-old", question: "Is this a joint filing?", answer: "No" }];
    events.push({ submission_id: "P1", question_id: "q-old", step_index: 4, occurred_at: at(45) });
    const f = stepFunnel({ questions: QUESTIONS, people, events });
    expect(f.rows.map((r) => r.key)).toEqual(["q1", "q2", "q3", "q4", "q-old"]);
    expect(f.rows[4]).toMatchObject({ question: "Is this a joint filing?", inForm: false, reached: 1, answered: 1 });
    expect(f.rows.slice(0, 4).every((r) => r.inForm)).toBe(true);
    // A removed question nobody ever answered still gets a readable name.
    const lone = stepFunnel({ questions: QUESTIONS, people: [{ id: "Z", started_at: at(0), submitted_at: null }], events: [{ submission_id: "Z", question_id: "q-gone", step_index: 2, occurred_at: at(1) }] });
    expect(lone.rows.at(-1)).toMatchObject({ key: "q-gone", question: "A question since removed", inForm: false });
  });

  it("ignores events for people outside the list it was given (the range), and events with no question or index", () => {
    const { people, events } = build(TEN);
    const out = stepFunnel({
      questions: QUESTIONS,
      people: people.filter((p) => p.id !== "P1"),
      events: [...events, { submission_id: "P1", question_id: "q1", step_index: 0, occurred_at: at(0) }, { submission_id: "P3", question_id: null, step_index: 0, occurred_at: at(1) }, { submission_id: "P3", question_id: "q2", step_index: null, occurred_at: at(1) }],
    });
    expect(out.rows[0].reached).toBe(7);
    expect(out.rows[1].reached).toBe(6);
  });

  it("counts a person once per question however many events were written", () => {
    const { people, events } = build(TEN);
    const doubled = [...events, ...events.filter((e) => e.submission_id === "P1")];
    expect(stepFunnel({ questions: QUESTIONS, people, events: doubled }).rows.map((r) => r.reached)).toEqual([8, 7, 6, 5]);
  });

  it("follows the people's own order for 'went on' when a branch skips a question", () => {
    // Q3 is only asked of some people: P1 goes from Q2 straight to Q4 and finishes.
    const { people, events } = build([{ id: "S", steps: [["q1", 0], ["q2", 5], ["q4", 9]], done: 20, answers: ["q1", "q2", "q4"] }]);
    const f = stepFunnel({ questions: QUESTIONS, people, events });
    expect(f.rows.map((r) => [r.reached, r.wentOn])).toEqual([[1, 1], [1, 1], [0, 0], [1, 1]]);
  });
});

describe("median time on a step (F22)", () => {
  const funnel = stepFunnel({ questions: QUESTIONS, ...build(TEN) });
  const medians = funnel.rows.map((r) => r.medianMs);

  it("is right for an odd and an even number of gaps", () => {
    // Q1: 10,10,10,20,20,30,40 -> 20 s. Q2: 10,10,10,20,30,30 -> 15 s. Q3: 10,10,10,10,30 -> 10 s. Q4: 10,10,60,470 -> 35 s.
    expect(medians).toEqual([20_000, 15_000, 10_000, 35_000]);
  });

  it("uses submitted_at for the last step", () => {
    const f = stepFunnel({ questions: QUESTIONS, ...build([{ id: "L", steps: [["q4", 0]], done: 42, answers: ["q4"] }]) });
    expect(f.rows[3].medianMs).toBe(42_000);
  });

  it("gives a person who left nothing for the step they left on", () => {
    const f = stepFunnel({ questions: QUESTIONS, ...build([{ id: "L", steps: [["q1", 0], ["q2", 15]], progress: ["q1"] }]) });
    expect(f.rows[0].medianMs).toBe(15_000);
    expect(f.rows[1].medianMs).toBeNull();
  });

  it("ignores negative and unparseable gaps", () => {
    const people: StepPerson[] = [
      { id: "N", started_at: at(0), submitted_at: at(5) },
      { id: "G", started_at: at(0), submitted_at: null },
    ];
    const events: StepEventRow[] = [
      { submission_id: "N", question_id: "q1", step_index: 0, occurred_at: at(0) },
      // Finished before the last step "happened": a negative gap.
      { submission_id: "N", question_id: "q2", step_index: 1, occurred_at: at(9) },
      { submission_id: "G", question_id: "q1", step_index: 0, occurred_at: "not a date" },
      { submission_id: "G", question_id: "q2", step_index: 1, occurred_at: at(8) },
    ];
    const f = stepFunnel({ questions: QUESTIONS, people, events });
    expect(f.rows[0].medianMs).toBe(9000);
    expect(f.rows[1].medianMs).toBeNull();
  });

  it("returns null ('—') when nothing remains", () => {
    expect(stepFunnel({ questions: QUESTIONS, ...build([{ id: "T", steps: [["q1", 0]], progress: [] }]) }).rows.map((r) => r.medianMs)).toEqual([null, null, null, null]);
  });
});

describe("where an unfinished person stopped (F23)", () => {
  const { people, events } = build(TEN);
  const earliest = at(0);
  const reading = (id: string, ev = events, first: string | null = earliest) => stoppedAt(people.find((p) => p.id === id)!, ev, first);
  const label = (id: string) => stoppedAtLabel(reading(id));

  it("reads 'Stopped at Q<n>' for the last question reached, counting from 1", () => {
    expect([label("P3"), label("P4"), label("P5"), label("P6")]).toEqual(["Stopped at Q1", "Stopped at Q2", "Stopped at Q3", "Stopped at Q4"]);
  });

  it("uses the step index, not the number of events", () => {
    const e: StepEventRow[] = [
      { submission_id: "P3", question_id: "q1", step_index: 0, occurred_at: at(0) },
      { submission_id: "P3", question_id: "q4", step_index: 3, occurred_at: at(2) },
    ];
    expect(stoppedAtLabel(stoppedAt(people.find((p) => p.id === "P3")!, e, earliest))).toBe("Stopped at Q4");
  });

  it("reads 'Stopped before Q1' for someone who started after the form's first step event and reached none", () => {
    expect(label("P9")).toBe("Stopped before Q1");
    const later = { id: "late", started_at: at(60), submitted_at: null };
    expect(stoppedAtLabel(stoppedAt(later, events, earliest))).toBe("Stopped before Q1");
  });

  it("reads 'not recorded' for someone who started before the form's earliest step event, and for a form with no step events at all", () => {
    const old = { id: "old", started_at: at(-3600), submitted_at: null };
    expect(stoppedAtLabel(stoppedAt(old, events, earliest))).toBe("not recorded");
    expect(stoppedAtLabel(stoppedAt(people.find((p) => p.id === "P9")!, [], null))).toBe("not recorded");
    expect(stoppedAtLabel(stoppedAt({ id: "x", started_at: "garbage", submitted_at: null }, events, earliest))).toBe("not recorded");
  });

  it("has no reading for someone who finished", () => {
    expect(reading("P1")).toEqual({ kind: "finished" });
    expect(label("P1")).toBeNull();
    expect(label("P8")).toBeNull();
  });

  it("ignores other people's events", () => {
    expect(stoppedAtLabel(stoppedAt(people.find((p) => p.id === "P9")!, events.filter((e) => e.submission_id !== "P9"), earliest))).toBe("Stopped before Q1");
  });
});

describe("the range (D5)", () => {
  // The same plans, with the people spread over time: the funnel is given the people in the range.
  const plans = (days: number[]) =>
    TEN.slice(0, 8).map((p, i) => ({ ...p, startedAt: -days[i] * 86_400 }));

  it("shrinks as the range does, and the medians come from the same people", () => {
    const days = [2, 5, 10, 20, 40, 60, 80, 85];
    const { people, events } = build(plans(days));
    const inRange = (n: number) => people.filter((p) => (BASE - Date.parse(p.started_at)) / 86_400_000 <= n);
    const reached = (n: number) => stepFunnel({ questions: QUESTIONS, people: inRange(n), events }).rows[0].reached;
    expect([reached(7), reached(30), reached(90)]).toEqual([2, 4, 8]);
    const q1Median = (n: number) => stepFunnel({ questions: QUESTIONS, people: inRange(n), events }).rows[0].medianMs;
    // P1 and P2 only: 10 s and 20 s -> 15 s.
    expect(q1Median(7)).toBe(15_000);
    expect(q1Median(90)).toBe(20_000);
  });
});

describe("the existing funnel is untouched by step events (F24)", () => {
  const base = [
    { kind: "visit", session_hash: "a" },
    { kind: "visit", session_hash: "b" },
    { kind: "start_conversation", session_hash: "a" },
    { kind: "start_form", session_hash: "b" },
    { kind: "complete", session_hash: "a" },
  ];
  it("returns the same visited, chat, form, started and completed numbers with step events mixed in", () => {
    const steps = Array.from({ length: 500 }, (_, i) => ({ kind: "step", session_hash: i % 2 ? "a" : "b" }));
    expect(buildFunnel([...base.slice(0, 2), ...steps, ...base.slice(2)])).toEqual(buildFunnel(base));
  });
});
