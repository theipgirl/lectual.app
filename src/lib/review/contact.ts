import type { Direction } from "./waiting";
import { effectiveDirection, isUsptoSender, NO_FIRM_SENDERS, USPTO_PARTY, type FirmSenders } from "@/lib/mailbox/firm-sender";

/**
 * "Last contact" from the timeline. Pure. Only these activity types count; nothing about a body is
 * read or kept. A note is contact (the team touched the record) but has no direction, so it never
 * decides whose turn it is.
 *
 * Email direction is read the way the mailbox sync now writes it: an `email_received` row whose sender
 * is one of the firm's own addresses (a cc from trademarks@ into info@, stored before the sync relabelled
 * firm mail) is the firm's email, and a USPTO notice (`payload.party = "uspto"`, or any @uspto.gov sender)
 * is contact with no direction: an office action keeps a row from looking quiet, but it is never
 * "they replied".
 */
export const CONTACT_TYPES = ["email_sent", "email_received", "call_logged", "note", "voice_note"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
/** What a contact is shown as: the stored type, or a USPTO notice. */
export type ContactKind = ContactType | "uspto_notice";

/** `from` / `party` are the two payload fields the review reads (`payload->>from`, `payload->>party`), nothing else. */
export type ContactActivity = { type: string; created_at: string; from?: string | null; party?: string | null };

export type LastContact = { at: string; type: ContactKind };

const DIRECTION: Record<ContactKind, Direction | null> = {
  email_sent: "we",
  email_received: "they",
  call_logged: "we",
  note: null,
  voice_note: null,
  uspto_notice: null,
};

const WORDS: Record<ContactKind, string> = {
  email_sent: "we emailed",
  email_received: "they replied",
  call_logged: "we called",
  note: "we noted",
  voice_note: "we noted",
  uspto_notice: "USPTO notice",
};

export function isContactType(value: string): value is ContactType {
  return (CONTACT_TYPES as readonly string[]).includes(value);
}

export function contactWords(type: ContactKind): string {
  return WORDS[type];
}

export function contactDirection(type: ContactKind): Direction | null {
  return DIRECTION[type];
}

/**
 * The kind one activity row counts as. `email_received` from the firm's own address is the firm's email;
 * from the USPTO it is a notice. Every other row is its stored type.
 */
export function contactKindOf(a: ContactActivity, senders: FirmSenders = NO_FIRM_SENDERS): ContactKind | null {
  if (!isContactType(a.type)) return null;
  if (a.type !== "email_received") return a.type;
  if (a.party === USPTO_PARTY || isUsptoSender(a.from)) return "uspto_notice";
  return effectiveDirection("inbound", a.from, senders) === "outbound" ? "email_sent" : "email_received";
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The newest contact, and the newest DIRECTIONAL one (which decides whose turn it is). A future date is ignored. */
export function summarizeContact(
  activity: readonly ContactActivity[],
  now: Date,
  senders: FirmSenders = NO_FIRM_SENDERS,
): { last: LastContact | null; direction: Direction | null; /** The newest OUTBOUND contact (we emailed or called), for "last followed up". */ lastOutbound: LastContact | null } {
  let outbound: LastContact | null = null;
  let last: LastContact | null = null;
  let directional: LastContact | null = null;
  for (const a of activity) {
    const kind = contactKindOf(a, senders);
    if (!kind) continue;
    const t = ms(a.created_at);
    if (!Number.isFinite(t) || t > now.getTime()) continue;
    if (!last || t > ms(last.at)) last = { at: a.created_at, type: kind };
    if (DIRECTION[kind] === "we" && (!outbound || t > ms(outbound.at))) outbound = { at: a.created_at, type: kind };
    if (DIRECTION[kind] && (!directional || t > ms(directional.at))) directional = { at: a.created_at, type: kind };
  }
  return { last, direction: directional ? DIRECTION[directional.type] : null, lastOutbound: outbound };
}
