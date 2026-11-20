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

/**
 * `today`: no drafter set (or the routing couldn't be read), or not a client email: unchanged.
 * `self`:  the drafter approves: the queue is asked not to draft, so the only mailbox draft is her own personal one.
 * `pass`:  someone else approves: no mailbox draft anywhere; a draft_to passes it to the drafter.
 */
export type ApprovePlan = "today" | "self" | "pass";

/** What the approve path does about the mailbox draft. `drafter` null = no "Drafts go to" set (or it couldn't be read). */
export function approvePlan(args: { approverId: string; drafter: string | null | undefined; itemType: string }): ApprovePlan {
  if (args.itemType !== "CLIENT_EMAIL") return "today";
  if (!args.drafter) return "today";
  return args.drafter === args.approverId ? "self" : "pass";
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

/**
 * The 12-hex receipt the approve path writes on the resolution note, if any. The server writes it in ONE fixed form and
 * position: the LAST line of the note, exactly "Receipt: sha256 <12 hex>" (`runQueueReview` joins the person's note, the
 * stale line and the receipt, in that order). Only that last line is read, so a receipt the approver pasted into their own
 * note (which comes earlier) can never be the one checked.
 */
export function receiptFromNote(note: string | null | undefined): string | null {
  const lines = (note ?? "").split("\n");
  const m = /^Receipt: sha256 ([0-9a-f]{12})$/.exec(lines[lines.length - 1] ?? "");
  return m ? m[1] : null;
}

/**
 * Is the item's CURRENT text the text that was approved? The current `final_body ?? draft_body` must hash to the sha256
 * on the draft_to, AND the approve receipt on the resolution note (always written when the plan is `pass`) must be there
 * and agree. An edit after approval, a draft_to that carries no hash, or a missing receipt is a no.
 */
export function approvedTextMatches(item: Pick<QueueItem, "final_body" | "draft_body" | "resolution_note">, sha: string | null): boolean {
  if (!sha) return false;
  const current = shownBodySha256(item.final_body ?? item.draft_body);
  if (current !== sha) return false;
  const receipt = receiptFromNote(item.resolution_note);
  return receipt !== null && sha.startsWith(receipt);
}

/** True when the item's current text is the text its approve receipt names (the receipt must be there). */
export function receiptMatchesCurrent(item: Pick<QueueItem, "final_body" | "draft_body" | "resolution_note">): boolean {
  const receipt = receiptFromNote(item.resolution_note);
  return receipt !== null && shownBodySha256(item.final_body ?? item.draft_body).startsWith(receipt);
}

/** Did this member approve the item? `resolved_by` is the approver's session address. Case-insensitive. */
export function approvedBy(item: Pick<QueueItem, "status" | "resolved_by">, email: string | null | undefined): boolean {
  const by = (item.resolved_by ?? "").trim().toLowerCase();
  return item.status === "approved" && !!by && !!email && email.trim().toLowerCase() === by;
}

/* ─────────────── who holds the draft ─────────────── */

/**
 * The drafter's attempts, after the current draft_to (MUST 2). The click CLAIMS an attempt with a `drafting` row (one per
 * attempt number, a unique index in 0112), makes the Outlook draft, then CONFIRMS it with `drafted` or records
 * `draft_failed`, which re-opens the item for the next attempt. Each of the three carries the note "attempt <n>".
 *  · open      no attempt yet (next = 1)
 *  · failed    the newest attempt has a draft_failed (next = that + 1): the button is offered again
 *  · drafting  the newest attempt has neither (a crash in between): never "Drafted", never a second click
 *  · drafted   confirmed
 */
export type DraftProgress = { kind: "open"; next: number } | { kind: "failed"; next: number } | { kind: "drafting"; attempt: number } | { kind: "drafted"; at: string };

export type DraftAssignment = { target: string; by: string; sha: string | null; at: string; progress: DraftProgress };

const ATTEMPT = /^attempt ([1-9][0-9]{0,3})$/;
export const attemptNote = (n: number): string => `attempt ${n}`;
export function attemptOf(note: string | null | undefined): number | null {
  const m = ATTEMPT.exec(note ?? "");
  return m ? Number(m[1]) : null;
}

/** The newest draft_to on the item and what its target has done since. Trusted events only. */
export function draftAssignment(events: readonly CardEvent[], itemId: string): DraftAssignment | null {
  let current = null as { target: string; by: string; sha: string | null; at: string } | null;
  let claimed = new Set<number>();
  let failed = new Set<number>();
  let drafted: string | null = null;
  for (const e of events) {
    if (e.queueItemId !== itemId) continue;
    if (e.kind === "draft_to" && e.targetUserId) {
      current = { target: e.targetUserId, by: e.actorId, sha: shaFromDraftToNote(e.note), at: e.createdAt };
      claimed = new Set();
      failed = new Set();
      drafted = null;
      continue;
    }
    if (!current || e.actorId !== current.target) continue;
    const n = attemptOf(e.note);
    if (e.kind === "drafted") drafted = e.createdAt;
    else if (e.kind === "drafting" && n !== null) claimed.add(n);
    else if (e.kind === "draft_failed" && n !== null) failed.add(n);
  }
  if (!current) return null;
  let progress: DraftProgress;
  if (drafted) progress = { kind: "drafted", at: drafted };
  else if (claimed.size === 0) progress = { kind: "open", next: 1 };
  else {
    const latest = Math.max(...claimed);
    progress = failed.has(latest) ? { kind: "failed", next: latest + 1 } : { kind: "drafting", attempt: latest };
  }
  return { ...current, progress };
}

/** Was the pass at approval recorded as failed (SHOULD 3)? A trusted `pass_failed` with no trusted draft_to after it. */
export function passFailedRecorded(events: readonly CardEvent[], itemId: string): boolean {
  let failed = false;
  for (const e of events) {
    if (e.queueItemId !== itemId) continue;
    if (e.kind === "pass_failed") failed = true;
    else if (e.kind === "draft_to") failed = false;
  }
  return failed;
}

/** The approved client emails waiting on `viewerId`'s draft (not confirmed drafted). Empty unless the events were READ. */
export function readyToDraft<T extends Pick<QueueItem, "id" | "status" | "type">>(items: readonly T[], state: CardState, viewerId: string | null | undefined): T[] {
  if (!viewerId || state.status !== "ok") return [];
  return items.filter((i) => {
    if (i.status !== "approved" || i.type !== "CLIENT_EMAIL") return false;
    const a = draftAssignment(state.events, i.id);
    return !!a && a.target === viewerId && a.progress.kind !== "drafted";
  });
}

/* ─────────────── may this person make the draft? ─────────────── */

/* ─────────────── retry a failed pass (S3) ─────────────── */

export type RetryPassRefusal = "preview" | "not-yours" | "not-approved" | "no-drafter" | "not-switched-on" | "couldnt-check" | "already-passed" | "no-marker" | "changed";

/**
 * "Pass to <drafter>" again, after a pass that didn't go through. Only the person who approved the item (their address is
 * `resolved_by`), only for an approved client email, only while the firm's drafter is someone else, only while NO trusted
 * draft_to exists, and only when the approve receipt is there and still names the current text.
 */
export function retryPassDecision(args: {
  actingAsStaff: boolean;
  callerId: string | null;
  callerRole: Role | null;
  callerEmail: string | null;
  item: Pick<QueueItem, "id" | "status" | "type" | "final_body" | "draft_body" | "resolution_note" | "resolved_by"> | null;
  drafter: string | null;
  state: CardState;
  trustKnown: boolean;
}): { ok: true; drafter: string } | { ok: false; reason: RetryPassRefusal } {
  if (args.actingAsStaff) return { ok: false, reason: "preview" };
  if (!args.callerId || !args.callerRole || !QUEUE_EDIT_ROLES.includes(args.callerRole)) return { ok: false, reason: "not-yours" };
  if (!args.item) return { ok: false, reason: "couldnt-check" };
  if (args.item.status !== "approved" || args.item.type !== "CLIENT_EMAIL") return { ok: false, reason: "not-approved" };
  if (!approvedBy(args.item, args.callerEmail)) return { ok: false, reason: "not-yours" };
  if (!args.drafter || args.drafter === args.callerId) return { ok: false, reason: "no-drafter" };
  if (args.state.status === "not-set-up") return { ok: false, reason: "not-switched-on" };
  if (args.state.status !== "ok" || !args.trustKnown) return { ok: false, reason: "couldnt-check" };
  if (draftAssignment(args.state.events, args.item.id)) return { ok: false, reason: "already-passed" };
  // SHOULD 3: only when the outcome recorded at approval was a failed pass. No marker, no retry (the queue may have drafted
  // it, or the approver's own mailbox did before 0112, or it was approved before a drafter existed).
  if (!passFailedRecorded(args.state.events, args.item.id)) return { ok: false, reason: "no-marker" };
  if (!receiptMatchesCurrent(args.item)) return { ok: false, reason: "changed" };
  return { ok: true, drafter: args.drafter };
}

export type DraftRefusal =
  | "preview" // Lectual staff viewing as the firm
  | "not-yours" // not signed in as a staff member, or not the current draft_to target
  | "not-approved" // the item is not an approved client email
  | "not-switched-on" // before lectual 0112
  | "couldnt-check" // the card events or the routing couldn't be read
  | "changed" // the text was edited after approval (or the receipt is missing)
  | "in-flight"; // an attempt was claimed and has no outcome (a crash in between): check Drafts, never a second draft

export type DraftDecision = { ok: true; already: false; assignment: DraftAssignment; attempt: number } | { ok: true; already: true } | { ok: false; reason: DraftRefusal };

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
  // A second click on a drafted item does nothing; one whose attempt is still open is never drafted twice.
  if (a.progress.kind === "drafted") return { ok: true, already: true };
  if (a.progress.kind === "drafting") return { ok: false, reason: "in-flight" };
  if (!approvedTextMatches(args.item, a.sha)) return { ok: false, reason: "changed" };
  return { ok: true, already: false, assignment: a, attempt: a.progress.next };
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
