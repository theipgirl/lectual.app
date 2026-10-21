// Which card questions a firm may hide from its assessment (Sprint 10).
//
// A question is hideable only if it is UNSCORED and NOTHING reads it: not the
// card's scorer (track, revenue, timeline, the name-conflict answer) and not
// another question's asking rule (`showWhen`). Hiding anything else would
// change the temperature, the Lawmatics "Hot/Warm/Cold Lead" tag, the staff
// prompt or which scored questions are asked.
//
// This list is explicit on purpose, and tests/intake-forms/assessment-extras.test.ts
// proves it both ways: every hideable question changes nothing, and every other
// unscored question really is load-bearing. A card change that makes either
// false fails that test, so the rule cannot drift silently.

import type { BoothVariantId } from "./variants";

export const HIDEABLE_CARD_QUESTIONS: Record<BoothVariantId, readonly number[]> = {
  // Team size (3): a qualifier no scorer line reads.
  business: [3],
  // The Trademark & Copyright card's unscored questions all feed the scorer or the asking rule.
  ip: [],
};

export function isHideable(variant: BoothVariantId, questionId: number | string): boolean {
  return HIDEABLE_CARD_QUESTIONS[variant].includes(Number(questionId));
}

export const NOT_HIDEABLE_REASON = "This question feeds the score, the hot, warm or cold call, or which questions are asked, so it can't be hidden.";
