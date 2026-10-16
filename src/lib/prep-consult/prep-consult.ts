/**
 * Pure prep-consult types + the judgment-boundary guard — no database, no AI,
 * no server-only imports. Same discipline as filing-followup.ts (pure logic)
 * vs. filing-followup-action.ts (server-only orchestration): this file is
 * safe for a client component (the lead-detail form) to import directly for
 * its practice-area options, and for a plain unit test to import without
 * mocking anything.
 *
 * Ports the booking-triggered half of the `prep-consult` skill
 * (lectual-plugin skills/prep-consult/SKILL.md) — the HEADS-UP (internal,
 * type = BRIEFING) and CLIENT-PREP EMAIL (client-facing, type = CLIENT_EMAIL)
 * modes. The skill's third mode, the on-demand FULL BRIEF (Nice classes,
 * preliminary risk read, package recommendation), is deliberately NOT built
 * here — that content is attorney judgment, and lawmatics-mcp's
 * src/consult.ts already draws this exact line for its own facts-card cron:
 * "classes, risk read, and package recommendation are attorney judgment ...
 * a deterministic [feature] has no business inventing [them]." This dashboard
 * trigger holds the same line for the AI-assisted booking drafts.
 *
 * Data source: this app has no Lawmatics event/intake integration reachable
 * from a lead record (unlike lawmatics-mcp's src/consult.ts, which reads a
 * live `Appointment Scheduled` activity), so every fact below is staff-typed
 * on the lead detail page rather than auto-detected — matching the skill's
 * own "never invent a time or a link" rule: a blank field stays blank, never
 * guessed.
 */

import { PrepConsultFlowError } from "./errors";

export const PREP_CONSULT_PRACTICE_AREAS = [
  "Trademark",
  "Copyright",
  "Contracts",
  "Entertainment",
  "Business Formation",
  "Other",
] as const;
export type PrepConsultPracticeArea = (typeof PREP_CONSULT_PRACTICE_AREAS)[number];

export type PrepConsultFacts = {
  clientName: string;
  clientEmail: string;
  /** Free text, not the closed enum above — this flow never blocks on an
   * exact match to the dropdown; "Other" plus the inquiry description is
   * enough for the SOP's own fallback ("derive the ask from the
   * description"). */
  practiceArea: string;
  /** The client's own words, staff-transcribed — the ONLY source for the
   * HEADS-UP's "Nature of the matter" and the CLIENT-PREP email's ask list.
   * Never invented; required before either draft is built. */
  inquiryDescription: string;
  /** Staff-typed, human-readable ("Thursday, Aug 28 at 2:00pm ET") — never
   * parsed or validated as a real datetime, matching the SOP's own free-text
   * "[day, date, time, timezone]" template slot. Null/blank means "not yet
   * scheduled," which both templates render as a pending placeholder rather
   * than a guess. */
  sessionWhen: string | null;
  zoomLink: string | null;
};

export type PrepConsultDraft = {
  headline: string;
  summary: string;
  subject: string;
  draftBody: string;
};

/**
 * Hard content guard, run against every drafted body AFTER Claude returns —
 * defense-in-depth behind the system prompt's own hard rules, same
 * discipline lawmatics-mcp/src/consult.ts's tests enforce for its facts
 * card ("no class/package/price ever appears in it"). Booking-triggered
 * drafts are explicitly "no class/risk/package analysis" per the SOP itself
 * (§ HEADS-UP) — a model that slips a Nice class, a risk tier, a package
 * name, or a dollar figure into either draft has produced exactly the
 * attorney-judgment content this flow must never generate, so the draft is
 * refused rather than queued.
 */
const FORBIDDEN_JUDGMENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bclass(?:es)?\s+\d{1,3}\b/i, label: "a Nice classification class number" },
  { re: /\bnice\s+classification\b/i, label: "a Nice classification reference" },
  { re: /\$\s?[\d,]+(?:\.\d{2})?/, label: "a dollar figure" },
  { re: /\b(essential|enhanced|concierge)\s+package\b/i, label: "a package name" },
  { re: /\bpackage\s+recommendation\b/i, label: "a package recommendation" },
  { re: /\b(green|yellow|red)[\s-]?(?:mark|risk)\b/i, label: "a risk-tier call" },
  { re: /\brisk\s+(?:read|assessment|classification)\b/i, label: "a risk assessment" },
];

export function assertNoJudgmentContent(text: string, where: string): void {
  for (const { re, label } of FORBIDDEN_JUDGMENT_PATTERNS) {
    if (re.test(text)) {
      throw new JudgmentBoundaryError(
        `The drafted ${where} contains ${label}, which is attorney judgment this flow must never generate. Refusing to queue it — the full pre-consult brief (classes, risk, package) is attorney-only and not built here.`,
      );
    }
  }
}

/**
 * Extends PrepConsultFlowError (rather than a bare Error) so a single
 * `catch (err) { err instanceof PrepConsultFlowError ? ... }` in the server
 * action still surfaces this as a friendly message — while remaining its own
 * subclass so a judgment-boundary trip (a defect in the prompt or the
 * model's output, never something the caller can fix by re-typing the form)
 * is identifiable in logs/tests as its own thing. See prep-consult/generate.ts.
 */
export class JudgmentBoundaryError extends PrepConsultFlowError {}
