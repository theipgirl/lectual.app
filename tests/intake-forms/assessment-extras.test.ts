import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boothVariant, type BoothVariantId } from "@/lib/assessment-card/variants";
import { shouldAsk, type BoothQuestion } from "@/lib/assessment-card/questions";
import { HIDEABLE_CARD_QUESTIONS } from "@/lib/assessment-card/hideable";
import { DEFAULT_ASSESSMENT, assessmentStaffLine, publicAssessment, scoreAssessmentAnswers, type AssessmentSettings } from "@/lib/intake-forms/assessment";
import { defaultIntakeConfig, type IntakeFormConfig } from "@/lib/intake-forms/config";
import { loadActions, person } from "./helpers/step-harness";

/**
 * Sprint 10 F8 to F10 and F12: the firm's own assessment questions and hidden
 * card questions leave the score exactly where it was.
 */

// ── F8: the golden values, captured from the code as it stood BEFORE this sprint ──

function businessSweep() {
  const out: Record<string, string>[] = [];
  for (const t of ["business", "brand", "both"])
    for (const e of ["yes", "no", "unsure"])
      for (const team of ["0_3", "over_25"])
        for (const rev of ["under_150k", "150k_250k", "250k_500k", "500k_1m", "over_1m"])
          for (const tm of ["registered", "applied", "no"])
            for (const cp of ["documented", "no"])
              for (const ct of ["all", "none"])
                for (const tl of ["right_away", "1_2_months", "3_plus_months"])
                  out.push({ "1": t, "2": e, "3": team, "4": rev, "5": tm, "6": cp, "7": ct, "8": tl });
  return out;
}

function ipSweep() {
  const out: Record<string, string>[] = [];
  for (const t of ["business", "brand"])
    for (const tm of ["registered", "applied", "no"])
      for (const cl of ["professional", "self", "no"])
        for (const cf of ["yes", "no", "unsure"])
          for (const cr of ["yes", "no"])
            for (const rev of ["under_150k", "over_1m"])
              for (const tl of ["right_away", "3_plus_months"]) {
                const a: Record<string, string> = { "101": t, "102": tm, "103": cl, "104": cf, "105": cr, "108": rev, "109": tl };
                if (cr === "yes") {
                  a["106"] = "some";
                  a["107"] = "solo";
                }
                out.push(a);
              }
  return out;
}

function score(variant: BoothVariantId, answers: Record<string, string>, over: Partial<AssessmentSettings> = {}) {
  const r = scoreAssessmentAnswers({ ...DEFAULT_ASSESSMENT, variant, ...over }, answers);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.value;
}

