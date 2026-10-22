import type { FirmSession } from "@/lib/firm/session";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import { DEFAULT_FEEDBACK_FROM, FEEDBACK_MAX_CHARS, FEEDBACK_MESSAGES, FEEDBACK_TYPES, type FeedbackType } from "./constants";
import { feedbackBody, feedbackSubject } from "./email";
import type { RateLimiter } from "./rate-limit";
import { parseTrailJson } from "./trail";

/**
 * The rules of Send feedback, with every outside thing passed in so each is tested without a network,
 * a session or a clock. `app/dashboard/feedback-actions.ts` binds the real ones.
 *
 * Internal only: the recipients come from FEEDBACK_TO and nothing else (never from the form or a record),
 * `reply_to` is the sender's own session address, nothing is written to the database, and nothing here is
 * part of the approval queue. Errors are fixed sentences; Resend's reply and exception text are never
 * returned or logged.
 */

export type FeedbackResult = { ok: true } | { ok: false; error: string };

export type FeedbackConfig = { apiKey: string; to: string[]; from: string };

export type FeedbackDeps = {
  session: () => Promise<FirmSession>;
  env: { FEEDBACK_TO?: string; FEEDBACK_FROM?: string; RESEND_API_KEY?: string };
  mail: (mail: InternalMail) => Promise<InternalMailResult>;
  limiter: RateLimiter;
  deployment: () => { vercelEnv: string | null; commitSha: string | null };
};

/** The mail settings, or null when feedback is not set up (no recipients or no key). */
export function feedbackConfig(env: FeedbackDeps["env"]): FeedbackConfig | null {
  const to = (env.FEEDBACK_TO ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const apiKey = env.RESEND_API_KEY?.trim();
  if (to.length === 0 || !apiKey) return null;
  return { apiKey, to, from: env.FEEDBACK_FROM?.trim() || DEFAULT_FEEDBACK_FROM };
}

const refuse = (error: string): FeedbackResult => ({ ok: false, error });

function readType(v: unknown): FeedbackType | null {
  return typeof v === "string" && (FEEDBACK_TYPES as readonly string[]).includes(v) ? (v as FeedbackType) : null;
}

export async function sendFeedback(deps: FeedbackDeps, formData: FormData): Promise<FeedbackResult> {
  try {
    const session = await deps.session();
    if (session.kind === "signed-out") return refuse(FEEDBACK_MESSAGES.signedOut);
    if (session.kind !== "ok" || !session.org?.id) return refuse(FEEDBACK_MESSAGES.noFirm);

    const type = readType(formData.get("type"));
    if (!type) return refuse(FEEDBACK_MESSAGES.badType);
    const rawDescription = formData.get("description");
    if (typeof rawDescription !== "string") return refuse(FEEDBACK_MESSAGES.empty);
    const description = rawDescription.trim();
    if (!description) return refuse(FEEDBACK_MESSAGES.empty);
    if (description.length > FEEDBACK_MAX_CHARS) return refuse(FEEDBACK_MESSAGES.tooLong);

    const config = feedbackConfig(deps.env);
    if (!config) return refuse(FEEDBACK_MESSAGES.notSetUp);

    // Keyed by the session's user id, never by anything posted.
    const key = session.user.id;
    if (!deps.limiter.allowed(key)) return refuse(FEEDBACK_MESSAGES.rateLimited);

    const rawTrail = formData.get("trail");
    const trail = typeof rawTrail === "string" && rawTrail ? parseTrailJson(rawTrail) : null;
    const dep = deps.deployment();
    const senderEmail = session.user.email?.trim() || null;

    const result = await deps.mail({
      apiKey: config.apiKey,
      from: config.from,
      to: config.to,
      replyTo: senderEmail ?? undefined,
      subject: feedbackSubject(type, description),
      text: feedbackBody({
        type,
        description,
        trail,
        context: {
          firmName: session.org.name,
          orgId: session.org.id,
          senderEmail,
          role: session.role,
          actingAsStaff: session.actingAsStaff,
          vercelEnv: dep.vercelEnv,
          commitSha: dep.commitSha,
        },
      }),
      label: "feedback",
    });
    if (result.status !== "sent") return refuse(FEEDBACK_MESSAGES.failed);
    deps.limiter.record(key);
    return { ok: true };
  } catch {
    return refuse(FEEDBACK_MESSAGES.failed);
  }
}
