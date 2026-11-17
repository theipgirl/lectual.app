// The one table from what a thing MEANS to the colour it wears. A page asks for a meaning, never a colour.
// Bold is never a meaning: overdue is wine at weight 500.
export type PillTone = "mute" | "ok" | "warn" | "risk" | "ox";

export const MEANING_TONE = {
  /** Needs review, needs attorney, possible duplicate, needs a stage decision, waiting on approval, due this week, Our turn. */
  needsPerson: "warn",
  /** Overdue, expired, past due, last day passed. */
  overdue: "risk",
  /** Failed, couldn't send, rejected, error. */
  wrong: "risk",
  /** Live, paid, approved, connected, signed, sent. */
  done: "ok",
  /** Something Lectual did on its own: moved automatically, internal, drafted by an assistant. */
  ours: "ox",
  /** A stage name, draft, closed, archived, not linked, unknown. */
  neutral: "mute",
} as const satisfies Record<string, PillTone>;

export type Meaning = keyof typeof MEANING_TONE;
export const toneFor = (meaning: Meaning): PillTone => MEANING_TONE[meaning];
