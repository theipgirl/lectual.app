import { describe, expect, it } from "vitest";
import {
  boothAnswerPairs,
  boothChoices,
  boothMedianMs,
  boothVariantOf,
  dropOffByQuestion,
  eventStats,
  eventSummaries,
  eventVariant,
  inEventRange,
  parseEventRange,
  sampleFromBooth,
  type BoothResultRow,
} from "@/lib/intake-forms/booth-results";

/** Sprint 9 F3 (labels, variant), F10 (drop-off) and F11 (booth median). */

const t = (min: number) => new Date(Date.UTC(2026, 9, 17, 15, 0) + min * 60_000).toISOString();

function row(over: Partial<BoothResultRow> & { id: string }): BoothResultRow {
  return {
    event_code: "urban-golf-2026",
    track: null,
    score: null,
    band: null,
    temperature: null,
    answers: {},
    gaps: [],
    created_at: t(0),
    completed_at: null,
    ...over,
  };
}

const BUSINESS_FULL = { "1": "business", "2": "no", "3": "4_10", "4": "over_1m", "5": "applied", "6": "partial", "7": "none", "8": "right_away" };
const IP_FULL = { "101": "brand", "102": "no", "103": "self", "104": "unsure", "105": "yes", "106": "some", "107": "none", "108": "250k_500k", "109": "1_2_months" };

describe("which card a scorecard was taken on", () => {
  it("reads the variant from the answer ids", () => {
    expect(boothVariantOf(BUSINESS_FULL)).toBe("business");
    expect(boothVariantOf(IP_FULL)).toBe("ip");
    expect(boothVariantOf({})).toBeNull();
    expect(boothVariantOf(null)).toBeNull();
    expect(boothVariantOf({ "2": "yes", "102": "no" })).toBeNull();
  });

  it("takes an event's variant from rows that have answers, Business when none does", () => {
    expect(eventVariant([{ answers: {} }, { answers: IP_FULL }, { answers: IP_FULL }, { answers: BUSINESS_FULL }])).toBe("ip");
    expect(eventVariant([{ answers: {} }, { answers: {} }])).toBe("business");
    expect(eventVariant([])).toBe("business");
  });
});

describe("answers with the card's labels (F3)", () => {
  it("renders a Business card in card order with option labels", () => {
    const pairs = boothAnswerPairs(BUSINESS_FULL, "business");
    expect(pairs.map((p) => p.question)).toEqual([
      "Do you have a business, a personal brand, or both?",
      "Have you formed an entity with the state?",
      "How many employees or independent contractors do you have?",
      "What is your annual revenue?",
      "Is your business name or logo federally registered?",
      "Does your business own its intellectual property?",
      "Is your revenue protected by contracts?",
      "How quickly are you looking to engage legal assistance?",
    ]);
    expect(pairs.map((p) => p.answer)).toEqual(["A business", "No", "4–10", "$1M+", "Application pending", "Some of it", "No, nothing is in writing", "Right away"]);
  });

  it("renders an IP card from ids of 100 and over, with the brand track's wording", () => {
    const pairs = boothAnswerPairs(IP_FULL, "brand");
    expect(pairs[1]).toEqual({ question: "Is your brand name or logo federally registered as a trademark?", answer: "No" });
    expect(pairs.find((p) => p.question.startsWith("Before you chose"))?.answer).toBe("I searched online myself");
    expect(pairs).toHaveLength(9);
  });

  it("takes the track from the answer when the row has none (a contact-first row)", () => {
    const pairs = boothAnswerPairs({ "1": "brand", "2": "no" }, null);
    expect(pairs[1].question).toBe("Is there an entity behind the brand?");
  });

  it("shows every chosen label of a multi-select answer and an unknown id or value as stored", () => {
    const pairs = boothAnswerPairs({ "1": ["business", "brand"], "2": "maybe", "77": "odd", "5": "registered" }, "business");
    expect(pairs.find((p) => p.question.startsWith("Do you have a business"))?.answer).toBe("A business, A personal brand");
    expect(pairs.find((p) => p.question.startsWith("Have you formed"))?.answer).toBe("maybe");
    expect(pairs.at(-1)).toEqual({ question: "Question 77", answer: "odd" });
  });

  it("returns nothing for no answers, and never throws on odd shapes", () => {
    expect(boothAnswerPairs({}, null)).toEqual([]);
    expect(boothAnswerPairs(null, null)).toEqual([]);
    expect(boothAnswerPairs("junk", "business")).toEqual([]);
    expect(boothChoices({ "2": 5, "3": ["a", 1, "b"], x: "y", "4": "  " })).toEqual({ 3: ["a", "b"] });
  });

  it("turns a scorecard into a sample with its stored gaps", () => {
    const s = sampleFromBooth(row({ id: "a", completed_at: t(3), score: 40, band: "partial", temperature: "hot", gaps: ["One gap"], answers: BUSINESS_FULL }));
    expect(s).toMatchObject({ finished: true, score: 40, band: "partial", temperature: "hot", gaps: ["One gap"] });
    expect(s.choices[5]).toEqual(["applied"]);
    expect(sampleFromBooth(row({ id: "b" })).finished).toBe(false);
  });
});

