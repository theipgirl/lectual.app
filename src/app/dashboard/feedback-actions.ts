"use server";

import { env } from "@/lib/env";
import { resolveFirmSession } from "@/lib/firm/session";
import { sendInternalMail } from "@/lib/mail/internal-mail";
import { feedbackLimiter } from "@/lib/feedback/rate-limit";
import { sendFeedback, type FeedbackResult } from "@/lib/feedback/submit";

/**
 * "Send feedback": emails Lectual (FEEDBACK_TO) one message with the person's description and their
 * session transcript. Any signed-in member may send. Session only: no database client, no admin client,
 * no write. See src/lib/feedback/submit.ts for the rules.
 */
export async function sendFeedbackAction(formData: FormData): Promise<FeedbackResult> {
  return sendFeedback(
    {
      session: () => resolveFirmSession(),
      env: { FEEDBACK_TO: env.FEEDBACK_TO, FEEDBACK_FROM: env.FEEDBACK_FROM, RESEND_API_KEY: env.RESEND_API_KEY },
      mail: sendInternalMail,
      limiter: feedbackLimiter,
      deployment: () => ({ vercelEnv: process.env.VERCEL_ENV ?? null, commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null }),
    },
    formData,
  );
}
