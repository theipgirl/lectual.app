// Gap copy is descriptive, never advice: the booth must never read as legal advice.

import { IMMEDIATE_TIMELINE, shouldAsk, trackFor, type BoothIpCategory } from "./questions";
import {
  IP_Q_CONFLICT,
  IP_Q_REVENUE,
  IP_Q_TIMELINE,
  IP_Q_TRACK,
  ipQuestions,
} from "./ip-questions";
import {
  bandFor,
  first,
  nextStepFor,
  valueBandFor,
  GC_STAFF_PROMPT,
  POINTS_PER_CATEGORY,
  SUBSTANTIAL,
  type BoothAnswers,
  type BoothScore,
  type BoothTemperature,
} from "./score";

const IP_GAP_COPY: Record<BoothIpCategory, { none: string; partial: string }> = {
  trademark: {
    none: "Your name and logo are not federally registered.",
    partial: "Your trademark application is filed and awaiting registration.",
  },
  clearance: {
    none: "No trademark search was done before choosing your name.",
    partial: "Your name was searched online, not with a full trademark search.",
  },
  copyright: {
    none: "Your most valuable work is not registered with the Copyright Office.",
    partial: "Only some of your work is registered with the Copyright Office.",
  },
  ownership: {
    none: "No written agreements confirm you own work others helped create.",
    partial: "Only some of the work others helped create is covered by written agreements.",
  },
};

const IP_GAP_PRIORITY: BoothIpCategory[] = ["trademark", "clearance", "copyright", "ownership"];

export const IP_CONFLICT_STAFF_PROMPT =
  "NAME CONFLICT — they have seen a similar name or been contacted. Get Rebecca to them.";

export function calculateIpBoothScore(answers: BoothAnswers): BoothScore {
  const track = trackFor(answers[IP_Q_TRACK]);
  const revenue = first(answers[IP_Q_REVENUE]);
  const timeline = first(answers[IP_Q_TIMELINE]);
  const conflictAnswer = first(answers[IP_Q_CONFLICT]);

  const breakdown: { category: BoothIpCategory; earned: number; possible: number }[] = [];
  let earned = 0;
  let possible = 0;

  for (const q of ipQuestions) {
    if (!q.category) continue;
    if (!shouldAsk(q, answers)) continue;
    const option = q.options.find((o) => o.value === first(answers[q.id]));
    const points = option?.points ?? 0;
    earned += points;
    possible += POINTS_PER_CATEGORY;
    breakdown.push({
      category: q.category as BoothIpCategory,
      earned: points,
      possible: POINTS_PER_CATEGORY,
    });
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const band = bandFor(score);

  const open = breakdown.filter((b) => b.earned < b.possible);
  open.sort((a, b) => {
    if (a.earned !== b.earned) return a.earned - b.earned;
    return IP_GAP_PRIORITY.indexOf(a.category) - IP_GAP_PRIORITY.indexOf(b.category);
  });
  const gaps = open
    .slice(0, 3)
    .map((b) => (b.earned === 0 ? IP_GAP_COPY[b.category].none : IP_GAP_COPY[b.category].partial));

  const readyNow = timeline === IMMEDIATE_TIMELINE;
  const substantial = SUBSTANTIAL.has(revenue);
  const hasGaps = score < 70;
  const conflict = conflictAnswer === "yes";
  const gcProspect = substantial;

  let temperature: BoothTemperature;
  if (conflict || (readyNow && (substantial || hasGaps))) {
    temperature = "hot";
  } else if (readyNow || substantial || hasGaps || conflictAnswer === "unsure") {
    temperature = "warm";
  } else {
    temperature = "cold";
  }

  const staffPrompt = conflict
    ? IP_CONFLICT_STAFF_PROMPT
    : gcProspect
      ? GC_STAFF_PROMPT
      : temperature === "hot"
        ? "They said right away. Book the consultation before they walk away."
        : temperature === "warm"
          ? "Capture cleanly. The follow-up does the work."
          : "Thank them. The follow-up does the work.";

  return {
    track,
    score,
    band,
    temperature,
    gaps,
    nextStep: nextStepFor(temperature, band),
    staffPrompt,
    valueBand: valueBandFor(revenue),
    breakdown,
    readyNow,
    gcProspect,
  };
}