describe("drop-off by question (F10)", () => {
  const unfinished = (id: string, answers: Record<string, string>) => row({ id, answers });

  it("counts three unfinished cards at the three questions they stopped at, in card order", () => {
    const rows = [
      unfinished("a", { "1": "business" }),
      unfinished("b", { "1": "business", "2": "yes", "3": "0_3" }),
      unfinished("c", { "1": "brand", "2": "no", "3": "4_10", "4": "over_1m", "5": "no", "6": "no" }),
      row({ id: "done", completed_at: t(5), answers: BUSINESS_FULL }),
    ];
    const d = dropOffByQuestion(rows, "business");
    expect(d.unfinished).toBe(3);
    expect(d.recorded).toBe(true);
    expect(d.steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.steps.filter((s) => s.count > 0).map((s) => [s.id, s.count])).toEqual([
      [2, 1],
      [4, 1],
      [7, 1],
    ]);
    expect(d.atEnd).toBe(0);
  });

  it("never counts a finished card, however few answers it has", () => {
    const d = dropOffByQuestion([row({ id: "x", completed_at: t(1), answers: {} })], "business");
    expect(d.unfinished).toBe(0);
    expect(d.steps.every((s) => s.count === 0)).toBe(true);
  });

  it("skips a question the card doesn't ask for these answers", () => {
    // IP card: "Do you create original content?" = no, so the copyright (106) and ownership (107) questions are never asked.
    const d = dropOffByQuestion([unfinished("a", { "101": "business", "102": "no", "103": "no", "104": "no", "105": "no" })], "ip");
    expect(d.steps.find((s) => s.id === 106)?.count).toBe(0);
    expect(d.steps.find((s) => s.id === 107)?.count).toBe(0);
    expect(d.steps.find((s) => s.id === 108)?.count).toBe(1);
    // With "yes" the same card stops at 106.
    const yes = dropOffByQuestion([unfinished("b", { "101": "business", "102": "no", "103": "no", "104": "no", "105": "yes" })], "ip");
    expect(yes.steps.find((s) => s.id === 106)?.count).toBe(1);
  });

  it("flags 'not recorded' when every unfinished card has no answers, and does not present it as a finding", () => {
    const d = dropOffByQuestion([unfinished("a", {}), unfinished("b", {}), row({ id: "c", completed_at: t(2), answers: BUSINESS_FULL })], "business");
    expect(d.unfinished).toBe(2);
    expect(d.recorded).toBe(false);
  });

  it("counts a card with every asked question answered but no finish as 'at end', not as a stop", () => {
    const d = dropOffByQuestion([unfinished("a", BUSINESS_FULL)], "business");
    expect(d.atEnd).toBe(1);
    expect(d.steps.every((s) => s.count === 0)).toBe(true);
  });
});

describe("started, finished and the median time (F11)", () => {
  it("takes completed_at minus created_at over finished cards", () => {
    const rows = [
      row({ id: "a", created_at: t(0), completed_at: t(2) }),
      row({ id: "b", created_at: t(0), completed_at: t(6) }),
      row({ id: "c", created_at: t(0), completed_at: null }),
    ];
    expect(boothMedianMs(rows)).toBe(4 * 60_000);
    expect(eventStats(rows)).toEqual({ started: 3, finished: 2, completionRate: "66.7%", medianMs: 4 * 60_000 });
  });

  it("handles an odd count, ignores negative and unparseable durations, and gives null for none", () => {
    expect(boothMedianMs([row({ id: "a", created_at: t(0), completed_at: t(3) })])).toBe(3 * 60_000);
    expect(
      boothMedianMs([
        row({ id: "a", created_at: t(0), completed_at: t(1) }),
        row({ id: "b", created_at: t(5), completed_at: t(1) }),
        row({ id: "c", created_at: "nonsense", completed_at: t(1) }),
        row({ id: "d", created_at: t(0), completed_at: t(3) }),
        row({ id: "e", created_at: t(0), completed_at: t(9) }),
      ]),
    ).toBe(3 * 60_000);
    expect(boothMedianMs([])).toBeNull();
    expect(eventStats([])).toEqual({ started: 0, finished: 0, completionRate: "—", medianMs: null });
  });

  it("summarises per event code, most recently active first", () => {
    const rows = [
      row({ id: "1", event_code: "story2profit-2026", created_at: t(500), completed_at: t(502) }),
      row({ id: "2", event_code: "urban-golf-2026", created_at: t(0), completed_at: t(4) }),
      row({ id: "3", event_code: "urban-golf-2026", created_at: t(1), completed_at: null }),
    ];
    const s = eventSummaries(rows);
    expect(s.map((e) => e.code)).toEqual(["story2profit-2026", "urban-golf-2026"]);
    expect(s[1]).toMatchObject({ started: 2, finished: 1, completionRate: "50.0%", medianMs: 4 * 60_000 });
    expect(eventSummaries([])).toEqual([]);
  });
});

describe("event range", () => {
  it("defaults to all time and accepts 7, 30 and 90", () => {
    expect(parseEventRange(undefined)).toBe("all");
    expect(parseEventRange("all")).toBe("all");
    expect(parseEventRange("7")).toBe(7);
    expect(parseEventRange("90")).toBe(90);
    expect(parseEventRange("365")).toBe("all");
  });

  it("filters by created_at against the given clock", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
    const rows = [row({ id: "a", created_at: day(1) }), row({ id: "b", created_at: day(20) }), row({ id: "c", created_at: day(60) })];
    expect(inEventRange(rows, 7, now).map((r) => r.id)).toEqual(["a"]);
    expect(inEventRange(rows, 30, now).map((r) => r.id)).toEqual(["a", "b"]);
    expect(inEventRange(rows, 90, now)).toHaveLength(3);
    expect(inEventRange(rows, "all", now)).toHaveLength(3);
  });
});
