import { isDeadlock, isMissingObjectError, hasPrefix } from "./codes";

/**
 * Every answer of `client_proposal_signing_open` other than an id, mapped (Sprint A item 9, v3 B1b). None is a dead end. Pure.
 *   - a precondition 0117's readiness also reports (`signing_letter_replaced`, `signing_changed`, `signing_no_email`):
 *     `unavailable`, nothing recorded (the reload's readiness is off, so it signs in-app);
 *   - a missing object (42883 / PGRST202 / 42P01 / PGRST205): `unavailable`, and the runtime memo is set;
 *   - `signing_words_changed` / `signing_invalid`: a counted failure, kind `open_refused`;
 *   - anything else (23505 on one_open, 40P01, an unknown error, a timeout): a counted failure, kind `open_error`.
 */

export type FailureKind = "open_refused" | "open_error" | "mail_uncertain" | "close_error" | "other";

export type OpenOutcome =
  | { kind: "precondition" }
  | { kind: "missing" }
  | { kind: "counted"; failure: FailureKind };

type ErrorLike = { code?: unknown; message?: unknown } | null | undefined;

export function signOpenOutcome(error: ErrorLike): OpenOutcome {
  if (isMissingObjectError(error)) return { kind: "missing" };
  if (hasPrefix(error, "signing_letter_replaced") || hasPrefix(error, "signing_changed") || hasPrefix(error, "signing_no_email")) {
    return { kind: "precondition" };
  }
  if (!isDeadlock(error) && (hasPrefix(error, "signing_words_changed") || hasPrefix(error, "signing_invalid"))) {
    return { kind: "counted", failure: "open_refused" };
  }
  return { kind: "counted", failure: "open_error" };
}
