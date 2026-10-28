import type { Role } from "@/lib/auth/roles";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { PROPOSAL_ADMIN_ROLES, type ProposalRow, type ProposalStatus } from "@/lib/proposals/types";
import type { PaidState } from "@/lib/proposals/paid";
import { notReadyYet } from "@/lib/ui/words";

/**
 * "Reset acceptance" on an ACCEPTED proposal (lectual 0101).
 *
 * The firm tests proposals by accepting them, and a client can accept by mistake. A reset moves the
 * accepted version back to "Link live" (`sent`): the same client link shows the offer again and the
 * client can accept again. The database is the rule: a signed-in owner / admin / senior admin, or a
 * named approver; never once the version is marked paid; status alone, nothing else changing. It
 * clears the acceptance columns and writes the `reset` event (with the previous acceptance) itself.
 *
 * A reset starts a FRESH ROUND for the follow-ups (paid.ts `currentRound`): only step events after
 * the newest reset count, so a second acceptance runs the firm notice and the Lawmatics note again,
 * and Mark paid, the LOE draft and the uploads start over. What already went out (the earlier note
 * in Lawmatics, the in-app notices) is not taken back; the confirm says so.
 *
 * Pure: no database, no session. The action passes its dependencies in (like pay-link.ts and
 * create-link.ts), so the order and every refusal are tested without a database.
 */

export const RESET_LABEL = "Reset acceptance";
export const RESET_CONFIRM =
  "Reset this acceptance? The client link opens again and they can accept again. The Lawmatics note and alerts already sent stay as they are.";
export const RESET_CONFIRM_BUTTON = "Yes, reset";
export const RESET_PENDING = "Resetting…";
export const RESET_DONE = "Acceptance reset. The client link is live again, and the client can accept again.";
export const RESET_NOT_ALLOWED = "Only a senior admin or above, or one of the firm's named approvers, can reset an acceptance.";
export const RESET_PAID = "Undo Mark paid first.";
export const RESET_PAID_UNREADABLE = "Paid status couldn't be read, so the acceptance wasn't reset. Refresh and try again.";
export const RESET_NOT_ACCEPTED = "Only an accepted proposal can have its acceptance reset.";
export const RESET_WITH_EDIT = "Reset the acceptance on its own, without other changes. Refresh and try again.";
export const RESET_NEEDS_DB_UPDATE = notReadyYet("Resetting an acceptance");
export const RESET_FAILED = "Couldn't reset the acceptance.";

/** Who may reset: the admin tier, or a named approver (any staff role). Mirrors 0101's trigger. */
export function mayResetAcceptance(role: Role | null | undefined, isApprover: boolean): boolean {
  if (isApprover) return true;
  return !!role && PROPOSAL_ADMIN_ROLES.includes(role);
}

/**
 * Whether the page OFFERS "Reset acceptance". Only an accepted version, only for someone who may
 * reset, and only when the paid status was read AND is not paid: a paid version hides it (the
 * action says "Undo Mark paid first."), and an unread one hides it too (fail closed).
 */
export function canResetAcceptance(input: {
  status: ProposalStatus;
  role: Role | null | undefined;
  isApprover: boolean;
  /** The current round's paid state; null when it couldn't be read. */
  paid: PaidState | null;
}): boolean {
  if (input.status !== "accepted") return false;
  if (!mayResetAcceptance(input.role, input.isApprover)) return false;
  return input.paid !== null && input.paid.state === "not_paid";
}

export type ResetPaidRead = "paid" | "not_paid" | "unavailable";

export type ResetAcceptanceDeps = {
  /** The module gate (notFound) and the staff-role check; a refusal is returned as is. */
  gate: () => Promise<ActionState | null>;
  /** Re-reads the caller's role and whether they are a named approver, on every call. */
  authorize: () => Promise<{ role: Role | null; isApprover: boolean }>;
  /** The version's current-round paid state, read fresh. */
  paid: (id: string) => Promise<ResetPaidRead>;
  /** The store write: scoped client, status alone, fenced on `accepted` and `expectedUpdatedAt`. */
  reset: (id: string, expectedUpdatedAt: string) => Promise<ProposalRow>;
  /** Maps a thrown failure to the fixed sentence the person reads. */
  describe: (err: unknown, fallback: string) => ActionState;
  revalidate: (id: string) => void;
};

export type ResetAcceptanceInput = { id: string; updatedAt: string };

export async function runResetAcceptance(deps: ResetAcceptanceDeps, input: ResetAcceptanceInput): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;

  let who: { role: Role | null; isApprover: boolean };
  try {
    who = await deps.authorize();
  } catch {
    return { error: RESET_NOT_ALLOWED };
  }
  if (!mayResetAcceptance(who.role, who.isApprover)) return { error: RESET_NOT_ALLOWED };

  let paid: ResetPaidRead;
  try {
    paid = await deps.paid(input.id);
  } catch {
    paid = "unavailable";
  }
  if (paid === "paid") return { error: RESET_PAID };
  if (paid !== "not_paid") return { error: RESET_PAID_UNREADABLE };

  try {
    await deps.reset(input.id, input.updatedAt);
  } catch (err) {
    return deps.describe(err, RESET_FAILED);
  }
  deps.revalidate(input.id);
  return { saved: true, notice: RESET_DONE };
}

/**
 * The history line of a `reset` event: "Acceptance reset by Taylor", with what it means and what the
 * earlier acceptance was (the legal fee only; the payload keeps the whole snapshot for the record).
 */
export function describeResetEvent(payload: Record<string, unknown>, who: string, formatDollars: (cents: number) => string): { text: string; details: string[] } {
  const details = ["The client link is live again, and the client can accept again."];
  const snap = payload.previous_snapshot;
  const quote = snap && typeof snap === "object" && !Array.isArray(snap) ? (snap as Record<string, unknown>).quote : null;
  const legal = quote && typeof quote === "object" ? (quote as Record<string, unknown>).legal_total_cents : null;
  if (typeof legal === "number" && Number.isFinite(legal)) {
    details.push(`The earlier acceptance (legal fee ${formatDollars(legal)}) is kept in this record.`);
  } else {
    details.push("The earlier acceptance is kept in this record.");
  }
  return { text: `Acceptance reset by ${who}`, details };
}
