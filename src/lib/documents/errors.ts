/**
 * User-facing error for the Document Center flows — the message is safe to
 * render directly in a form error (never a stack trace, never "[object
 * Object]"). Distinct from an unexpected/internal failure, which callers
 * should log and show a generic message for instead.
 */
export class DocumentFlowError extends Error {}
