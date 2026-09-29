/**
 * User-facing error for the welcome-email flow — the message is safe to
 * render directly in a form error (never a stack trace). Same shape as
 * src/lib/documents/errors.ts's DocumentFlowError, kept as its own class so
 * the two flows' errors are never accidentally caught by the wrong handler.
 */
export class WelcomeFlowError extends Error {}
