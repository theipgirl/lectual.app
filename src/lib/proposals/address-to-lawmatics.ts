import "server-only";

import { createHash } from "node:crypto";
import { cleanSigningDetails, type SignerDetails } from "@/lib/loe/signing";
import { createAddress, readProspectContactId, updateAddress, type FetchLike, type GetFetchLike } from "@/lib/lawmatics/writes";
import type { LawmaticsAddressInput, LawmaticsAddressOwner } from "@/lib/lawmatics/contact-payload";
import type { AddressAction, AddressTrigger, AddressWrite } from "./address-events";
import type { SignedUploadTarget, SignedUploadToken } from "./loe-signed-upload";
import { isSignedSnapshot } from "./signed-state";
import { STEP_TEXT } from "./step-text";
import type { AcceptedSnapshot } from "./types";

/**
 * Writing the client's MAILING ADDRESS to Lawmatics (the step `address_to_lawmatics`, success word `added`). ONE core,
 * `writeAddressToLawmatics`, with two triggers (`address-events.ts`):
 *  - `details`: the client pressed Continue on "Your details" on `/p/<token>` (`details-address.ts`), so the address is already in
 *    Lawmatics when they reach the pay form. The address is the details they typed, cleaned with the signing normaliser.
 *  - `signed`: right after a signed acceptance (`accept-followups.ts`) and staff Try again (`paid-flow.ts`). The address comes ONLY
 *    from the signed snapshot (`accepted_snapshot.signing.details`, cleaned again here).
 * NOT VERIFIED AGAINST A LIVE LAWMATICS ACCOUNT: the request shapes come from the public API reference (`toAddressPayload`,
 * `POST /addresses`, `PATCH /addresses/:id`).
 *
 * ── NO DUPLICATE ADDRESSES ──────────────────────────────────────────────────
 * Each successful write records a salted sha256 of the cleaned address, the Lawmatics matter it went to and the address ids
 * Lawmatics returned (`previous`, read back by `lastAddressWrite`). Then:
 *  - same address, same matter: nothing is requested (`action: unchanged`);
 *  - a different address on the same matter: the earlier records are changed in place (`PATCH`); an id we never got, or a 404,
 *    falls back to creating one;
 *  - a different matter (the record the proposal links to changed): written fresh there.
 * Concurrent writes (two Continue presses at once, or Continue racing the signing) are not serialised: they can still create two.
 *
 * It goes to the matter (the `Prospect` the acceptance note goes to) and, when the matter names its Contact, a copy goes to the
 * Contact. A contact that can't be found or read, or whose copy is refused, never fails the step: the matter's address is the one
 * that counts, and the step says so in a fixed sentence.
 *
 * Outcomes: `added`; `skipped` (the firm has no Lawmatics connection); `blocked` (no signed letter, no usable address, or no one
 * Lawmatics record to attach it to: a person can fix it); `failed` (the request, the connection check or the record lookup went
 * wrong: the reason is an HTTP status or a fixed sentence). No part of the address is ever put in a reason, an event or a log, and
 * no Lawmatics response text is kept. It never reads or changes the acceptance and never runs another step.
 */

export type AddressStepResult = {
  outcome: "added" | "skipped" | "blocked" | "failed";
  reason?: string;
  /** The event payload's ids: trigger, and for a write the hash, target, address ids and action. Never address text. */
  extra?: Record<string, string>;
};

export const ADDRESS_CONTACT_NOTE = "Added to the matter. The copy on the contact wasn't added.";

/** The address part of what the client typed, cleaned again, or null when it has no street and city (nothing worth writing). */
export function addressFromDetails(raw: SignerDetails | unknown): LawmaticsAddressInput | null {
  const d = cleanSigningDetails(raw);
  if (!d.street || !d.city) return null;
  return { street: d.street, street2: d.street2 || null, city: d.city, region: d.region || null, postal: d.postal || null, country: d.country || null };
}

/** The address the signer gave, from the signed snapshot, or null when it has no street and city (nothing worth writing). */
export function signedAddress(snapshot: AcceptedSnapshot | null | undefined): LawmaticsAddressInput | null {
  if (!isSignedSnapshot(snapshot)) return null;
  return addressFromDetails(snapshot?.signing?.details);
}

/**
 * The fingerprint the dedupe compares: sha256 over the proposal id and the cleaned address parts. Salted with the proposal id so the
 * same address on two proposals hashes differently. Stored in the step event; the address itself never is.
 */
