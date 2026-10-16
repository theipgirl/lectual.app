/**
 * One person's run through the public intake (`crm_intake_submission`, 0079):
 * the JSON shapes the public side writes and the labels the firm reads.
 *
 * Pure. The public page (part 2) WRITES `contact` and `answers` in exactly
 * these shapes; the Performance tab READS them through the lenient parsers
 * below, which never throw — a malformed row renders as "—", not as a crash
 * that hides every other intake.
 */

export type IntakeContact = { name: string; email: string; phone: string; company: string };

/** `id` is the config question's id (null for a question since deleted). The
 * question TEXT is stored too, so an answer still reads correctly after the
 * firm rewords or removes the question. */
export type IntakeAnswer = { id: string | null; question: string; answer: string };

export const SUBMISSION_STATUSES = ["new", "referred", "consult_booked", "engaged", "rejected", "stopped"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_FITS = ["fit", "non_fit", "unscored"] as const;
export type SubmissionFit = (typeof SUBMISSION_FITS)[number];

export const SUBMISSION_MODES = ["conversation", "form"] as const;
export type SubmissionMode = (typeof SUBMISSION_MODES)[number];

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  new: "New",
  referred: "Referred",
  consult_booked: "Consult booked",
  engaged: "Engaged",
  rejected: "Rejected",
  stopped: "Stopped replying",
};

const FIT_LABEL: Record<SubmissionFit, string> = { fit: "Fit", non_fit: "Non-fit", unscored: "Unscored" };

export function isSubmissionStatus(v: unknown): v is SubmissionStatus {
  return typeof v === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(v);
}

export function submissionStatusLabel(s: string): string {
  return isSubmissionStatus(s) ? STATUS_LABEL[s] : s;
}

export function submissionFitLabel(f: string): string {
  return (SUBMISSION_FITS as readonly string[]).includes(f) ? FIT_LABEL[f as SubmissionFit] : "Unscored";
}

/** The design's table says "Chat" for the conversation mode. */
export function submissionModeLabel(m: string): string {
  return m === "conversation" ? "Chat" : m === "form" ? "Form" : m;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseContact(raw: unknown): IntakeContact {
  const r = isRec(raw) ? raw : {};
  return {
    name: s(r.name ?? r.full_name, 200),
    email: s(r.email, 320),
    phone: s(r.phone, 60),
    company: s(r.company, 200),
  };
}

/** Accepts the canonical `{id, question, answer}` objects and the design's
 * `[question, answer]` pairs. Anything else is skipped. */
export function parseAnswers(raw: unknown): IntakeAnswer[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeAnswer[] = [];
  for (const item of raw.slice(0, 200)) {
    if (Array.isArray(item) && item.length >= 2) {
      out.push({ id: null, question: s(item[0], 500), answer: s(item[1], 8000) });
    } else if (isRec(item)) {
      out.push({
        id: typeof item.id === "string" ? item.id : null,
        question: s(item.question ?? item.q, 500),
        answer: s(item.answer ?? item.a, 8000),
      });
    }
  }
  return out.filter((a) => a.question || a.answer);
}
