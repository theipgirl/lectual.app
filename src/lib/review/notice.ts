/** A fixed sentence the Cards view shows after an action it could not do. The code rides the URL; the words are here. */
export const REVIEW_NOTICES = {
  denied: "You don't have permission to change this. Ask an attorney or an admin.",
  missing: "That record couldn't be found. It may have been removed.",
  failed: "That didn't save. Try again.",
} as const;
export type ReviewNoticeCode = keyof typeof REVIEW_NOTICES;

export function noticeFor(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v in REVIEW_NOTICES ? REVIEW_NOTICES[v as ReviewNoticeCode] : null;
}

/** Maps an action's fixed sentence to a short code. Anything unrecognised is "failed". */
export function noticeCodeFor(error: string | undefined): ReviewNoticeCode | null {
  if (!error) return null;
  if (/permission/i.test(error)) return "denied";
  if (/couldn't be found|not found/i.test(error)) return "missing";
  return "failed";
}
