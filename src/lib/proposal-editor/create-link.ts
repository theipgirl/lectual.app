import type { ProposalRow } from "@/lib/proposals/types";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { LINK_CREATED, LINK_NOT_TURNED_ON } from "./vocabulary";

/**
 * "Save and create link": the existing approve transition, then the existing send
 * transition (`client_proposal_send`, which only makes the client link live; no client is
 * contacted). Dependencies are passed in so the order and the failure between the two steps are
 * tested without a database. Nothing else is reachable from here.
 */
export type CreateLinkDeps = {
  /** The module gate and staff-role check; a refusal is returned as is. */
  gate: () => Promise<ActionState | null>;
  approve: (id: string) => Promise<ProposalRow>;
  makeLive: (id: string) => Promise<ProposalRow>;
  /** Maps a thrown failure to the fixed sentence the person reads. */
  describe: (err: unknown, fallback: string) => ActionState;
  revalidate: (id: string) => void;
};

export async function runCreateLink(deps: CreateLinkDeps, id: string): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;

  try {
    await deps.approve(id);
  } catch (err) {
    // Not an approver, blocking errors, a row that moved: the send step is never tried.
    return deps.describe(err, "Couldn't save this proposal.");
  }

  try {
    await deps.makeLive(id);
  } catch {
    // The approval persisted, so the page now reads "Saved" and offers "Turn on the link".
    deps.revalidate(id);
    return { error: LINK_NOT_TURNED_ON };
  }

  deps.revalidate(id);
  return { saved: true, notice: LINK_CREATED };
}
