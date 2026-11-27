import type { CloserReason } from "@/lib/queue/deck";

/**
 * The lead page's "closer look" rule, one step stricter than the deck's: on top of `needsCloserLook` (CHECK FIRST, a
 * draft issue, a stale draft, a refused linked-proposal gate), an email whose linked proposal is anything but LIVE
 * ("sent") needs the full approval page too. The approve core would turn a saved proposal's client link on as part of
 * the yes, and a one-tap Yes on the lead page must never do that silently.
 *
 * `gate` is the linked-proposal gate's own answer (`gateLinkedProposal`); null means it couldn't be read. The result is
 * null when the check couldn't run, which keeps Yes off this page. No imports beyond types.
 */
export type LeadCloserLook = { reasons: CloserReason[]; linkNotLive: boolean };

export function leadCloserLook(reasons: CloserReason[] | null, gate: { ok: boolean; proposal?: { status: string } | null } | null): LeadCloserLook | null {
  if (reasons === null || gate === null) return null;
  const linkNotLive = gate.ok && !!gate.proposal && gate.proposal.status !== "sent";
  const out = [...reasons];
  if (linkNotLive && !out.includes("linked-proposal")) out.push("linked-proposal");
  return { reasons: out, linkNotLive };
}
