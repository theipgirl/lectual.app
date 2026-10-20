/**
 * The consult outcomes a person can log on a lead, and their words. Pure (no
 * server imports) because the timeline wording and the lead-page form both read
 * it. The server half lives in ./consult-outcome.ts.
 */
export const CONSULT_OUTCOMES = ["no_show", "reschedule_requested", "rebooked_after_no_show"] as const;
export type ConsultOutcome = (typeof CONSULT_OUTCOMES)[number];

export const CONSULT_OUTCOME_LABEL: Record<ConsultOutcome, string> = {
  no_show: "No-show",
  reschedule_requested: "Asked to reschedule",
  rebooked_after_no_show: "Rebooked after no-show",
};

export function isConsultOutcome(value: unknown): value is ConsultOutcome {
  return typeof value === "string" && (CONSULT_OUTCOMES as readonly string[]).includes(value);
}
