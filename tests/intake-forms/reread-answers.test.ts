import { describe, expect, it } from "vitest";
import { DEFAULT_ASSESSMENT, scoreAssessmentAnswers, type AssessmentSettings } from "@/lib/intake-forms/assessment";
import { answerValues, matchOptionLabels, rereadAnswers, variantFromIds } from "@/lib/intake-forms/reread-answers";
import { sampleFromSubmission } from "@/lib/intake-forms/assessment-samples";
import type { BoothQuestion } from "@/lib/assessment-card/questions";

/**
 * Sprint 9 F2: the intake-assessment submission row stores score, band and
 * temperature but not gaps, and its answers as option LABELS. Re-reading them
 * through the card must give back exactly what the real scorer produced.
 */

const business: AssessmentSettings = { ...DEFAULT_ASSESSMENT, variant: "business" };
const ip: AssessmentSettings = { ...DEFAULT_ASSESSMENT, variant: "ip" };

const BUSINESS = { "2": "no", "3": "4_10", "4": "over_1m", "5": "applied", "6": "partial", "7": "none", "8": "right_away" };
const IP = { "102": "no", "103": "self", "104": "unsure", "105": "yes", "106": "some", "107": "none", "108": "250k_500k", "109": "1_2_months" };

function scored(settings: AssessmentSettings, raw: Record<string, string | string[]>) {
  const r = scoreAssessmentAnswers(settings, raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

describe("re-reading stored answers (F2)", () => {
  it.each([
    ["business", "business"],
    ["brand", "brand"],
    ["both", "both"],
  ])("Business card, track answer %s: same score, band, temperature and gaps", (_name, track) => {
    const original = scored(business, { "1": track, ...BUSINESS });
    const back = rereadAnswers(original.answerList);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.variant).toBe("business");
    expect(back.score.score).toBe(original.score.score);
    expect(back.score.band).toBe(original.score.band);
    expect(back.score.temperature).toBe(original.score.temperature);
    expect(back.score.gaps).toEqual(original.score.gaps);
    expect(back.score.gaps.length).toBeGreaterThan(0);
  });

  it.each(["yes", "no"])("IP card with 'create original content' = %s", (creates) => {
    const original = scored(ip, { "101": "business", ...IP, "105": creates });
    const back = rereadAnswers(original.answerList);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.variant).toBe("ip");
    expect(back.score).toEqual(original.score);
  });

  it("round-trips through the stored JSON shape (ids as strings, labels as answers)", () => {
    const original = scored(business, { "1": "brand", ...BUSINESS });
    const stored = JSON.parse(JSON.stringify(original.answerList));
    const back = rereadAnswers(stored);
    expect(back.ok && back.score.gaps).toEqual(original.score.gaps);
    // The stored answer is the label, not the value.
    expect(original.answerList.find((a) => a.id === "5")?.answer).toBe("Application pending");
  });

  it("reports unavailable for a label that is not on the card", () => {
    const original = scored(business, { "1": "business", ...BUSINESS });
    const tampered = original.answerList.map((a) => (a.id === "2" ? { ...a, answer: "Maybe" } : a));
    expect(rereadAnswers(tampered)).toEqual({ ok: false, reason: "unmatched_label" });
  });

  it("reports unavailable for an unknown question id, mixed cards, no answers and a missing track answer", () => {
    expect(rereadAnswers([{ id: "99", question: "?", answer: "Yes" }])).toEqual({ ok: false, reason: "unknown_question" });
    expect(rereadAnswers([{ id: null, question: "Old question", answer: "Yes" }])).toEqual({ ok: false, reason: "unknown_question" });
    expect(
      rereadAnswers([
        { id: "2", question: "q", answer: "Yes" },
        { id: "102", question: "q", answer: "No" },
      ]),
    ).toEqual({ ok: false, reason: "mixed_cards" });
    expect(rereadAnswers([])).toEqual({ ok: false, reason: "no_answers" });
    expect(rereadAnswers([{ id: "2", question: "q", answer: "Yes" }])).toEqual({ ok: false, reason: "no_track_answer" });
    expect(
      rereadAnswers([
        { id: "1", question: "q", answer: "A business" },
        { id: "1", question: "q", answer: "Both" },
      ]),
    ).toEqual({ ok: false, reason: "duplicate_answer" });
  });

  it("reads the card from the ids", () => {
    expect(variantFromIds(["1", "2", "8"])).toBe("business");
    expect(variantFromIds(["101", "109"])).toBe("ip");
    expect(variantFromIds(["2", "102"])).toBeNull();
    expect(variantFromIds([])).toBeNull();
    expect(variantFromIds(["", "x"])).toBeNull();
  });
});

