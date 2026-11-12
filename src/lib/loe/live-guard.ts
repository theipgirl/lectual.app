import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { LETTER_CHANGED_SENTENCE, LETTER_UNREADABLE_SENTENCE } from "@/lib/proposal-editor/vocabulary";
import { isGeneralContent, type ProposalContent } from "@/lib/proposals/types";
import { letterCopyCheck, type LetterCopyCheck } from "./editor-state";
import { getApprovedLetter } from "./templates-store";

/**
 * The ONE guard on making a version live: is the engagement letter copy this proposal carries the firm's CURRENT approved
 * version? Every path that turns a client link on goes through it, because every one of them ends in `sendProposal` (the
 * store), which calls `letterLiveCheck` before the database is asked to send:
 *   - "Save and create link" (which also runs it BEFORE approving, so a stale copy doesn't leave a saved version behind);
 *   - "Turn on the link" (`sendAction`);
 *   - the approval queue's go-live (`makeProposalLive`).
 * A client must never be handed a letter the firm has since replaced, and never on a guess: a copy that differs is `stale`, a
 * read that failed is `unreadable`, and both stop the link with the same fixed sentence wherever it was asked for.
 *
 * The firm's letter is read FENCED ON THE PROPOSAL ROW'S OWN ORG (`row.org_id`), not on whatever the connection happens to
 * see, so the answer is the same through a signed-in person's scoped client and through a service-role client.
 */
export async function letterLiveCheck(db: SupabaseClient<Database>, row: { org_id: string; content: ProposalContent }): Promise<LetterCopyCheck> {
  if (!row.content?.loe) return "no_letter";
  if (typeof row.org_id !== "string" || row.org_id.length === 0) return "unreadable";
  try {
    return letterCopyCheck(row.content, await getApprovedLetter(db, isGeneralContent(row.content) ? "general" : "trademark", row.org_id));
  } catch {
    return "unreadable";
  }
}

/** The fixed sentence for a check that stops the link, or null when the link may go live. One wording for every path. */
export function letterLiveRefusal(check: LetterCopyCheck): string | null {
  if (check === "stale") return LETTER_CHANGED_SENTENCE;
  if (check === "unreadable") return LETTER_UNREADABLE_SENTENCE;
  return null;
}
