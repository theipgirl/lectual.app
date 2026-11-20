import "server-only";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadCardState, recordCardEvent } from "@/lib/queue/card-state";
import { cardCaller, readCardItem } from "@/lib/queue/card-moves";
import { eventTrust, trustedCardState } from "@/lib/queue/deck";
import { makeDraftDecision, type DraftRefusal } from "@/lib/queue/draft-handoff";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { draftInMyOwnOutlook } from "@/lib/mailbox/my-mailbox";
import {
  MAKE_DRAFT_ALREADY,
  MAKE_DRAFT_CHANGED,
  MAKE_DRAFT_COULDNT_CHECK,
  MAKE_DRAFT_DONE,
  MAKE_DRAFT_DONE_NOT_MARKED,
  MAKE_DRAFT_FAILED,
  MAKE_DRAFT_NEEDS_PERMISSION,
  MAKE_DRAFT_NO_OUTLOOK,
  MAKE_DRAFT_NOT_APPROVED,
  MAKE_DRAFT_NOT_OUTLOOK,
  MAKE_DRAFT_NOT_YOURS,
  MAKE_DRAFT_OUTLOOK_UNREAD,
  MAKE_DRAFT_PREVIEW_ONLY,
  MAKE_DRAFT_RECONNECT,
  NOT_SWITCHED_ON,
} from "@/lib/ui/words";

/**
 * "Make the draft in my Outlook" (Sprint 4, decision 3b). The ONE core the Approvals item page and the deck call. On
 * every call it re-resolves the caller from the session (no user, org, role or connection from the browser is used),
 * re-reads the item from the queue and the card events through the scoped client, folds them with `trustedEvents`, and
 * refuses unless the caller is the CURRENT draft_to target of an approved client email whose text still hashes to the
 * approve receipt. Then ONE draft in the caller's OWN Outlook (their scoped read; a posted connection id is only ever
 * compared with it) and a `drafted` event. A second click on a drafted item does nothing. Nothing here sends.
 */

export type MakeDraftResult = { ok: true; message: string; webLink: string | null } | { ok: false; error: string };

const REFUSAL: Record<DraftRefusal, string> = {
  preview: MAKE_DRAFT_PREVIEW_ONLY,
  "not-yours": MAKE_DRAFT_NOT_YOURS,
  "not-approved": MAKE_DRAFT_NOT_APPROVED,
  "not-switched-on": NOT_SWITCHED_ON,
  "couldnt-check": MAKE_DRAFT_COULDNT_CHECK,
  changed: MAKE_DRAFT_CHANGED,
};

export async function makeDraftInMyOutlook(args: { id: string; postedConnectionId?: unknown }): Promise<MakeDraftResult> {
  const session = await resolveFirmSession().catch(() => null);
  const actingAsStaff = !!session && session.kind === "ok" && session.actingAsStaff;
  if (actingAsStaff) return { ok: false, error: MAKE_DRAFT_PREVIEW_ONLY };
  const who = await cardCaller();
  if (!who) return { ok: false, error: MAKE_DRAFT_NOT_YOURS };
  const item = await readCardItem(args.id);
  const [loaded, routed] = await Promise.all([loadCardState([args.id]), loadApprovalRouting()]);
  const trust = eventTrust(routed);
  const state = item ? trustedCardState(loaded, [item], trust) : loaded;
  const decision = makeDraftDecision({ actingAsStaff, callerId: who.userId, callerRole: who.role, item, state, trustKnown: trust.status === "known" });
  if (!decision.ok) return { ok: false, error: REFUSAL[decision.reason] };
  if (decision.already || !item) return { ok: true, message: MAKE_DRAFT_ALREADY, webLink: null };

  // The approved text, checked above against the receipt; the same subject the approve path drafts with.
  const made = await draftInMyOwnOutlook({
    draft: { to: item.recipient, subject: item.subject ?? item.headline, body: item.final_body ?? item.draft_body },
    postedConnectionId: args.postedConnectionId,
  });
  if (!made.ok) {
    switch (made.reason) {
      case "not-yours":
        return { ok: false, error: MAKE_DRAFT_NOT_YOURS };
      case "no-mailbox":
        return { ok: false, error: MAKE_DRAFT_NO_OUTLOOK };
      case "not-outlook":
        return { ok: false, error: MAKE_DRAFT_NOT_OUTLOOK };
      case "needs-permission":
        return { ok: false, error: MAKE_DRAFT_NEEDS_PERMISSION };
      case "reauth":
        return { ok: false, error: MAKE_DRAFT_RECONNECT };
      case "unavailable":
        return { ok: false, error: MAKE_DRAFT_OUTLOOK_UNREAD };
      default:
        return { ok: false, error: MAKE_DRAFT_FAILED };
    }
  }
  const marked = await recordCardEvent({ orgId: who.orgId, queueItemId: item.id, kind: "drafted" });
  return { ok: true, message: marked.ok ? MAKE_DRAFT_DONE : MAKE_DRAFT_DONE_NOT_MARKED, webLink: made.webLink };
}
