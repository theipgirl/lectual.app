import { createHash } from "node:crypto";

/**
 * "Yes approves the text on screen." The lead page's Yes and the deck's Yes post the sha256 (hex) of the body the
 * person SAW, computed on the server when the card was drawn. The approve core re-reads the item and refuses when
 * `final_body ?? draft_body` no longer hashes to it (a colleague's edit in between), so an edit is never approved unseen.
 */
export const SHOWN_SHA256 = /^[0-9a-f]{64}$/;

export function shownBodySha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The posted hash when it is well formed, else null (missing or malformed is refused by the callers that need it). */
export function shownShaOf(raw: unknown): string | null {
  return typeof raw === "string" && SHOWN_SHA256.test(raw) ? raw : null;
}

/** True when the item's current text is the text that was shown. */
export function shownTextMatches(item: { final_body: string | null; draft_body: string }, sha: string): boolean {
  return shownBodySha256(item.final_body ?? item.draft_body) === sha;
}
