/**
 * What the Intake numbers count, defined once.
 *
 * The rail's Intake badge and the Intake page's PNC list use ONE scope: a lead
 * in an intake-category stage (src/lib/intake/scope.ts) whose practice area is
 * unset or trademark. `INTAKE_PRACTICE_AREA_FILTER` is that second half as the
 * PostgREST filter, shared by listIntakeLeads and the rail count so the two
 * cannot drift. The rail count is that list's length.
 *
 * The Pipeline's first column is a different question on purpose: leads still
 * BEFORE a consult (any practice area), plus public-form submissions that have
 * not become leads yet, so it is usually a different number. Each says what it
 * counts, from the strings below, instead of one pretending to be the other.
 */
export const INTAKE_PRACTICE_AREA_FILTER = "practice_area.is.null,practice_area.ilike.%trademark%";

/** Tooltip on a rail badge, keyed by nav slug. */
export const RAIL_COUNT_TITLE: Readonly<Record<string, string>> = {
  intake: "Trademark leads in a lead stage, consult stages included (the Leads list)",
  matters: "Open matters",
};

/** The Pipeline's first column: what it holds and why it can differ from the rail's Intake badge. */
export const PIPELINE_INTAKE_HINT =
  "Leads not yet at a consult (any practice area) plus form submissions not yet leads. The number beside Leads in the left menu also counts consult stages and only trademark leads.";