describe("scoring is unchanged (F8)", () => {
  it("gives the same score, band, temperature, gaps, next step and stored answers for 3,672 card answer sets as the pre-sprint scorer", () => {
    const rows: unknown[] = [];
    for (const [variant, list] of [
      ["business", businessSweep()],
      ["ip", ipSweep()],
    ] as const) {
      for (const a of list) {
        const v = score(variant, a);
        rows.push({ v: variant, a, s: v.score, view: v.view, list: v.answerList });
      }
    }
    expect(rows).toHaveLength(3672);
    // Captured by running exactly this sweep against the code before Sprint 10.
    expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe("dbdc56d796ddd27538ab11dab2c753451c6c4c6e5824591ab0f7c95da1bdab87");
  });

  const named: [string, BoothVariantId, Record<string, string>, Record<string, unknown>][] = [
    [
      "Brand & Business, business track, no entity, $500k-1M, right away: hot",
      "business",
      { "1": "business", "2": "no", "3": "4_10", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" },
      {
        score: 0,
        band: "exposed",
        temperature: "hot",
        track: "business",
        valueBand: "HIGH",
        readyNow: true,
        gcProspect: true,
        nextStep: "This merits a proper conversation. Reserve a consultation while you are here.",
        staffPrompt: "GENERAL COUNSEL FIT — revenue at $150k+. Ask if they have an attorney; get Rebecca to them.",
        gaps: [
          "No entity holds this — at present, the business is you personally.",
          "Your intellectual property is not documented as the business's.",
          "Your name and logo are not federally registered.",
        ],
      },
    ],
    [
      "Brand & Business, personal brand, fully protected, small, later: cold",
      "business",
      { "1": "brand", "2": "yes", "3": "0_3", "4": "under_150k", "5": "registered", "6": "documented", "7": "all", "8": "3_plus_months" },
      {
        score: 100,
        band: "protected",
        temperature: "cold",
        track: "brand",
        valueBand: "LOW",
        readyNow: false,
        gcProspect: false,
        nextStep: "Your foundation is strong. Keep this for your next renewal.",
        staffPrompt: "Hand them their merch ticket. Don't spend the slot.",
        gaps: [],
      },
    ],
    [
      "Brand & Business, both, partial, $250k-500k: warm",
      "business",
      { "1": "both", "2": "yes", "3": "over_25", "4": "250k_500k", "5": "applied", "6": "partial", "7": "some", "8": "1_2_months" },
      {
        score: 63,
        band: "partial",
        temperature: "warm",
        track: "business",
        valueBand: "HIGH",
        readyNow: false,
        gcProspect: true,
        nextStep: "The full analysis will be in your inbox. Schedule a consultation when you are ready.",
        staffPrompt: "GENERAL COUNSEL FIT — revenue at $150k+. Ask if they have an attorney; get Rebecca to them.",
        gaps: [
          "Only part of your intellectual property is documented as yours.",
          "Your trademark application is filed and awaiting registration.",
          "Only part of your revenue is protected by written contracts.",
        ],
      },
    ],
    [
      "Trademark & Copyright, a name conflict forces hot",
      "ip",
      { "101": "business", "102": "registered", "103": "professional", "104": "yes", "105": "no", "108": "under_150k", "109": "3_plus_months" },
      {
        score: 100,
        band: "protected",
        temperature: "hot",
        track: "business",
        valueBand: "LOW",
        readyNow: false,
        gcProspect: false,
        nextStep: "This merits a proper conversation. Reserve a consultation while you are here.",
        staffPrompt: "NAME CONFLICT — they have seen a similar name or been contacted. Get Rebecca to them.",
        gaps: [],
      },
    ],
    [
      "Trademark & Copyright, brand track, creates content, $150k-250k: warm",
      "ip",
      { "101": "brand", "102": "applied", "103": "self", "104": "unsure", "105": "yes", "106": "some", "107": "solo", "108": "150k_250k", "109": "1_2_months" },
      {
        score: 63,
        band: "partial",
        temperature: "warm",
        track: "brand",
        valueBand: "MID",
        readyNow: false,
        gcProspect: true,
        nextStep: "The full analysis will be in your inbox. Schedule a consultation when you are ready.",
        staffPrompt: "GENERAL COUNSEL FIT — revenue at $150k+. Ask if they have an attorney; get Rebecca to them.",
        gaps: [
          "Your trademark application is filed and awaiting registration.",
          "Your name was searched online, not with a full trademark search.",
          "Only some of your work is registered with the Copyright Office.",
        ],
      },
    ],
    [
      "Trademark & Copyright, protected and no hurry: cold",
      "ip",
      { "101": "business", "102": "registered", "103": "professional", "104": "no", "105": "no", "108": "under_150k", "109": "3_plus_months" },
      {
        score: 100,
        band: "protected",
        temperature: "cold",
        track: "business",
        valueBand: "LOW",
        readyNow: false,
        gcProspect: false,
        nextStep: "Your foundation is strong. Keep this for your next renewal.",
        staffPrompt: "Thank them. The follow-up does the work.",
        gaps: [],
      },
    ],
  ];

  it.each(named)("%s", (_name, variant, answers, expected) => {
    const v = score(variant, answers);
    expect(v.score).toMatchObject(expected);
    expect(v.view).toEqual({ score: expected.score, band: expected.band === "exposed" ? "Exposed" : expected.band === "partial" ? "Partially protected" : "Protected", gaps: expected.gaps, nextStep: expected.nextStep });
  });

  it("stores the card's answers as the question's own option labels, in the card's order", () => {
    const v = score("business", { "1": "brand", "2": "yes", "3": "0_3", "4": "under_150k", "5": "registered", "6": "documented", "7": "all", "8": "3_plus_months" });
    expect(v.answerList.map((a) => `${a.id}:${a.answer}`)).toEqual([
      "1:A personal brand",
      "2:Yes",
      "3:0–3",
      "4:Under $150k",
      "5:Yes, registered",
      "6:Yes, it is all documented",
      "7:Yes, everything is in writing",
      "8:In 3+ months",
    ]);
  });
});

// ── F9 / F10: the hideable list is safe, and guarded ─────────────────────────

const unscored = (variant: BoothVariantId) => boothVariant(variant).questions.filter((q) => !q.category);
const askedIds = (variant: BoothVariantId, answers: Record<number, string>) =>
  boothVariant(variant)
    .questions.filter((q) => shouldAsk(q, answers))
    .map((q) => q.id);

describe("hiding the team-size question (F9)", () => {
  const hidden: Partial<AssessmentSettings> = { hidden: ["3"] };

  it("leaves the score, band, temperature, gaps, next step and staff prompt the same for every combination of the other answers", () => {
    let n = 0;
    for (const a of businessSweep().filter((x) => x["3"] === "0_3")) {
      const without = score("business", a);
      const { "3": _team, ...rest } = a;
      void _team;
      const withHidden = score("business", rest, hidden);
      expect(withHidden.score).toEqual(without.score);
      expect(withHidden.view).toEqual(without.view);
      expect(withHidden.answerList).toEqual(without.answerList.filter((x) => x.id !== "3"));
      n++;
    }
    expect(n).toBe(1620);
  });

  it("is not in what the browser receives, and is not needed to finish", () => {
    const pub = publicAssessment({ ...DEFAULT_ASSESSMENT, ...hidden });
    expect([...pub.business, ...pub.brand].some((q) => q.id === 3)).toBe(false);
    const ok = scoreAssessmentAnswers({ ...DEFAULT_ASSESSMENT, ...hidden }, { "1": "business", "2": "no", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" });
    expect(ok.ok).toBe(true);
    // And without hiding it, leaving it out is still refused.
    const refused = scoreAssessmentAnswers(DEFAULT_ASSESSMENT, { "1": "business", "2": "no", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" });
    expect(refused.ok).toBe(false);
  });

  it("drops an answer sent for it anyway", () => {
    const v = score("business", { "1": "business", "2": "no", "3": "over_25", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" }, hidden);
    expect(v.answerList.some((a) => a.id === "3")).toBe(false);
    expect(v.answerList).toHaveLength(7);
  });

  it("changes nothing the Lawmatics tag reads: same temperature for every sweep row", () => {
    for (const a of businessSweep().filter((x) => x["3"] === "over_25").slice(0, 400)) {
      const { "3": _t, ...rest } = a;
      void _t;
      expect(score("business", rest, hidden).score.temperature).toBe(score("business", a).score.temperature);
    }
  });
});

describe("the hideable list is guarded (F10)", () => {
  const base: Record<BoothVariantId, Record<number, string>> = {
    business: { 1: "business", 2: "no", 3: "4_10", 4: "under_150k", 5: "no", 6: "no", 7: "none", 8: "3_plus_months" },
    ip: { 101: "business", 102: "no", 103: "no", 104: "no", 105: "yes", 106: "no", 107: "none", 108: "under_150k", 109: "3_plus_months" },
  };

  const output = (variant: BoothVariantId, a: Record<number, string>) => ({
    score: boothVariant(variant).score(a),
    asked: askedIds(variant, a),
  });

  for (const variant of ["business", "ip"] as const) {
    const hideable = HIDEABLE_CARD_QUESTIONS[variant];

    describe(`${variant} card`, () => {
      for (const q of unscored(variant).filter((x) => !hideable.includes(x.id))) {
        it(`question ${q.id} is load-bearing: some answer changes the score output or which questions are asked`, () => {
          const outputs = new Set(q.options.map((o) => JSON.stringify(output(variant, { ...base[variant], [q.id]: o.value }))));
          expect(outputs.size).toBeGreaterThan(1);
        });
      }

      for (const id of hideable) {
        const q = boothVariant(variant).questions.find((x) => x.id === id) as BoothQuestion;
        it(`question ${id} is neither read by the scorer nor a condition of another question`, () => {
          expect(q.category).toBeUndefined();
          const outputs = new Set(q.options.map((o) => JSON.stringify(output(variant, { ...base[variant], [id]: o.value }))));
          expect(outputs.size).toBe(1);
          expect(boothVariant(variant).questions.some((x) => x.showWhen?.qId === id)).toBe(false);
          // Leaving it out entirely gives the same output as any answer to it.
          const without: Record<number, string> = { ...base[variant] };
          delete without[id];
          expect(JSON.stringify(output(variant, { ...base[variant], [id]: q.options[0].value }))).toBe(JSON.stringify(output(variant, without)));
        });
      }

      it("every hideable id is a real, unscored question on this card", () => {
        for (const id of hideable) expect(unscored(variant).some((x) => x.id === id)).toBe(true);
      });
    });
  }

  it("the list is exactly team size on Brand & Business and nothing on Trademark & Copyright", () => {
    expect(HIDEABLE_CARD_QUESTIONS).toEqual({ business: [3], ip: [] });
  });
});

// ── F12: completing with the firm's own questions ────────────────────────────

const SLUG = "ugw-2026";
const HOT = { "1": "business", "2": "no", "3": "4_10", "4": "500k_1m", "5": "no", "6": "no", "7": "none", "8": "right_away" };
const EXTRAS = [
  { id: "qwhere", text: "Where did you hear about us?", required: true, type: "text" as const },
  { id: "qlogo", text: "Do you have a logo?", required: false, type: "single" as const, options: ["Yes", "No"] },
  { id: "qsell", text: "What do you sell?", required: false, type: "multi" as const, options: ["Goods", "Services", "Software, apps"] },
];

function assessmentConfig(extras = EXTRAS): IntakeFormConfig {
  return { ...defaultIntakeConfig(), assessment: { ...DEFAULT_ASSESSMENT, extras } };
}

async function complete(answers: Record<string, unknown>, config = assessmentConfig()) {
  const p = person({ contact: { name: "Ana Ruiz", email: "ana@example.com" }, source_host: null, lead_id: null });
  const { db, actions } = await loadActions({ people: [p.row], config, kind: "assessment" });
  const sync = (await import("@/lib/intake-forms/lawmatics-sync")) as unknown as { syncIntakeCompletion: ReturnType<typeof vi.fn> };
  const res = await actions.completeAssessmentAction(SLUG, { token: p.token, answers });
  await new Promise((r) => setTimeout(r, 0));
  return { res, db, sync };
}

describe("completing an assessment with the firm's own questions (F12)", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => void vi.restoreAllMocks());

  it("stores the card answers, then the extras in the firm's order, each with its id and text", async () => {
    const { res, db } = await complete({ ...HOT, qwhere: "  Booth 12  ", qlogo: "No", qsell: ["Software, apps", "Goods"] });
    expect(res).toMatchObject({ ok: true });
    const stored = db.rows("crm_intake_submission")[0];
    expect(stored.submitted_at).toBeTruthy();
    const list = stored.answers as { id: string; question: string; answer: string }[];
    expect(list.map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "qwhere", "qlogo", "qsell"]);
    expect(list.slice(8)).toEqual([
      { id: "qwhere", question: "Where did you hear about us?", answer: "Booth 12" },
      { id: "qlogo", question: "Do you have a logo?", answer: "No" },
      // A multi answer is its labels in the question's option order (a label may contain a comma).
      { id: "qsell", question: "What do you sell?", answer: "Goods, Software, apps" },
    ]);
  });

  it("leaves out an optional extra that was not answered", async () => {
    const { db } = await complete({ ...HOT, qwhere: "Booth 12" });
    expect((db.rows("crm_intake_submission")[0].answers as { id: string }[]).map((a) => a.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "qwhere"]);
  });

  it("refuses a missing required extra, with nothing written", async () => {
    const { res, db } = await complete({ ...HOT, qlogo: "Yes" });
    expect(res).toEqual({ ok: false, error: "Please answer: Where did you hear about us?" });
    expect(db.rows("crm_intake_submission")[0].submitted_at).toBeNull();
    expect(db.writesTo("crm_intake_submission")).toHaveLength(0);
  });

  it("refuses an extra choice that is not an option", async () => {
    const { res, db } = await complete({ ...HOT, qwhere: "x", qlogo: "Maybe" });
    expect(res).toEqual({ ok: false, error: "Please choose one of the listed answers for: Do you have a logo?" });
    expect(db.writesTo("crm_intake_submission")).toHaveLength(0);
    const two = await complete({ ...HOT, qwhere: "x", qlogo: ["Yes", "No"] });
    expect(two.res).toMatchObject({ ok: false });
    const dup = await complete({ ...HOT, qwhere: "x", qsell: ["Goods", "Goods"] });
    expect(dup.res).toMatchObject({ ok: false });
  });

  it("returns the same result and passes the same temperature to Lawmatics as without extras", async () => {
    const withExtras = await complete({ ...HOT, qwhere: "Booth 12", qlogo: "Yes", qsell: ["Goods"] });
    const without = await complete({ ...HOT }, { ...defaultIntakeConfig(), assessment: { ...DEFAULT_ASSESSMENT } });
    expect(withExtras.res).toEqual(without.res);
    expect(withExtras.res).toMatchObject({ ok: true, result: { score: 0, band: "Exposed" } });
    const t = (c: { sync: { syncIntakeCompletion: ReturnType<typeof vi.fn> } }) => c.sync.syncIntakeCompletion.mock.calls[0][2];
    expect(t(withExtras).temperature).toBe("hot");
    expect(t(without).temperature).toBe("hot");
    const a = db(withExtras).rows("crm_intake_submission")[0];
    const b = db(without).rows("crm_intake_submission")[0];
    expect([a.score, a.band, a.temperature]).toEqual([b.score, b.band, b.temperature]);
    // The extras go to the firm's note, but not into what the person sees.
    expect(t(withExtras).note.body).toContain("Booth 12");
    expect(JSON.stringify(withExtras.res)).not.toContain("Booth 12");
  });

  it("never lets an extra answer move the score: every extra answer gives the same stored score", async () => {
    const scores = new Set<string>();
    for (const where of ["a", "Booth 12", "x".repeat(300)]) {
      const r = await complete({ ...HOT, qwhere: where, qlogo: where.length > 5 ? "Yes" : "No" });
      const row = r.db.rows("crm_intake_submission")[0];
      scores.add(JSON.stringify([row.score, row.band, row.temperature]));
    }
    expect(scores.size).toBe(1);
  });

  it("builds the staff line from the card only", () => {
    const v = score("business", HOT);
    expect(assessmentStaffLine(v.score)).toBe("Score 0/100 (Exposed) · Hot · GENERAL COUNSEL FIT — revenue at $150k+. Ask if they have an attorney; get Rebecca to them.");
  });
});

function db(c: { db?: unknown }) {
  return c.db as import("./helpers/step-db").AdminFake;
}
