import { createRateLimiter } from "@/lib/feedback/rate-limit";

/**
 * Rate limit for the anonymous review-copy PDF. In memory and per server instance: on serverless it is a courtesy limit, not
 * a hard cap, the same way the feedback limiter is (`src/lib/feedback/rate-limit.ts`). The quote page's actions have none at
 * all (`src/app/q/[token]/actions.ts`); this is the first limiter on a public action.
 *
 * Two keys per call: the token (a PDF is cheap for the server but not free) and the caller's network address. Keys are hashed
 * by the caller so the token itself is never held as a map key longer than the call.
 */
export const REVIEW_PDF_PER_TOKEN = 20;
export const REVIEW_PDF_PER_ADDRESS = 60;
export const REVIEW_PDF_WINDOW_MS = 60 * 60 * 1000;

export const reviewTokenLimiter = createRateLimiter({ max: REVIEW_PDF_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
export const reviewAddressLimiter = createRateLimiter({ max: REVIEW_PDF_PER_ADDRESS, windowMs: REVIEW_PDF_WINDOW_MS });

/**
 * The SIGNED letter's download is the other anonymous PDF action, with the same limits and its OWN counters, so a client who
 * downloaded many review copies can still download their signed letter (and the other way round). The same kind of limiter,
 * with the same caveat: in memory, per server instance.
 */
export const signedTokenLimiter = createRateLimiter({ max: REVIEW_PDF_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
export const signedAddressLimiter = createRateLimiter({ max: REVIEW_PDF_PER_ADDRESS, windowMs: REVIEW_PDF_WINDOW_MS });

/**
 * The client's address, written to the firm's Lawmatics when they press Continue on "Your details" (`savePublicDetailsAddress`).
 * Its OWN counters, lower than the PDFs': each allowed call can reach Lawmatics. The same caveat: in memory, per server instance.
 */
export const DETAILS_ADDRESS_PER_TOKEN = 10;
export const DETAILS_ADDRESS_PER_ADDRESS = 30;
export const detailsTokenLimiter = createRateLimiter({ max: DETAILS_ADDRESS_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
export const detailsAddressLimiter = createRateLimiter({ max: DETAILS_ADDRESS_PER_ADDRESS, windowMs: REVIEW_PDF_WINDOW_MS });

/*
 * lectual 0117 (Sprint A): the emailed signing link. Each its OWN counters, the same caveat: in memory, per server instance, so
 * they are COURTESY limits, not hard caps. Keys are hashed by the caller (the signing token by its sha256, never the raw token).
 *  - send: 5 per `/p/` token and 20 per network address per hour (each allowed call can email the client);
 *  - link (open / consent / sign on `?sign=`): 30 per signing token and 60 per address per hour;
 *  - close-on-change: 20 per `/p/` token per hour.
 */
export const SEND_LINK_PER_TOKEN = 5;
export const SEND_LINK_PER_ADDRESS = 20;
export const sendTokenLimiter = createRateLimiter({ max: SEND_LINK_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
export const sendAddressLimiter = createRateLimiter({ max: SEND_LINK_PER_ADDRESS, windowMs: REVIEW_PDF_WINDOW_MS });

export const LINK_PER_TOKEN = 30;
export const LINK_PER_ADDRESS = 60;
export const linkTokenLimiter = createRateLimiter({ max: LINK_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
export const linkAddressLimiter = createRateLimiter({ max: LINK_PER_ADDRESS, windowMs: REVIEW_PDF_WINDOW_MS });

export const CLOSE_LINK_PER_TOKEN = 20;
export const closeTokenLimiter = createRateLimiter({ max: CLOSE_LINK_PER_TOKEN, windowMs: REVIEW_PDF_WINDOW_MS });
