import type { StageOpt } from "../../src/lib/reconcile/types";

/** Fixed ids so assertions read well. */
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const S = {
  newPnc: uuid("5a000000", 1),
  pnc: uuid("5a000000", 2),
  consult: uuid("5a000000", 3),
  questionnaire: uuid("5a000000", 4),
  post: uuid("5a000000", 5),
  undecided: uuid("5a000000", 6),
  loe: uuid("5a000000", 7),
  signed: uuid("5a000000", 8),
  nurture: uuid("5a000000", 9),
  lost: uuid("5a000000", 10),
} as const;

/** An RPB-style pipeline with a questionnaire stage: the default names all resolve. */
export const FIRM: StageOpt[] = [
  { id: S.newPnc, name: "New PNC", category: "open", orderIndex: 1 },
  { id: S.pnc, name: "Potential New Client", category: "open", orderIndex: 2 },
  { id: S.consult, name: "Consultation Scheduled", category: "open", orderIndex: 3 },
  { id: S.questionnaire, name: "Questionnaire Sent", category: "open", orderIndex: 4 },
  { id: S.post, name: "Post Consultation Email Sent", category: "open", orderIndex: 5 },
  { id: S.undecided, name: "Undecided / Questions", category: "open", orderIndex: 6 },
  { id: S.loe, name: "LOE & Invoice Sent", category: "open", orderIndex: 7 },
  { id: S.signed, name: "Signed LOE / Deposit Received", category: "won", orderIndex: 8 },
  { id: S.nurture, name: "Nurture", category: "nurture", orderIndex: 9 },
  { id: S.lost, name: "Lost", category: "lost", orderIndex: 10 },
];

/** The seven-stage default every new org is seeded with (lectual 0028, Hartwell IP). */
export const H = {
  inquiry: uuid("5b000000", 1),
  discovery: uuid("5b000000", 2),
  strategy: uuid("5b000000", 3),
  engagement: uuid("5b000000", 4),
  active: uuid("5b000000", 5),
  nurture: uuid("5b000000", 6),
  lost: uuid("5b000000", 7),
} as const;

export const HARTWELL: StageOpt[] = [
  { id: H.inquiry, name: "New Inquiry", category: "open", orderIndex: 1 },
  { id: H.discovery, name: "Discovery Call", category: "open", orderIndex: 2 },
  { id: H.strategy, name: "Strategy Session", category: "open", orderIndex: 3 },
  { id: H.engagement, name: "Engagement Letter", category: "open", orderIndex: 4 },
  { id: H.active, name: "Active Matter", category: "won", orderIndex: 5 },
  { id: H.nurture, name: "Nurture", category: "nurture", orderIndex: 6 },
  { id: H.lost, name: "Lost", category: "lost", orderIndex: 7 },
];

export const L = {
  amara: uuid("1ead0000", 1),
  kwame: uuid("1ead0000", 2),
  priya: uuid("1ead0000", 3),
  other: uuid("1ead0000", 99),
} as const;

export const ORG = "11111111-1111-1111-1111-111111111111";
export const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
/** The run clock in tests/agents/helpers.ts. */
export const NOW_MS = Date.parse("2026-09-25T12:00:00Z");
export const daysAgo = (n: number, from = NOW_MS) => new Date(from - n * 86_400_000).toISOString();
export const daysAhead = (n: number, from = NOW_MS) => new Date(from + n * 86_400_000).toISOString();

/** Planted in every field the agent must never copy. */
export const SENTINEL = "SENTINEL-9f3a2c-do-not-copy";

export const stage = (id: string) => FIRM.find((s) => s.id === id)!;
