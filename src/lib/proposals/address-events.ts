/**
 * The mailing-address step (`address_to_lawmatics`) has TWO triggers, and these pure functions read them back from the version's
 * step events. Client-safe: no database, no clock, no `server-only`.
 *
 *  - `details`: the client finished "Your details" on `/p/<token>` and pressed Continue (before signing).
 *  - `signed`: the acceptance follow-ups after a signed acceptance, and staff Try again. An older event with no `trigger` key was
 *    written by this trigger (the only one there was).
 *
 * A successful write records, as ids only: `address_sha256` (a hash of the cleaned address, salted with the proposal id), `target_id`
 * (the Lawmatics matter it was written to), `matter_address_id` / `contact_address_id` (the address records Lawmatics returned) and
 * `action` (`created`, `updated`, `unchanged`). Never the address itself. "The last write" is the newest successful one of the
 * CURRENT round (after the version's newest reset, `currentRound`), so a reset starts over.
 */

import { currentRound, readStep, STEP_SUCCESS, type StepEventInput } from "./paid";

export const ADDRESS_STEP = "address_to_lawmatics" as const;

export type AddressTrigger = "details" | "signed";
export type AddressAction = "created" | "updated" | "unchanged";

/** What the last successful write left behind, read from its event. */
export type AddressWrite = {
  hash: string;
  targetId: string;
  matterAddressId: string | null;
  contactAddressId: string | null;
  trigger: AddressTrigger;
};

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function addressTriggerOf(payload: Record<string, unknown> | null | undefined): AddressTrigger {
  return payload?.trigger === "details" ? "details" : "signed";
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

type AddressEvent = { at: string; outcome: string; reason: string | null; payload: Record<string, unknown> };

/** This version's address events of the current round, newest first. */
function addressEvents(events: readonly StepEventInput[], proposalId: string): AddressEvent[] {
  const out: AddressEvent[] = [];
  for (const e of currentRound(events, proposalId)) {
    if (e.proposal_id !== undefined && e.proposal_id !== null && e.proposal_id !== proposalId) continue;
    const parsed = readStep(e.payload);
    if (!parsed || parsed.step !== ADDRESS_STEP) continue;
    out.push({ at: e.created_at, outcome: parsed.outcome, reason: parsed.reason, payload: parsed.payload });
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at));
}

/** The newest successful write of this round that recorded what it wrote, or null (none yet, or only older events with no hash). */
export function lastAddressWrite(events: readonly StepEventInput[], proposalId: string): AddressWrite | null {
  for (const e of addressEvents(events, proposalId)) {
    if (e.outcome !== STEP_SUCCESS[ADDRESS_STEP]) continue;
    const p = e.payload;
    if (typeof p.address_sha256 !== "string" || !HASH.test(p.address_sha256) || typeof p.target_id !== "string" || !p.target_id) continue;
    return {
      hash: p.address_sha256,
      targetId: p.target_id,
      matterAddressId: typeof p.matter_address_id === "string" && ID.test(p.matter_address_id) ? p.matter_address_id : null,
      contactAddressId: typeof p.contact_address_id === "string" && ID.test(p.contact_address_id) ? p.contact_address_id : null,
      trigger: addressTriggerOf(p),
    };
  }
  return null;
}

/**
 * Whether the SIGNED trigger already succeeded this round. A success from the details trigger does not count: the signed run must
 * still compare the signed address with what was written (same = recorded with no request, different = updated).
 */
export function signedAddressDone(events: readonly StepEventInput[], proposalId: string): boolean {
  return addressEvents(events, proposalId).some((e) => e.outcome === STEP_SUCCESS[ADDRESS_STEP] && addressTriggerOf(e.payload) === "signed");
}

/** The newest address event of this round (any outcome), or null. The details trigger uses it not to repeat the same refusal. */
export function newestAddressEvent(events: readonly StepEventInput[], proposalId: string): { outcome: string; reason: string | null; trigger: AddressTrigger } | null {
  const e = addressEvents(events, proposalId)[0];
  return e ? { outcome: e.outcome, reason: e.reason, trigger: addressTriggerOf(e.payload) } : null;
}

/* ─────────────────────────── words (staff only) ─────────────────────────── */

export const ADDRESS_DONE_TEXT = {
  /** An event with no trigger: written after signing, before the details trigger existed. */
  legacy: "Mailing address added to Lawmatics.",
  detailsCreated: "Mailing address added to Lawmatics when the client entered their details.",
  detailsUpdated: "Mailing address updated in Lawmatics when the client changed their details.",
  signedUnchanged: "Mailing address added to Lawmatics when the client entered their details. It was the same when they signed.",
  signedUpdated: "Mailing address updated in Lawmatics when the client signed.",
  signedCreated: "Mailing address added to Lawmatics after the client signed.",
} as const;

/** The staff sentence for a successful address event, by which trigger wrote it and what it did. */
export function addressDoneText(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || (payload.trigger !== "details" && payload.trigger !== "signed")) return ADDRESS_DONE_TEXT.legacy;
  const action = payload.action;
  if (payload.trigger === "details") return action === "updated" ? ADDRESS_DONE_TEXT.detailsUpdated : ADDRESS_DONE_TEXT.detailsCreated;
  if (action === "unchanged") return ADDRESS_DONE_TEXT.signedUnchanged;
  if (action === "updated") return ADDRESS_DONE_TEXT.signedUpdated;
  return ADDRESS_DONE_TEXT.signedCreated;
}
