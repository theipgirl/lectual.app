import { describe, expect, it } from "vitest";
import {
  ANSWERS_PER_QUESTION,
  answerKey,
  assessmentResults,
  bucketLabel,
  intakeQuestionResults,
  scoreBucket,
  type AssessmentSample,
  type ResultSubmission,
} from "@/lib/intake-forms/results";
import { boothVariant } from "@/lib/assessment-card/variants";

/** Sprint 9 F8 (intake grouping) and F9 (assessment distributions). */

const t = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();

function sub(id: string, name: string, min: number, answers: unknown, over: Partial<ResultSubmission> = {}): ResultSubmission {
  return { id, contact: { name, email: `${id}@example.com` }, answers, started_at: t(min), submitted_at: t(min + 2), lead_id: `lead-${id}`, ...over };
}

const Q = [
  { id: "q-name", text: "What name do you want to protect?" },
  { id: "q-use", text: "Have you used it publicly?" },
];

describe("intake results per question (F8)", () => {
  it("groups by question id, newest first, with who, when and the answer", () => {
    const rows = [
      sub("a", "Ada", 0, [{ id: "q-name", question: "What name do you want to protect?", answer: "SANKOFA" }]),
      sub("b", "Bo", 10, [
        { id: "q-name", question: "What name do you want to protect?", answer: "ACME" },
        { id: "q-use", question: "Have you used it publicly?", answer: "Yes" },
      ]),
    ];
    const r = intakeQuestionResults(rows, Q);
    expect(r.map((q) => q.question)).toEqual(["What name do you want to protect?", "Have you used it publicly?"]);
    expect(r[0].rows.map((x) => [x.who, x.answer, x.submissionId, x.leadId])).toEqual([
      ["Bo", "ACME", "b", "lead-b"],
      ["Ada", "SANKOFA", "a", "lead-a"],
    ]);
    expect(r[0].rows[0].at).toBe(t(12));
    expect(r[0].total).toBe(2);
    expect(r[1].rows.map((x) => x.answer)).toEqual(["Yes"]);
  });

  it("keeps a reworded question in one group (same id), and shows the form's current wording", () => {
    const rows = [
      sub("a", "Ada", 0, [{ id: "q-name", question: "Which name?", answer: "OLD" }]),
      sub("b", "Bo", 10, [{ id: "q-name", question: "What name do you want to protect?", answer: "NEW" }]),
    ];
    const r = intakeQuestionResults(rows, Q);
    expect(r[0]).toMatchObject({ question: "What name do you want to protect?", total: 2, inForm: true });
  });

  it("lists removed questions after the form's own, under their latest stored text", () => {
    const rows = [
      sub("a", "Ada", 0, [{ id: "q-gone", question: "Old wording", answer: "x" }]),
      sub("b", "Bo", 10, [{ id: "q-gone", question: "Newer wording", answer: "y" }]),
      sub("c", "Cy", 20, [{ id: null, question: "Free text question", answer: "z" }]),
      sub("d", "Di", 30, [{ id: null, question: " free text QUESTION ", answer: "w" }]),
    ];
    const r = intakeQuestionResults(rows, Q);
    expect(r.map((q) => [q.question, q.inForm, q.total])).toEqual([
      ["What name do you want to protect?", true, 0],
      ["Have you used it publicly?", true, 0],
      // Most recently answered first.
      ["free text QUESTION", false, 2],
      ["Newer wording", false, 2],
    ]);
    expect(answerKey({ id: null, question: " Free Text " })).toBe("text:free text");
  });

  it("caps each question at 50 answers and says how many there are", () => {
    const rows = Array.from({ length: 53 }, (_, i) => sub(`s${i}`, `Person ${i}`, i, [{ id: "q-name", question: "q", answer: `a${i}` }]));
    const [q] = intakeQuestionResults(rows, Q);
    expect(q.total).toBe(53);
    expect(q.rows).toHaveLength(ANSWERS_PER_QUESTION);
    expect(q.capped).toBe(true);
    expect(q.rows[0].answer).toBe("a52");
    expect(intakeQuestionResults(rows.slice(0, 50), Q)[0].capped).toBe(false);
  });

  it("lets only people who sent answers contribute", () => {
    const rows = [
      sub("a", "Ada", 0, [{ id: "q-name", question: "q", answer: "SANKOFA" }]),
      // Contact-first: filed at the contact step, never sent answers.
      sub("b", "Bo", 10, [], { submitted_at: null }),
      sub("c", "Cy", 20, [{ id: "q-name", question: "q", answer: "should not count" }], { submitted_at: null }),
    ];
    const [q] = intakeQuestionResults(rows, Q);
    expect(q.rows.map((x) => x.who)).toEqual(["Ada"]);
  });

  it("does not throw on malformed answers and keeps the other rows", () => {
    const rows = [
      sub("a", "Ada", 0, "not an array"),
      sub("b", "Bo", 5, [null, 7, { nope: true }, ["only one"], { id: 5, question: 9, answer: {} }]),
      sub("c", "Cy", 10, { id: "q-name" }),
      sub("d", "Di", 15, [{ id: "q-name", question: "q", answer: "fine" }, { id: "q-name", question: "q", answer: "   " }]),
      { id: "e", contact: null, answers: null, started_at: "bad", submitted_at: "bad", lead_id: null },
    ];
    const [q] = intakeQuestionResults(rows as ResultSubmission[], Q);
    expect(q.rows.map((x) => [x.who, x.answer])).toEqual([["Di", "fine"]]);
  });

  it("names a person without a name by their email, then 'No name given'", () => {
    const rows = [
      { ...sub("a", "", 0, [{ id: "q-name", question: "q", answer: "1" }]), contact: { email: "x@example.com" } },
      { ...sub("b", "", 5, [{ id: "q-name", question: "q", answer: "2" }]), contact: {} },
    ];
    expect(intakeQuestionResults(rows, Q)[0].rows.map((r) => r.who)).toEqual(["No name given", "x@example.com"]);
  });
});

