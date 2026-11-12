import "server-only";

import { cleanSigningDetails } from "@/lib/loe/signing";
import { createAddress, readProspectContactId, type FetchLike, type GetFetchLike } from "@/lib/lawmatics/writes";
import type { LawmaticsAddressInput } from "@/lib/lawmatics/contact-payload";
import type { SignedUploadTarget, SignedUploadToken } from "./loe-signed-upload";
import { isSignedSnapshot } from "./signed-state";
import { STEP_TEXT } from "./step-text";
import type { AcceptedSnapshot } from "./types";

/**
 * Writing the signer's MAILING ADDRESS to Lawmatics right after they sign (the step `address_to_lawmatics`, success word `added`).
 * NOT VERIFIED AGAINST A LIVE LAWMATICS ACCOUNT: the request shape comes from the public API reference (`toAddressPayload`).
 *
 * The address comes ONLY from the signed snapshot (`accepted_snapshot.signing.details`, cleaned again here), never from the browser.
 * It is attached to the matter (the `Prospect` the acceptance note goes to) and, when the matter names its Contact, a copy is
 * attached to the Contact too. A contact that can't be found or read, or whose copy is refused, never fails the step: the matter's
 * address is the one that counts, and the step says so in a fixed sentence.
 *
 * Outcomes: `added`; `skipped` (the firm has no Lawmatics connection); `blocked` (no signed letter, no usable address, or no one
 * Lawmatics record to attach it to: a person can fix it); `failed` (the request, the connection check or the record lookup went
 * wrong: the reason is an HTTP status or a fixed sentence). No part of the address is ever put in a reason, an event or a log.
 * It never reads or changes the acceptance and never runs another step.
 */

export type AddressStepResult = { outcome: "added" | "skipped" | "blocked" | "failed"; reason?: string };

export const ADDRESS_CONTACT_NOTE = "Added to the matter. The copy on the contact wasn't added.";

/** The address the signer gave, from the signed snapshot, or null when it has no street and city (nothing worth writing). */
export function signedAddress(snapshot: AcceptedSnapshot | null | undefined): LawmaticsAddressInput | null {
  if (!isSignedSnapshot(snapshot)) return null;
  const d = cleanSigningDetails(snapshot?.signing?.details);
  if (!d.street || !d.city) return null;
  return { street: d.street, street2: d.street2 || null, city: d.city, region: d.region || null, postal: d.postal || null, country: d.country || null };
}

export type AddressStepDeps = {
  /** The firm's OWN Lawmatics token. Never an env token. */
  token: () => Promise<SignedUploadToken>;
  /** The Lawmatics matter the proposal belongs to (the existing note-target resolution). */
  target: () => Promise<SignedUploadTarget>;
  fetchImpl?: FetchLike;
  getFetchImpl?: GetFetchLike;
};

/** Never throws. `snapshot` must be the version's accepted snapshot: anything but a signed one is "nothing to add". */
export async function runAddressToLawmatics(snapshot: AcceptedSnapshot | null | undefined, deps: AddressStepDeps): Promise<AddressStepResult> {
  try {
    if (!isSignedSnapshot(snapshot)) return { outcome: "blocked", reason: STEP_TEXT.addressNoLetter };
    const address = signedAddress(snapshot);
    if (!address) return { outcome: "blocked", reason: STEP_TEXT.addressNoAddress };

    const token = await deps.token();
    if (token.status === "not_connected") return { outcome: "skipped", reason: STEP_TEXT.addressNotConnected };
    if (token.status === "unavailable") return { outcome: "failed", reason: STEP_TEXT.addressConnectionUnreadable };

    const target = await deps.target();
    if (!target.ok) return { outcome: target.kind, reason: target.reason };

    const onMatter = await createAddress(token.token, address, { type: "Prospect", id: target.lawmaticsId }, deps.fetchImpl);
    if (!onMatter.ok) return { outcome: "failed", reason: onMatter.reason };

    // The Contact copy is a bonus: the matter's address already landed, so nothing below can fail the step.
    const contact = await readProspectContactId(token.token, target.lawmaticsId, deps.getFetchImpl);
    if (!contact.ok) return { outcome: "added", reason: ADDRESS_CONTACT_NOTE };
    if (!contact.contactId) return { outcome: "added" };
    const onContact = await createAddress(token.token, address, { type: "Contact", id: contact.contactId }, deps.fetchImpl);
    return onContact.ok ? { outcome: "added" } : { outcome: "added", reason: ADDRESS_CONTACT_NOTE };
  } catch {
    return { outcome: "failed", reason: "unexpected error" };
  }
}
