import { describe, it, expect } from "vitest";
import {
  PREP_CONSULT_PRACTICE_AREAS,
  assertNoJudgmentContent,
  JudgmentBoundaryError,
} from "@/lib/prep-consult/prep-consult";
import { PrepConsultFlowError } from "@/lib/prep-consult/errors";

describe("PREP_CONSULT_PRACTICE_AREAS", () => {
  it("includes the practice areas the SOP's routing/ask table covers", () => {
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Trademark");
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Copyright");
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Contracts");
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Entertainment");
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Business Formation");
    expect(PREP_CONSULT_PRACTICE_AREAS).toContain("Other");
  });
});

describe("assertNoJudgmentContent", () => {
  it("passes clean, booking-only content", () => {
    expect(() =>
      assertNoJudgmentContent(
        "Hi Rebecca, you have a strategy session with Jane Doe Thursday at 2pm ET.",
        "consult heads-up",
      ),
    ).not.toThrow();
  });

  it.each([
    ["Class 25", "a Nice class number"],
    ["classes 25 and 35", "a Nice class number (plural)"],
    ["Nice Classification", "a Nice classification reference"],
    ["$1,950", "a dollar figure"],
    ["the Essential package", "a package name"],
    ["Enhanced package pricing", "a package name"],
    ["Package recommendation: Essential", "a package recommendation phrase"],
    ["this looks like a GREEN mark", "a risk-tier call"],
    ["a yellow-risk mark", "a risk-tier call"],
    ["preliminary risk read follows", "a risk assessment phrase"],
  ])("refuses content containing %j (%s)", (snippet) => {
    expect(() => assertNoJudgmentContent(`Some text. ${snippet}. More text.`, "test draft")).toThrow(
      JudgmentBoundaryError,
    );
  });

  it("JudgmentBoundaryError is a PrepConsultFlowError, so one catch handles both", () => {
    try {
      assertNoJudgmentContent("Filed under Class 25.", "test draft");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PrepConsultFlowError);
      expect(err).toBeInstanceOf(JudgmentBoundaryError);
    }
  });

  it("does not false-positive on ordinary prose that happens to contain 'class' loosely", () => {
    // "class" without a following number, and "risk" without one of the
    // gated phrases, must not trip the guard — over-blocking legitimate
    // booking content is its own failure mode.
    expect(() =>
      assertNoJudgmentContent(
        "The client mentioned they run a high-end fitness class business and want to protect the name. There's some risk they haven't used it in commerce yet.",
        "test draft",
      ),
    ).not.toThrow();
  });
});
