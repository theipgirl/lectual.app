import type { Role } from "@/lib/auth/roles";
import type { ProposalStatus } from "@/lib/proposals/types";
import { notReadyYet } from "@/lib/ui/words";

/**
 * "Delete proposal" (needs lectual 0102): the firm's OWNER removes a whole offer, every version of
 * it, in any status. Taylor (2026-10-28) wanted to clear out test proposals herself.
 *
 * The database is the boundary: 0102's `client_proposal_delete_owner` lets role `owner` delete any
 * row of its own firm; admin / senior_admin keep 0089's drafts-only delete; nobody else deletes.
 * The family is deleted in ONE statement (`where family_id = ...`) because 0089's family foreign key
 * is NO ACTION: deleting v1 alone while v2 points at it fails, one statement removing all passes.
 * The audit log goes with it by cascade. Nothing is sent, nothing touches Lawmatics or LawPay.
 *
 * Pure: no database, no session. The store passes its reads and the delete in (like pay-link.ts),
 * so every refusal and the order of the steps are tested without a database. Every sentence a
 * person reads is fixed here; no database text ever reaches one.
 */

export const DELETE_LABEL = "Delete proposal";
export const DELETE_CONFIRM =
  "Delete this proposal and all its versions? The client link stops working and its history is removed. This can't be undone.";
export const DELETE_DONE = "Proposal deleted.";
export const DELETE_OWNER_ONLY = "Only the firm's owner can delete a proposal.";
export const DELETE_NOT_FOUND = "Proposal not found.";
export const DELETE_NEEDS_DB_UPDATE = notReadyYet("Deleting this proposal");
export const DELETE_PARTIAL = `Only the draft version was deleted. ${notReadyYet("Deleting the rest of this proposal")}`;
export const DELETE_FAILED = "Couldn't delete this proposal. Refresh and try again.";

/** Who sees the menu item and may run the action. Owner only: admin / senior_admin keep 0089's drafts-only rule elsewhere. */
export function canDeleteProposal(role: Role | null | undefined): boolean {
  return role === "owner";
}

export type DeleteTarget = { id: string; familyId: string; status: ProposalStatus };
export type FamilyMember = { id: string; status: ProposalStatus };

export type DeleteFamilyDeps = {
  /** The caller's role, re-read through the scoped client. null = unreadable (refused). */
  role: () => Promise<Role | null>;
  /** The row through the scoped client (RLS): null when missing or another firm's. */
  readRow: (id: string) => Promise<DeleteTarget | null>;
  /** Every version of the family the caller can see, through the scoped client. */
  readFamily: (familyId: string) => Promise<FamilyMember[]>;
  /** ONE statement: `delete ... where family_id = familyId`, returning the ids that went. */
  deleteFamily: (familyId: string) => Promise<string[]>;
};

export type DeleteFamilyResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string; /** True when some versions went (the opened one may be gone). */ partial?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runDeleteProposalFamily(deps: DeleteFamilyDeps, id: string): Promise<DeleteFamilyResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: DELETE_NOT_FOUND };
  try {
    const role = await deps.role();
    if (!canDeleteProposal(role)) return { ok: false, error: DELETE_OWNER_ONLY };

    const row = await deps.readRow(id);
    if (!row) return { ok: false, error: DELETE_NOT_FOUND };
    const family = await deps.readFamily(row.familyId);
    const expected = Math.max(family.length, 1);

    const gone = await deps.deleteFamily(row.familyId);
    if (gone.length === 0) {
      // RLS answered "nothing to delete": the row vanished in between, or (a fallback, 0102 is applied
      // since 2026-10-28) a database without 0102.
      return { ok: false, error: DELETE_NEEDS_DB_UPDATE };
    }
    if (gone.length < expected) {
      // A fallback only: 0102 is applied to dev and prod (2026-10-28). Without it, RLS lets the owner
      // delete only the family's drafts, so fewer rows than the family would go.
      return { ok: false, error: DELETE_PARTIAL, partial: true };
    }
    return { ok: true, deleted: gone.length };
  } catch {
    return { ok: false, error: DELETE_FAILED };
  }
}

export type MoreMenuItem = "withdraw" | "reset" | "delete";

/**
 * Which items the proposal page's "More" menu offers, in order. Withdraw: a proposal-writing role on a draft, saved or live version.
 * Reset acceptance (lectual 0101): an accepted version when `canResetAcceptance` said yes. Delete (lectual 0102): the owner, any
 * status; hidden, not disabled, for everyone else.
 */
export function moreMenuItems(input: { status: ProposalStatus; canWrite: boolean; canDelete: boolean; canReset?: boolean }): MoreMenuItem[] {
  const items: MoreMenuItem[] = [];
  if (input.canWrite && (input.status === "draft" || input.status === "approved" || input.status === "sent")) items.push("withdraw");
  if (input.canWrite && input.status === "accepted" && input.canReset) items.push("reset");
  if (input.canDelete) items.push("delete");
  return items;
}
