/**
 * Did a failed Outlook draft call DEFINITELY make no draft? Pure, no server import. The only one place this is decided
 * (Sprint 4 review): "Make the draft" writes `draft_failed` (re-opening the item for another attempt) ONLY for a definite
 * refusal; anything uncertain leaves the claim open, so the page says "Check your Drafts" with the approved text and a
 * draft Graph really made is never made twice.
 *
 *  · definite   Graph refused the request: 401 / 403 (`reauth`) or any other 4xx it returned (`httpStatus` 400..499).
 *  · uncertain  everything else: a 5xx, a timeout or abort, a network drop, a reply that couldn't be read after a 2xx
 *               (json failing after a 201), or an error of an unknown shape.
 * (Failures BEFORE the Graph call, such as no token or no connection, never reach here: nothing was sent.)
 */
export type DraftFailure = "definite" | "uncertain";

export function draftFailureKind(err: unknown): DraftFailure {
  const e = err as { code?: unknown; httpStatus?: unknown } | null;
  if (e?.code === "reauth") return "definite";
  const status = e?.httpStatus;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 499) return "definite";
  return "uncertain";
}
