import { createRateLimiter } from "@/lib/feedback/rate-limit";

/**
 * Courtesy limit on "Continue to Adobe to sign": 10 presses per proposal token per hour, in memory per server instance (like
 * `review-limit.ts`: on serverless it is not a hard cap). Checked BEFORE anything is read. The key is the token's sha256, so the
 * token itself is never a map key.
 */
export const ADOBE_START_PER_TOKEN = 10;
export const ADOBE_START_WINDOW_MS = 60 * 60 * 1000;
export const adobeStartTokenLimiter = createRateLimiter({ max: ADOBE_START_PER_TOKEN, windowMs: ADOBE_START_WINDOW_MS });
