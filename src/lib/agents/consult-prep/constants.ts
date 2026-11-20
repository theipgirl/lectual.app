/** Consult prep's constants, in a leaf module with no imports so pure code (the lead step engine) can read them. */
/** Consult prep takes the consults starting in this many hours after its run. */
export const PREP_WINDOW_HOURS = 24;
/** `payload.source` on the timeline marker consult prep writes per calendar event. */
export const PREP_SOURCE = "consult-prep";