export function addressSha256(proposalId: string, address: LawmaticsAddressInput): string {
  const parts = [proposalId, address.street, address.street2 ?? "", address.city, address.region ?? "", address.postal ?? "", address.country ?? ""];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export type AddressStepDeps = {
  /** The firm's OWN Lawmatics token. Never an env token. */
  token: () => Promise<SignedUploadToken>;
  /** The Lawmatics matter the proposal belongs to (the existing note-target resolution). */
  target: () => Promise<SignedUploadTarget>;
  fetchImpl?: FetchLike;
  getFetchImpl?: GetFetchLike;
  /** The version's id: salts the address hash. */
  proposalId?: string;
  /** The last successful write of this round (`lastAddressWrite`), or null. */
  previous?: AddressWrite | null;
};

type Put = { ok: true; id: string | null; updated: boolean } | { ok: false; reason: string };

/** PATCH the earlier record when we have its id; a 404 (or no id) creates one. */
async function putAddress(token: string, address: LawmaticsAddressInput, owner: LawmaticsAddressOwner, earlierId: string | null, deps: AddressStepDeps): Promise<Put> {
  if (earlierId) {
    const r = await updateAddress(token, earlierId, address, owner, deps.fetchImpl);
    if (r.ok) return { ok: true, id: r.id, updated: true };
    if (r.status !== 404) return { ok: false, reason: r.reason };
  }
  const c = await createAddress(token, address, owner, deps.fetchImpl);
  return c.ok ? { ok: true, id: c.id, updated: false } : { ok: false, reason: c.reason };
}

/** Never throws. `address` null is "nothing to add" (`blocked`). */
export async function writeAddressToLawmatics(address: LawmaticsAddressInput | null, trigger: AddressTrigger, deps: AddressStepDeps): Promise<AddressStepResult> {
  const base: Record<string, string> = { trigger };
  try {
    if (!address) return { outcome: "blocked", reason: STEP_TEXT.addressNoAddress, extra: base };

    const token = await deps.token();
    if (token.status === "not_connected") return { outcome: "skipped", reason: STEP_TEXT.addressNotConnected, extra: base };
    if (token.status === "unavailable") return { outcome: "failed", reason: STEP_TEXT.addressConnectionUnreadable, extra: base };

    const target = await deps.target();
    if (!target.ok) return { outcome: target.kind, reason: target.reason, extra: base };

    const hash = addressSha256(deps.proposalId ?? "", address);
    const written = { ...base, address_sha256: hash, target_id: target.lawmaticsId };
    // Only records on the SAME matter are reused: a write that went to another record is never changed from here.
    const previous = deps.previous && deps.previous.targetId === target.lawmaticsId ? deps.previous : null;
    const ids = (matter: string | null, contact: string | null): Record<string, string> => ({
      ...(matter ? { matter_address_id: matter } : {}),
      ...(contact ? { contact_address_id: contact } : {}),
    });

    if (previous && previous.hash === hash) {
      // Already in Lawmatics exactly as given: no request.
      const action: AddressAction = "unchanged";
      return { outcome: "added", extra: { ...written, action, ...ids(previous.matterAddressId, previous.contactAddressId) } };
    }

    const onMatter = await putAddress(token.token, address, { type: "Prospect", id: target.lawmaticsId }, previous?.matterAddressId ?? null, deps);
    if (!onMatter.ok) return { outcome: "failed", reason: onMatter.reason, extra: base };
    const action: AddressAction = onMatter.updated ? "updated" : "created";

    // The Contact copy is a bonus: the matter's address already landed, so nothing below can fail the step. When the contact
    // can't be read, the earlier contact record's id is kept so a later change can still update it.
    const contact = await readProspectContactId(token.token, target.lawmaticsId, deps.getFetchImpl);
    if (!contact.ok) return { outcome: "added", reason: ADDRESS_CONTACT_NOTE, extra: { ...written, action, ...ids(onMatter.id, previous?.contactAddressId ?? null) } };
    if (!contact.contactId) return { outcome: "added", extra: { ...written, action, ...ids(onMatter.id, null) } };
    const onContact = await putAddress(token.token, address, { type: "Contact", id: contact.contactId }, previous?.contactAddressId ?? null, deps);
    return onContact.ok
      ? { outcome: "added", extra: { ...written, action, ...ids(onMatter.id, onContact.id) } }
      : { outcome: "added", reason: ADDRESS_CONTACT_NOTE, extra: { ...written, action, ...ids(onMatter.id, previous?.contactAddressId ?? null) } };
  } catch {
    return { outcome: "failed", reason: "unexpected error", extra: base };
  }
}

/** The signed trigger. Never throws. `snapshot` must be the version's accepted snapshot: anything but a signed one is "nothing to add". */
export async function runAddressToLawmatics(snapshot: AcceptedSnapshot | null | undefined, deps: AddressStepDeps): Promise<AddressStepResult> {
  if (!isSignedSnapshot(snapshot)) return { outcome: "blocked", reason: STEP_TEXT.addressNoLetter, extra: { trigger: "signed" } };
  return writeAddressToLawmatics(signedAddress(snapshot), "signed", deps);
}
