/** The fixed sentences of the New proposal pre-fill. No imports, so the client form can use the checkbox label alone. */

export const NOT_REVIEWED_NOTE = "Consult details aren't reviewed yet, so marks and classes weren't filled.";
export const REVIEW_ON_LEAD = "Review them on the lead.";
export const UNREADABLE_NOTE = "Consult details couldn't be loaded.";
export const NO_MARKS_NOTE = "The reviewed consult details list no marks, so none were filled.";
export const NO_LEAD_NOTE = "This matter has no linked lead, so there are no consult details to fill from.";
export const USE_CONSULT_LABEL = "Use the marks and classes from the reviewed consult";
export const CHANGED_SINCE_LOAD = "The consult details changed since this page loaded. Reload the page and try again.";

export const packageNote = (asked: string) => `Package from the consult (${asked}) isn't on your list. Choose one.`;
