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

/**
 * Supabase's own verify page sends a failed magic link back with the reason in the URL FRAGMENT
 * (`#error=access_denied&error_code=otp_expired&...`), which the server never sees. This reads the
 * code out of `location.hash` so the browser can show the same fixed sentence. Pure; returns null
 * when the fragment carries no error. The value is only ever passed to `signInErrorMessage`.
 */
export function hashErrorCode(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const code = params.get("error_code") ?? params.get("error");
  return code && code.trim() ? code.trim() : null;
}

/** A 6-digit sign-in code typed by a person: digits only, spaces and dashes ignored. Pure. */
export function normalizeSignInCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}
