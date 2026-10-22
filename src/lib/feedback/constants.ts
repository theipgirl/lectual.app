export const FEEDBACK_TYPES = ["bug", "request", "question", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  request: "Request",
  question: "Question",
  other: "Other",
};

export const FEEDBACK_MAX_CHARS = 5_000;
export const FEEDBACK_SUBJECT_CHARS = 60;

/** Shown in the dialog exactly as written; a test compares it with a literal. */
export const FEEDBACK_DISCLOSURE =
  "This report will include your description and the current session transcript. We may use these to debug related issues and improve Lectual.";

/** Dispatched on `window` by the account menu and the Getting started footer; the one dialog listens. */
export const SHOW_FEEDBACK_EVENT = "lectual:show-feedback";

export const DEFAULT_FEEDBACK_FROM = "Lectual feedback <noreply@lectual.app>";

export const FEEDBACK_MESSAGES = {
  signedOut: "Please sign in again to send feedback.",
  noFirm: "We couldn't tell which firm you're working in, so the feedback wasn't sent.",
  badType: "Choose Bug, Request, Question or Other.",
  empty: "Write a few words about what happened or what you need.",
  tooLong: "That is too long. Please keep it to 5,000 characters or fewer.",
  notSetUp: "Feedback isn't set up yet.",
  rateLimited: "You've sent a lot of feedback just now. Please try again later.",
  failed: "We couldn't send your feedback. Please try again in a moment.",
  sent: "Thanks. Your feedback was sent.",
} as const;
