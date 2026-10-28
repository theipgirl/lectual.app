import { SIGN_IN_ERROR_FALLBACK, SIGN_IN_EXPIRED } from "@/lib/ui/words";

/** The `?error=` values a sign-in bounce is known to carry, all meaning "that link is spent". */
const EXPIRED_CODES = new Set(["otp_expired", "access_denied"]);

/**
 * The sentence the sign-in page prints for a `?error=` value. The value is untrusted text from the
 * address bar, so it is never echoed: only a known code maps to its own sentence, and anything else
 * gets one fixed sentence. Pure.
 */
export function signInErrorMessage(raw: string | null | undefined): string {
  const code = (raw ?? "").trim().toLowerCase();
  if (EXPIRED_CODES.has(code)) return SIGN_IN_EXPIRED;
  return SIGN_IN_ERROR_FALLBACK;
}