describe("matching labels to options", () => {
  const options = [
    { label: "Yes, in writing", value: "w" },
    { label: "Some, not all", value: "s" },
    { label: "None", value: "n" },
  ];

  it("matches a single label exactly and refuses anything else", () => {
    expect(matchOptionLabels("None", options, false)).toEqual(["n"]);
    expect(matchOptionLabels("none", options, false)).toBeNull();
    expect(matchOptionLabels("None, Yes, in writing", options, false)).toBeNull();
  });

  it("round-trips a multi-select answer, even when a label contains a comma", () => {
    const joined = ["Yes, in writing", "None"].join(", ");
    expect(matchOptionLabels(joined, options, true)).toEqual(["w", "n"]);
    expect(matchOptionLabels("Yes, in writing", options, true)).toEqual(["w"]);
    expect(matchOptionLabels("Some, not all, None", options, true)).toEqual(["s", "n"]);
    // Splitting on commas alone would see "Yes" and "in writing"; neither is an option.
    expect(matchOptionLabels("Yes, in writing, Nope", options, true)).toBeNull();
  });

  it("matches a multi-select question end to end", () => {
    const questions: BoothQuestion[] = [{ id: 7, question: "Which?", multiSelect: true, options }];
    const read = answerValues([{ id: "7", question: "Which?", answer: "Yes, in writing, None" }], questions);
    expect(read).toEqual({ ok: true, answers: { 7: ["w", "n"] } });
    expect(answerValues([{ id: "7", question: "Which?", answer: "Never" }], questions)).toEqual({ ok: false, reason: "unmatched_label" });
  });
});

describe("one submission as a sample", () => {
  it("carries the stored score and the re-read gaps", () => {
    const original = scored(business, { "1": "business", ...BUSINESS });
    const s = sampleFromSubmission({
      submitted_at: "2026-10-20T12:00:00Z",
      score: original.score.score,
      band: original.score.band,
      temperature: original.score.temperature,
      answers: original.answerList,
    });
    expect(s.finished).toBe(true);
    expect(s.gaps).toEqual(original.score.gaps);
    expect(s.choices[5]).toEqual(["applied"]);
    expect(s.choices[2]).toEqual(["no"]);
  });

  it("drops the gaps, not the score, when the stored result disagrees with a re-score", () => {
    const original = scored(business, { "1": "business", ...BUSINESS });
    const s = sampleFromSubmission({
      submitted_at: "2026-10-20T12:00:00Z",
      score: original.score.score + 10,
      band: "protected",
      temperature: original.score.temperature,
      answers: original.answerList,
    });
    expect(s.gaps).toBeNull();
    expect(s.score).toBe(original.score.score + 10);
  });

  it("marks an unfinished row and tolerates malformed answers", () => {
    expect(sampleFromSubmission({ submitted_at: null, score: null, band: null, temperature: null, answers: [] })).toMatchObject({ finished: false, gaps: null, choices: {} });
    expect(sampleFromSubmission({ submitted_at: "2026-10-20T12:00:00Z", score: 50, band: "partial", temperature: "warm", answers: "garbage" }).gaps).toBeNull();
  });
});

// ── Sprint 10 F13: the firm's own questions are set aside before the card is matched ──

