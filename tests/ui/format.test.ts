import { describe, expect, it } from "vitest";
import { formatMoney, personName, showingOf } from "@/lib/ui/format";
import { BLANK, TEAMMATE, lastContactAgo, yesVerb } from "@/lib/ui/words";
import { MEANING_TONE, toneFor } from "@/lib/ui/tones";

describe("formatMoney", () => {
  it("prints whole dollars plainly", () => {
    expect(formatMoney(495000)).toBe("$4,950");
    expect(formatMoney(0)).toBe("$0");
  });
  it("shows cents only when there are some", () => {
    expect(formatMoney(495050)).toBe("$4,950.50");
    expect(formatMoney(5)).toBe("$0.05");
  });
  it("puts the minus sign first", () => {
    expect(formatMoney(-50000)).toBe("-$500");
  });
  it("reads a non-number as the blank", () => {
    expect(formatMoney(Number.NaN)).toBe(BLANK);
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe(BLANK);
  });
});

describe("personName", () => {
  const names = new Map([["a", "Rayn Lee"]]);
  it("finds a person, treats no id as null and an unknown id as Teammate", () => {
    expect(personName("a", names)).toBe("Rayn Lee");
    expect(personName(null, names)).toBeNull();
    expect(personName(undefined, names)).toBeNull();
    expect(personName("zzz", names)).toBe(TEAMMATE);
  });
});

describe("shared words", () => {
  it("showingOf reads 'Showing 40 of 112'", () => {
    expect(showingOf(40, 112)).toBe("Showing 40 of 112");
  });
  it("lastContactAgo and yesVerb", () => {
    expect(lastContactAgo(0)).toBe("Last contact today");
    expect(lastContactAgo(1)).toBe("Last contact 1 day ago");
    expect(lastContactAgo(4)).toBe("Last contact 4 days ago");
    expect(yesVerb(" Remove ")).toBe("Yes, remove");
  });
});

describe("meaning to tone", () => {
  it("is one table: overdue and wrong are wine, needs-a-person is warn, done is ok, ours is ox, neutral is mute", () => {
    expect(MEANING_TONE).toEqual({ needsPerson: "warn", overdue: "risk", wrong: "risk", done: "ok", ours: "ox", neutral: "mute" });
    expect(toneFor("overdue")).toBe("risk");
  });
});
