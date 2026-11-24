/**
 * Who a consult prep email may go to (pure). The guard runs before EVERY send and again when the setting is saved:
 *
 *   To    current members' addresses (resolved by the caller from the member list, fenced on the firm)
 *   Cc    a bare address whose domain equals the domain of at least one To address; on a public webmail domain (the list in
 *         `mailbox/firm-sender.ts`) the domain proves nothing, so the Cc must equal a member address exactly
 *   never anything equal to the lead's own address, or to any address in the brief's client fields
 *   no To left  = no send (counted; the panel says recipients aren't set)
 */

import { isPublicMailDomain } from "@/lib/mailbox/firm-sender";

export const CONSULT_PREP_KEY = "consult_prep_recipients";
/** The most Cc addresses one firm may list. */
export const MAX_CC = 5;

export type RecipientSetting = { userIds: string[]; cc: string[] };

const BARE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** A bare address, lowercased, or null. A display name, a list, a comma or anything with a space is not one. */
export function bareAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 254 || !BARE.test(v)) return null;
  return v.toLowerCase();
}

export const domainOf = (address: string): string => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/** One rule for save time and send time: a Cc is allowed on a To member's domain, and on a public webmail domain only when it IS a member's address. */
function ccAllowed(address: string, toDomains: ReadonlySet<string>, members: ReadonlySet<string>): boolean {
  if (isPublicMailDomain(domainOf(address))) return members.has(address);
  return toDomains.has(domainOf(address));
}

/** The firm note's data. A value that is not the right shape reads as nothing. */
export function parseRecipientSetting(data: unknown): RecipientSetting {
  const d = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const ids = Array.isArray(d.user_ids) ? d.user_ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  const cc = Array.isArray(d.cc) ? d.cc.map(bareAddress).filter((x): x is string => x !== null) : [];
  return { userIds: [...new Set(ids)], cc: [...new Set(cc)] };
}

export type GuardInput = {
  /** Members' addresses (current members only, resolved by the caller). */
  to: readonly (string | null | undefined)[];
  cc: readonly string[];
  /** Every address of the client the brief carries (the lead's own, a Lawmatics contact's). */
  clientAddresses: readonly (string | null | undefined)[];
};

export type GuardResult = { to: string[]; cc: string[]; refusedCc: number; refusedTo: number };

export function guardRecipients(input: GuardInput): GuardResult {
  const client = new Set(input.clientAddresses.map((a) => bareAddress(a)).filter((a): a is string => a !== null));
  const toAll = [...new Set(input.to.map((a) => bareAddress(a)).filter((a): a is string => a !== null))];
  const to = toAll.filter((a) => !client.has(a));
  const toDomains = new Set(to.map(domainOf));
  const members = new Set(toAll);
  const ccAll = [...new Set(input.cc.map((a) => bareAddress(a)).filter((a): a is string => a !== null))];
  const cc = ccAll.filter((a) => !client.has(a) && ccAllowed(a, toDomains, members) && !to.includes(a)).slice(0, MAX_CC);
  return { to, cc, refusedTo: toAll.length - to.length, refusedCc: input.cc.length - cc.length };
}

/**
 * The check when the setting is saved: every typed Cc must be a bare address on a To member's domain.
 * (The lead is not known here; the send-time guard covers it.) Returns the cleaned list or a fixed reason.
 */
export function validateCcForSave(typed: readonly string[], toAddresses: readonly (string | null | undefined)[]): { ok: true; cc: string[] } | { ok: false; reason: "format" | "domain" | "count" } {
  const toBare = toAddresses.map((a) => bareAddress(a)).filter((a): a is string => a !== null);
  const toDomains = new Set(toBare.map(domainOf));
  const members = new Set(toBare);
  const cleaned: string[] = [];
  for (const raw of typed) {
    if (!raw.trim()) continue;
    const a = bareAddress(raw);
    if (!a) return { ok: false, reason: "format" };
    if (!ccAllowed(a, toDomains, members)) return { ok: false, reason: "domain" };
    if (!cleaned.includes(a)) cleaned.push(a);
  }
  if (cleaned.length > MAX_CC) return { ok: false, reason: "count" };
  return { ok: true, cc: cleaned };
}

/** Splits what a person typed into addresses: commas, semicolons, spaces and line breaks all separate. */
export function splitTypedAddresses(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}
