import type { Direction } from "./waiting";

/**
 * "Last contact" from the timeline. Pure. Only these activity types count; nothing about a body is
 * read or kept. A note is contact (the team touched the record) but has no direction, so it never
 * decides whose turn it is.
 */
export const CONTACT_TYPES = ["email_sent", "email_received", "call_logged", "note", "voice_note"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export type ContactActivity = { type: string; created_at: string };

export type LastContact = { at: string; type: ContactType };

const DIRECTION: Record<ContactType, Direction | null> = {
  email_sent: "we",
  email_received: "they",
  call_logged: "we",
  note: null,
  voice_note: null,
};

const WORDS: Record<ContactType, string> = {
  email_sent: "we emailed",
  email_received: "they replied",
  call_logged: "we called",
  note: "we noted",
  voice_note: "we noted",
};

export function isContactType(value: string): value is ContactType {
  return (CONTACT_TYPES as readonly string[]).includes(value);
}

export function contactWords(type: ContactType): string {
  return WORDS[type];
}

export function contactDirection(type: ContactType): Direction | null {
  return DIRECTION[type];
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** The newest contact, and the newest DIRECTIONAL one (which decides whose turn it is). A future date is ignored. */
export function summarizeContact(
  activity: readonly ContactActivity[],
  now: Date,
): { last: LastContact | null; direction: Direction | null } {
  let last: { at: string; type: ContactType } | null = null;
  let directional: { at: string; type: ContactType } | null = null;
  for (const a of activity) {
    if (!isContactType(a.type)) continue;
    const t = ms(a.created_at);
    if (!Number.isFinite(t) || t > now.getTime()) continue;
    if (!last || t > ms(last.at)) last = { at: a.created_at, type: a.type };
    if (DIRECTION[a.type] && (!directional || t > ms(directional.at))) directional = { at: a.created_at, type: a.type };
  }
  return { last, direction: directional ? DIRECTION[directional.type] : null };
}