describe("re-reading answers that include the firm's own questions (F13)", () => {
  const settingsWithExtras = (variant: "business" | "ip"): AssessmentSettings => ({
    ...DEFAULT_ASSESSMENT,
    variant,
    extras: [
      { id: "qwhere", text: "Where did you hear about us?", required: true, type: "text" },
      { id: "qsell", text: "What do you sell?", required: false, type: "multi", options: ["Goods", "Services, software"] },
    ],
  });
  const extraRaw = { qwhere: "Booth 12", qsell: ["Services, software", "Goods"] };

  it.each([
    ["business", { "1": "brand", ...BUSINESS }],
    ["ip", { "101": "business", ...IP }],
  ] as const)("%s card: the same gaps, band, score and temperature with extras as without", (variant, raw) => {
    const plain = scored(variant === "ip" ? ip : business, raw);
    const withExtras = scored(settingsWithExtras(variant), { ...raw, ...extraRaw });
    expect(withExtras.answerList).toHaveLength(plain.answerList.length + 2);
    const a = rereadAnswers(plain.answerList);
    const b = rereadAnswers(withExtras.answerList);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.variant).toBe(a.variant);
    expect(b.score).toEqual(a.score);
    expect(b.answers).toEqual(a.answers);
  });

  it("the sample builder returns the same gaps, band, score and temperature, and the same option choices", () => {
    const raw = { "1": "brand", ...BUSINESS };
    const plain = scored(business, raw);
    const withExtras = scored(settingsWithExtras("business"), { ...raw, ...extraRaw });
    const row = (v: typeof plain) => ({ submitted_at: "2026-10-18T15:04:00Z", score: v.score.score, band: v.score.band, temperature: v.score.temperature, answers: v.answerList });
    expect(sampleFromSubmission(row(withExtras))).toEqual(sampleFromSubmission(row(plain)));
    expect(sampleFromSubmission(row(withExtras)).gaps).toEqual(plain.score.gaps);
  });

  it("variant detection ignores extras, whatever order they are stored in", () => {
    expect(variantFromIds(["qwhere", "1", "2", "qsell"])).toBe("business");
    expect(variantFromIds(["101", "qwhere", "108"])).toBe("ip");
    expect(variantFromIds(["qwhere", "qsell"])).toBeNull();
  });

  it("an answer with an unknown numeric id still makes the re-read unavailable, extras or not", () => {
    const original = scored(settingsWithExtras("business"), { "1": "brand", ...BUSINESS, ...extraRaw });
    const forged = [...original.answerList, { id: "9", question: "Nope", answer: "Yes" }];
    expect(rereadAnswers(forged)).toEqual({ ok: false, reason: "unknown_question" });
    const swapped = original.answerList.map((a) => (a.id === "3" ? { ...a, id: "13" } : a));
    expect(rereadAnswers(swapped)).toEqual({ ok: false, reason: "unknown_question" });
  });

  it("an answer with no id still fails the re-read, extras or not", () => {
    const original = scored(settingsWithExtras("business"), { "1": "brand", ...BUSINESS, ...extraRaw });
    const nulled = original.answerList.map((a) => (a.id === "4" ? { ...a, id: null } : a));
    expect(rereadAnswers(nulled)).toEqual({ ok: false, reason: "unknown_question" });
  });

  it("answers that are only extras read as no card answers", () => {
    expect(rereadAnswers([{ id: "qwhere", question: "Where?", answer: "Booth" }])).toEqual({ ok: false, reason: "no_answers" });
  });

  it("an extra answer that looks like a card option does not confuse the match", () => {
    const original = scored(settingsWithExtras("business"), { "1": "brand", ...BUSINESS, qwhere: "No", qsell: ["Goods"] });
    const back = rereadAnswers(original.answerList);
    expect(back.ok && back.score.gaps).toEqual(scored(business, { "1": "brand", ...BUSINESS }).score.gaps);
  });
});