describe("score buckets (F9)", () => {
  it("puts the boundary scores in the right bucket, with 100 in the last", () => {
    expect([0, 9, 10, 19, 89, 90, 99, 100].map(scoreBucket)).toEqual([0, 0, 1, 1, 8, 9, 9, 9]);
    expect(scoreBucket(-5)).toBe(0);
    expect(scoreBucket(250)).toBe(9);
    expect([0, 1, 8, 9].map(bucketLabel)).toEqual(["0–9", "10–19", "80–89", "90–100"]);
  });
});

const card = boothVariant("business").questions;

function sample(over: Partial<AssessmentSample>): AssessmentSample {
  return { finished: true, score: 50, band: "partial", temperature: "warm", choices: {}, gaps: [], ...over };
}

describe("assessment distributions (F9)", () => {
  const samples: AssessmentSample[] = [
    sample({ score: 0, band: "exposed", temperature: "hot", choices: { 2: ["no"], 5: ["no"] }, gaps: ["Gap A", "Gap B", "Gap C"] }),
    sample({ score: 9, band: "exposed", temperature: "hot", choices: { 2: ["no"], 5: ["applied"] }, gaps: ["Gap A", "Gap B"] }),
    sample({ score: 50, band: "partial", temperature: "warm", choices: { 2: ["yes"], 5: ["no"] }, gaps: ["Gap A", "Gap D"] }),
    sample({ score: 90, band: "protected", temperature: "cold", choices: { 2: ["yes"], 5: ["registered"] }, gaps: [] }),
    sample({ score: 100, band: "protected", temperature: "cold", choices: { 2: ["yes"] }, gaps: null }),
    sample({ finished: false, score: null, band: null, temperature: null, choices: { 2: ["no"] }, gaps: ["Unfinished gap"] }),
  ];
  const r = assessmentResults(samples, card);

  it("counts finished and unfinished people separately and keeps the unfinished out of every distribution", () => {
    expect(r.finished).toBe(5);
    expect(r.unfinished).toBe(1);
    expect(r.bands.map((b) => [b.key, b.count])).toEqual([
      ["exposed", 2],
      ["partial", 1],
      ["protected", 2],
    ]);
    expect(r.bands.map((b) => b.label)).toEqual(["Exposed", "Partially protected", "Protected"]);
    expect(r.temperatures).toEqual({ hot: 2, warm: 1, cold: 2 });
    expect(r.buckets.map((b) => b.count)).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 2]);
    expect(r.buckets[9].label).toBe("90–100");
    expect(r.questions.find((q) => q.id === 2)?.options.find((o) => o.value === "no")?.count).toBe(2);
    expect(r.gaps.some((g) => g.text === "Unfinished gap")).toBe(false);
  });

  it("includes every option of the card per question, with zero counts", () => {
    const q5 = r.questions.find((q) => q.id === 5)!;
    expect(q5.options.map((o) => [o.value, o.count])).toEqual([
      ["registered", 1],
      ["applied", 1],
      ["no", 2],
      ["unsure", 0],
    ]);
    expect(q5.answered).toBe(4);
    expect(r.questions).toHaveLength(card.length);
    expect(r.questions.find((q) => q.id === 1)!.options.every((o) => o.count === 0)).toBe(true);
  });

  it("counts single and multi-select answers, and shows a value the card lacks as 'other'", () => {
    const multi = [
      { id: 7, question: "Which?", multiSelect: true, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }, { label: "C", value: "c" }] },
    ];
    const m = assessmentResults(
      [sample({ choices: { 7: ["a", "b"] } }), sample({ choices: { 7: ["b", "b"] } }), sample({ choices: { 7: ["zzz"] } })],
      multi,
    );
    expect(m.questions[0].options.map((o) => [o.value, o.count])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 0],
    ]);
    expect(m.questions[0].other).toEqual([{ value: "zzz", count: 1 }]);
    expect(m.questions[0].answered).toBe(3);
  });

  it("orders the top gaps by count with a stable tie-break, and counts how many could be read", () => {
    expect(r.gaps).toEqual([
      { text: "Gap A", count: 3 },
      { text: "Gap B", count: 2 },
      { text: "Gap C", count: 1 },
      { text: "Gap D", count: 1 },
    ]);
    expect(r.gapsRead).toBe(4);
    expect(r.gapsUnread).toBe(1);
    // The same people in another order give the same list.
    const shuffled = assessmentResults([...samples].reverse(), card);
    expect(shuffled.gaps).toEqual(r.gaps);
  });

  it("limits the most common gaps to five", () => {
    const many = [sample({ gaps: ["g1", "g2", "g3", "g4", "g5", "g6", "g7"] })];
    expect(assessmentResults(many, card).gaps.map((g) => g.text)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
  });

  it("falls back to the card's band for a score stored without one, and survives no samples", () => {
    const x = assessmentResults([sample({ score: 85, band: null })], card);
    expect(x.bands.find((b) => b.key === "protected")?.count).toBe(1);
    const empty = assessmentResults([], card);
    expect(empty.finished).toBe(0);
    expect(empty.buckets.every((b) => b.count === 0)).toBe(true);
    expect(empty.gaps).toEqual([]);
  });

  it("counts a duplicate gap once per person", () => {
    const x = assessmentResults([sample({ gaps: ["Same", "Same"] })], card);
    expect(x.gaps).toEqual([{ text: "Same", count: 1 }]);
  });
});
