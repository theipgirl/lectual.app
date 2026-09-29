/**
 * User-facing error for the prep-consult flow — the message is safe to
 * render directly in a form error (never a stack trace). Same shape as
 * src/lib/documents/errors.ts's DocumentFlowError and
 * src/lib/welcome/errors.ts's WelcomeFlowError, kept as its own class so
 * this flow's errors are never accidentally caught by the wrong handler.
 */
export class PrepConsultFlowError extends Error {}
