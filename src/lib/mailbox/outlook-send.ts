import { PROVIDER_FETCH_TIMEOUT_MS, withTimeout } from "@/lib/http/timeout";

/**
 * "Send from Outlook now": the ONE place in Lectual that can send a message, and only a message a person approved and
 * then chose to send by pressing a button herself. Nothing calls this on a schedule, from an agent, or as part of an
 * approval. The approval deck's send action (src/app/dashboard/queue/deck/actions.ts) is its only caller, and it checks
 * first that the item was approved by this same signed-in person.
 *
 * It sends an existing DRAFT in the person's OWN Microsoft mailbox, by id, and only after reading that message back
 * through her own token and finding it is still a draft addressed to the item's recipient. It never composes a message.
 *
 * The Graph permission it needs is asked for only when the deployment flag MAILBOX_SEND_SCOPE is "on" (default off), and
 * a mailbox connected before that has to be reconnected to grant it. Without it the button is not offered.
 */

/** The Graph permission a send needs. Kept here, beside the one call that uses it. */
export const SEND_SCOPE = "Mail.Send";

/** Graph message ids: letters, digits and - _ = + (no slash, dot, query or space). */
export const DRAFT_ID = /^[A-Za-z0-9_=+-]{1,512}$/;

const GRAPH = "https://graph.microsoft.com/v1.0/me/messages/";

export type SendCheck = { ok: true } | { ok: false; reason: "bad-id" | "gone" | "not-a-draft" | "wrong-recipient" | "not-this-approval" | "reauth" | "failed" };

/** Does this message's recipient list include `recipient` (case-insensitive, trimmed)? */
export function recipientsInclude(to: readonly string[], recipient: string | null | undefined): boolean {
  const want = (recipient ?? "").trim().toLowerCase();
  if (!want) return false;
  return to.some((a) => a.trim().toLowerCase() === want);
}

/**
 * Read the draft back, then send it. Two calls, each with a deadline. A refusal (401/403) is `reauth`; a missing message
 * is `gone`; anything that is no longer a draft, or is not addressed to the recipient, is refused without sending.
 */
export async function sendCheckedDraft(args: {
  accessToken: string;
  draftId: string;
  recipient: string | null;
  /**
   * Ties the draft to THIS approval (the draft id comes from the browser): its subject must be the item's, and it must
   * have been created no earlier than the approval (two minutes' slack for clocks). Another draft in the same Outlook
   * addressed to the same client is refused.
   */
  subject?: string | null;
  approvedAt?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SendCheck> {
  const { accessToken, draftId, recipient, fetchImpl = fetch } = args;
  if (!DRAFT_ID.test(draftId)) return { ok: false, reason: "bad-id" };
  const headers = { authorization: `Bearer ${accessToken}` };
  const base = `${GRAPH}${encodeURIComponent(draftId)}`;

  let res: Response;
  try {
    res = await fetchImpl(`${base}?$select=isDraft,toRecipients,subject,createdDateTime`, withTimeout({ headers }, PROVIDER_FETCH_TIMEOUT_MS));
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "reauth" };
  if (res.status === 404) return { ok: false, reason: "gone" };
  if (!res.ok) return { ok: false, reason: "failed" };
  const json = (await res.json().catch(() => null)) as { isDraft?: unknown; subject?: string | null; createdDateTime?: string | null; toRecipients?: Array<{ emailAddress?: { address?: string | null } }> } | null;
  if (!json || json.isDraft !== true) return { ok: false, reason: "not-a-draft" };
  const to = (json.toRecipients ?? []).map((r) => r.emailAddress?.address ?? "").filter(Boolean);
  if (!recipientsInclude(to, recipient)) return { ok: false, reason: "wrong-recipient" };
  if (!draftMatchesApproval({ subject: json.subject ?? null, createdDateTime: json.createdDateTime ?? null }, args)) return { ok: false, reason: "not-this-approval" };

  let sent: Response;
  try {
    sent = await fetchImpl(`${base}/send`, withTimeout({ method: "POST", headers }, PROVIDER_FETCH_TIMEOUT_MS));
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (sent.status === 401 || sent.status === 403) return { ok: false, reason: "reauth" };
  if (sent.status === 404) return { ok: false, reason: "gone" };
  if (!sent.ok) return { ok: false, reason: "failed" };
  return { ok: true };
}

/** Pure: is this draft the one made for the approval (same subject; created at or after the approval, two minutes' slack)? */
export function draftMatchesApproval(
  draft: { subject: string | null; createdDateTime: string | null },
  want: { subject?: string | null; approvedAt?: string | null },
): boolean {
  if (want.subject !== undefined) {
    const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (norm(draft.subject) !== norm(want.subject)) return false;
  }
  if (want.approvedAt !== undefined) {
    const approved = Date.parse(want.approvedAt ?? "");
    const created = Date.parse(draft.createdDateTime ?? "");
    if (!Number.isFinite(approved) || !Number.isFinite(created)) return false;
    if (created < approved - 2 * 60_000) return false;
  }
  return true;
}
