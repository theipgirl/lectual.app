import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import type { CardEvent, CardState } from "@/lib/queue/deck";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { shownBodySha256, SHOWN_SHA256 } from "@/lib/queue/shown-text";

/**
 * Drafts in the drafter's own Outlook (Sprint 4, decision 3b). Pure: who may make the draft, from what the action
 * re-read. Nothing here writes, sends or reads a mailbox.
 *
 *  · When the approver IS the drafter (or no drafter is set, or the item is not a client email): today's approve path,
 *    unchanged (`plan: "today"`).
 *  · When the approver is NOT the drafter: the item is approved as today, but no mailbox draft is made anywhere. The
 *    approve path writes one `draft_to` event to the drafter, carrying the sha256 of the approved text in its note.
 *  · The drafter presses "Make the draft in my Outlook": only the CURRENT draft_to target, only for an approved client
 *    email whose text still hashes to the receipt, and only through their own connection. Then a `drafted` event.
 *
 * The events given to these functions must already be folded by `trustedEvents` (deck.ts), so a forged draft_to is out.
 */

export type ApprovePlan = "today" | "pass";

/** What the approve path does about the mailbox draft. `drafter` null = no "Drafts go to" set (or it couldn't be read). */
export function approvePlan(args: { approverId: string; drafter: string | null | undefined; itemType: string }): ApprovePlan {
  if (args.itemType !== "CLIENT_EMAIL") return "today";
  if (!args.drafter || args.drafter === args.approverId) return "today";
  return "pass";
}

/* ─────────────── the receipt carried on draft_to ─────────────── */

const NOTE_PREFIX = "approved-text sha256 ";

/** The draft_to note: the sha256 (hex) of the approved text. The text itself is never stored on the event. */
export const draftToNote = (approvedText: string): string => `${NOTE_PREFIX}${shownBodySha256(approvedText)}`;

/** The sha256 a draft_to note carries, or null when it carries none. */
export function shaFromDraftToNote(note: string | null | undefined): string | null {
  if (!note || !note.startsWith(NOTE_PREFIX)) return null;
  const sha = note.slice(NOTE_PREFIX.length).trim();
  return SHOWN_SHA256.test(sha) ? sha : null;
}

/** The 12-hex receipt the approve path appends to the resolution note ("Receipt: sha256 <12 hex>"), if any. */
export function receiptFromNote(note: string | null | undefined): string | null {
  const m = /Receipt: sha256 ([0-9a-f]{12})\b/.exec(note ?? "");
  return m ? m[1] : null;
}

/**
 * Is the item's CURRENT text the text that was approved? The current `final_body ?? draft_body` must hash to the sha256
 * on the draft_to, and when the resolution note carries a receipt, that receipt must agree too. An edit after approval
 * (or a draft_to that carries no hash) is a no.
 */
export function approvedTextMatches(item: Pick<QueueItem, "final_body" | "draft_body" | "resolution_note">, sha: string | null): boolean {
  if (!sha) return false;
  const current = shownBodySha256(item.final_body ?? item.draft_body);
  if (current !== sha) return false;
  const receipt = receiptFromNote(item.resolution_note);
  return receipt === null || sha.startsWith(receipt);
}

/* ─────────────── who holds the draft ─────────────── */

export type DraftAssignment = { target: string; by: string; sha: string | null; at: string; drafted: { at: string } | null };

/** The newest draft_to on the item (and whether its target has marked it drafted since). Trusted events only. */
export function draftAssignment(events: readonly CardEvent[], itemId: string): DraftAssignment | null {
  let current = null as DraftAssignment | null;
  for (const e of events) {
    if (e.queueItemId !== itemId) continue;
    if (e.kind === "draft_to" && e.targetUserId) current = { target: e.targetUserId, by: e.actorId, sha: shaFromDraftToNote(e.note), at: e.createdAt, drafted: null };
    else if (e.kind === "drafted" && current !== null && e.actorId === current.target) current = { target: current.target, by: current.by, sha: current.sha, at: current.at, drafted: { at: e.createdAt } };
  }
  return current;
}

/** The approved client emails waiting on `viewerId`'s draft click. Empty unless the events were READ. */
export function readyToDraft<T extends Pick<QueueItem, "id" | "status" | "type">>(items: readonly T[], state: CardState, viewerId: string | null | undefined): T[] {
  if (!viewerId || state.status !== "ok") return [];
  return items.filter((i) => {
    if (i.status !== "approved" || i.type !== "CLIENT_EMAIL") return false;
    const a = draftAssignment(state.events, i.id);
    return !!a && a.target === viewerId && !a.drafted;
  });
}

/* ─────────────── may this person make the draft? ─────────────── */

export type DraftRefusal =
  | "preview" // Lectual staff viewing as the firm
  | "not-yours" // not signed in as a staff member, or not the current draft_to target
  | "not-approved" // the item is not an approved client email
  | "not-switched-on" // before lectual 0112
  | "couldnt-check" // the card events or the routing couldn't be read
  | "changed"; // the text was edited after approval (or the receipt is missing)

export type DraftDecision = { ok: true; already: false; assignment: DraftAssignment } | { ok: true; already: true } | { ok: false; reason: DraftRefusal };

/**
 * The pure decision over what the action re-read. `state` must be the TRUSTED fold; `trustKnown` false (the routing or
 * member list couldn't be read) refuses, because then a forged draft_to could not be told apart.
 */
export function makeDraftDecision(args: {
  actingAsStaff: boolean;
  callerId: string | null;
  callerRole: Role | null;
  item: Pick<QueueItem, "id" | "status" | "type" | "final_body" | "draft_body" | "resolution_note"> | null;
  state: CardState;
  trustKnown: boolean;
}): DraftDecision {
  if (args.actingAsStaff) return { ok: false, reason: "preview" };
  if (!args.callerId || !args.callerRole || !QUEUE_EDIT_ROLES.includes(args.callerRole)) return { ok: false, reason: "not-yours" };
  if (!args.item) return { ok: false, reason: "couldnt-check" };
  if (args.item.status !== "approved" || args.item.type !== "CLIENT_EMAIL") return { ok: false, reason: "not-approved" };
  if (args.state.status === "not-set-up") return { ok: false, reason: "not-switched-on" };
  if (args.state.status !== "ok" || !args.trustKnown) return { ok: false, reason: "couldnt-check" };
  const a = draftAssignment(args.state.events, args.item.id);
  if (!a || a.target !== args.callerId) return { ok: false, reason: "not-yours" };
  // A second click on a drafted item does nothing.
  if (a.drafted) return { ok: true, already: true };
  if (!approvedTextMatches(args.item, a.sha)) return { ok: false, reason: "changed" };
  return { ok: true, already: false, assignment: a };
}

/* ─────────────── the drafter's own Outlook ─────────────── */

/** The clicking person's own Outlook, as their scoped read shows it. */
export type MyOutlookDraftAccess = "ready" | "no-mailbox" | "not-outlook" | "needs-permission" | "unavailable";

/**
 * A connection id the browser posted (if any) must be the caller's own, found by their scoped read. The id used is
 * ALWAYS the scoped read's; a posted one is only ever compared, so another person's id is refused, never used.
 */
export function postedConnectionAllowed(posted: unknown, ownId: string | null): boolean {
  if (posted === undefined || posted === null || posted === "") return true;
  return typeof posted === "string" && ownId !== null && posted === ownId;
}
