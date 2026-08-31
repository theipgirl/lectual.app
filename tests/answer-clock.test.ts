import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as answerClockModule from "@/lib/deadlines/answer-clock";
import {
  ANSWER_CLOCK_BASIS,
  ANSWER_WINDOW_DAYS,
  computeAnswerClock,
  landsOnWeekend,
  weekendCaution,
} from "@/lib/deadlines/answer-clock";

const SOURCE_PATH = path.resolve(__dirname, "../src/lib/deadlines/answer-clock.ts");
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

describe("computeAnswerClock — 20-day arithmetic", () => {
  it("counts 20 calendar days from service, then one more for default", () => {
    const clock = computeAnswerClock({ servedOn: "2026-09-01" });
    expect(ANSWER_WINDOW_DAYS).toBe(20);
    expect(clock.servedOn).toBe("2026-09-01");
    expect(clock.answerDue).toBe("2026-09-21");
    expect(clock.defaultEligibleOn).toBe("2026-09-22");
  });

  it("crosses a month boundary", () => {
    const clock = computeAnswerClock({ servedOn: "2026-08-12" });
    expect(clock.answerDue).toBe("2026-09-01");
    expect(clock.defaultEligibleOn).toBe("2026-09-02");
  });

  it("crosses a year boundary", () => {
    const clock = computeAnswerClock({ servedOn: "2026-12-20" });
    expect(clock.answerDue).toBe("2027-01-09");
    expect(clock.defaultEligibleOn).toBe("2027-01-10");
  });

  it("lands on a leap day without skipping it", () => {
    const leap = computeAnswerClock({ servedOn: "2028-02-09" });
    expect(leap.answerDue).toBe("2028-02-29");
    expect(leap.answerDueWeekday).toBe("Tuesday");
    expect(leap.defaultEligibleOn).toBe("2028-03-01");
    expect(leap.defaultEligibleWeekday).toBe("Wednesday");
  });

  it("counts February correctly in a non-leap year", () => {
    expect(computeAnswerClock({ servedOn: "2027-02-09" }).answerDue).toBe("2027-03-01");
  });

  it("counts across a DST change, because civil days have no clock", () => {
    // US DST ends 2026-11-01; the count must still be exactly 20 days.
    expect(computeAnswerClock({ servedOn: "2026-10-20" }).answerDue).toBe("2026-11-09");
    // Spring forward, 2026-03-08.
    expect(computeAnswerClock({ servedOn: "2026-02-25" }).answerDue).toBe("2026-03-17");
  });
});

describe("weekends are surfaced, never rolled", () => {
  it("returns the weekend date itself and names the weekday", () => {
    const clock = computeAnswerClock({ servedOn: "2026-08-16" });
    expect(clock.answerDue).toBe("2026-09-05");
    expect(clock.answerDueWeekday).toBe("Saturday");
    // The date is NOT moved to the following Monday. Rolling it would be a
    // legal determination this product does not make.
    expect(clock.answerDue).not.toBe("2026-09-07");
    expect(landsOnWeekend(clock)).toBe(true);
    expect(weekendCaution(clock)).toMatch(/Saturday/);
    expect(weekendCaution(clock)).toMatch(/does not move it/);
  });

  it("stays silent when the date is a weekday", () => {
    const clock = computeAnswerClock({ servedOn: "2026-09-01" });
    expect(clock.answerDueWeekday).toBe("Monday");
    expect(landsOnWeekend(clock)).toBe(false);
    expect(weekendCaution(clock)).toBeNull();
  });

  it("never proposes an alternative date anywhere in its output", () => {
    const clock = computeAnswerClock({ servedOn: "2026-08-16" });
    expect(Object.values(clock).filter((v) => v === "2026-09-07")).toHaveLength(0);
  });
});

describe("the result is always a suggestion", () => {
  it("stamps kind:'suggestion' on every result", () => {
    const served = [
      "2026-01-01",
      "2026-02-14",
      "2026-08-16",
      "2027-02-09",
      "2028-02-09",
      "2026-12-20",
    ];
    for (const servedOn of served) {
      expect(computeAnswerClock({ servedOn }).kind).toBe("suggestion");
    }
  });

  it("carries a basis sentence that names the rule as the attorney's own", () => {
    const { basis } = computeAnswerClock({ servedOn: "2026-09-01" });
    expect(basis).toBe(ANSWER_CLOCK_BASIS);
    expect(basis).toMatch(/20 days from the date of service/);
    expect(basis).toMatch(/Attorney's own standing rule/);
    expect(basis).toMatch(/verify/i);
  });

  it("refuses a date it cannot count from rather than guessing", () => {
    expect(() => computeAnswerClock({ servedOn: "2026-02-30" })).toThrow(/civil date/);
    expect(() => computeAnswerClock({ servedOn: "08/16/2026" })).toThrow(/civil date/);
    expect(() => computeAnswerClock({ servedOn: "" })).toThrow(/civil date/);
  });
});

describe("the module cannot write", () => {
  it("exports no function whose name suggests a write", () => {
    const writerish = /^(create|write|save|insert|upsert|update|delete|docket|persist|set|add)/i;
    const offenders = Object.keys(answerClockModule).filter((name) => writerish.test(name));
    expect(offenders).toEqual([]);
  });

  it("exports only pure computation and constants", () => {
    expect(Object.keys(answerClockModule).sort()).toEqual([
      "ANSWER_CLOCK_BASIS",
      "ANSWER_WINDOW_DAYS",
      "DEFAULT_ELIGIBLE_OFFSET_DAYS",
      "SUGGESTION_NOTICE",
      "computeAnswerClock",
      "landsOnWeekend",
      "weekendCaution",
    ]);
  });

  it("imports nothing that could reach the database", () => {
    for (const forbidden of [
      "getScopedClient",
      "@supabase",
      "supabase",
      "server-only",
      ".insert(",
      ".upsert(",
      ".update(",
      ".from(",
    ]) {
      expect(SOURCE.includes(forbidden), `answer-clock.ts must not reference ${forbidden}`).toBe(
        false,
      );
    }
  });

  it("never produces source: 'calculated'", () => {
    // The UPL firewall, enforced structurally: a docketed suggestion is written
    // source='manual' with the basis recorded, never as a calculated date.
    expect(SOURCE).not.toMatch(/source\s*:\s*["']calculated["']/);
    const clock: Record<string, unknown> = { ...computeAnswerClock({ servedOn: "2026-09-01" }) };
    expect(Object.values(clock)).not.toContain("calculated");
  });
});
