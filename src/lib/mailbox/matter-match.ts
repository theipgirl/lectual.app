import { isPlaceholderEmail, participantsOf, type ThreadMessage } from "@/lib/intake/email-match";

/**
 * Which matter is this message about? Pure: no database, no network. The sync loads the rows and calls this.
 *
 * Route 1, the matter's CONTACTS (crm_matter_contact, 0048), with the lead matcher's rule: refuse rather than guess.
 *   1. Only an exact ADDRESS match counts.
 *   2. The matched contacts' matters are collected. One matter → that matter.
 *   3. Several (a client with three marks) → the one whose mark appears in the subject, if exactly one does.
 *
 * Route 2, the matter's own facts (`matchMatterEvidence`), for a firm whose contacts were never filled in. Tried
 * only when route 1 found nothing, in this order, and each step returns exactly ONE open matter or nothing:
 *   a. an 8-digit USPTO serial number in the subject or preview equal to a matter's `serial_number`;
 *   b. the matter's mark name as a WHOLE phrase in the subject or preview (decorations stripped, 4+ letters, not
 *      a word the firm's own subjects always carry, and not a shorter mark swallowed by a longer one that also
 *      appears). Two or more matters → "logo"/"design" vs "word" in the text may pick one, then the owner's full
 *      name; otherwise nothing (word + logo of one owner file on neither rather than on a guess);
 *   c. a participant address equal to the email of the matter's linked lead, when that address belongs to
 *      exactly one open matter.
 *   The owner's name alone never matches. Filing mail on the wrong matter makes the right one look neglected.
 */

export type MatterContact = { contactId: string; email: string | null };
export type MatterLink = { contactId: string; matterId: string; markText: string | null };

/** One OPEN matter, as route 2 needs it. No notes, no goods. */
export type MatterCandidate = {
  matterId: string;
  markText: string | null;
  serialNumber: string | null;
  /** The linked lead's address(es): the lead's own and, for a merged lead, its keeper's. */
  leadEmails: readonly string[];
  ownerName: string | null;
};

/** What route 2 reads from a message. A stored activity row (subject, from, to) fits too, with no preview. */
export type MatterEvidence = {
  subject: string | null;
  preview?: string | null;
  /** Every address the message names (from, to, cc). The connected mailbox and firm addresses never matter here. */
  participants: readonly (string | null | undefined)[];
};

export type MatterBasis = "contact-email" | "contact-email+mark" | "serial" | "mark" | "lead-email";
export type MatterMatch = { matterId: string; basis: MatterBasis } | null;

function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-cased, diacritics and quotes folded, every run of non-letters/digits a single space, padded with spaces. */
function phraseText(raw: string): string {
  const words = fold(raw)
    .replace(/[‘’‚‛′'`]/g, "") // "Rayn's" and "Rayn’s" read the same
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words ? ` ${words} ` : " ";
}

export type MarkKind = "word" | "logo" | null;

/**
 * The mark's name as a client or examiner would write it, plus which kind the decoration said:
 * "Jay Mompre (Logo Mark)" → "jay mompre" / logo; "Word Mark- Highway Homes" → "highway homes" / word;
 * "Highway Homes LLC" → "highway homes". Returns an empty name when nothing usable is left.
 */
export function markName(markText: string | null | undefined): { name: string; kind: MarkKind } {
  let raw = fold(markText ?? "").replace(/[“”„"]/g, "");
  let kind: MarkKind = null;
  const kindOf = (word: string): MarkKind => (word === "word" || word === "standard character" ? "word" : "logo");
  raw = raw.replace(/\(\s*(word|logo|design|standard character)\s*mark\s*\)/g, (_, w: string) => {
    kind = kindOf(w);
    return " ";
  });
  raw = raw.replace(/^\s*(word|logo|design)\s*mark\s*[-–—:]\s*/, (_, w: string) => {
    kind = kindOf(w);
    return "";
  });
  raw = raw.replace(/[\s,]+(llc|l\.l\.c\.|inc\.?|incorporated)\s*$/, "");
  const name = phraseText(raw).trim();
  return { name, kind };
}

/**
 * Single words the firm's own subjects carry on every message ("Office Action Received - U.S. Trademark
 * Application"): a mark that is only one of these would file every USPTO notice on it.
 */
const GENERIC_MARK_WORDS = new Set([
  "trademark",
  "trademarks",
  "application",
  "office",
  "action",
  "notice",
  "official",
  "notification",
  "filing",
  "receipt",
  "serial",
  "number",
  "registration",
  "proposal",
  "opinion",
  "availability",
  "consult",
  "consultation",
  "logo",
  "design",
  "word",
  "mark",
  "uspto",
  "received",
  "request",
  "extension",
  "your",
]);

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

/** 8-digit USPTO serial numbers named in the text: after "serial no./number/SN/application no.", or a bare 7/8/9/5-led 8-digit number. */
export function serialNumbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const labelled = /(?:serial\s*(?:no\.?|number|#)?|\bsn|application\s*(?:no\.?|number|#))\s*[:#.]?\s*(\d{2}[\s,/-]?\d{3}[\s,]?\d{3})(?!\d)/gi;
  for (const m of text.matchAll(labelled)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length === 8) out.add(digits);
  }
  for (const m of text.matchAll(/(?<![\d])([5789]\d{7})(?!\d)/g)) out.add(m[1]);
  return out;
}

function normalizeSerial(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 8 ? digits : null;
}

function cleanAddress(raw: string | null | undefined): string | null {
  const a = (raw ?? "").trim().toLowerCase();
  return a && a.includes("@") && !isPlaceholderEmail(a) ? a : null;
}

function byMark(text: string, matters: readonly MatterCandidate[]): MatterMatch {
  const named = matters
    .map((m) => ({ m, ...markName(m.markText) }))
    .filter(({ name }) => letterCount(name) >= 4 && !(name.split(" ").length === 1 && GENERIC_MARK_WORDS.has(name)))
    .filter(({ name }) => text.includes(` ${name} `));
  if (named.length === 0) return null;

  // A shorter mark inside a longer one that also appears ("Highway" in "Highway Homes") is the longer one's mail.
  const names = [...new Set(named.map((n) => n.name))];
  const kept = named.filter(({ name }) => !names.some((other) => other !== name && ` ${other} `.includes(` ${name} `)));
  const ids = new Set(kept.map((k) => k.m.matterId));
  if (ids.size === 1) return { matterId: kept[0].m.matterId, basis: "mark" };

  // Several matters: word vs logo, when the text says exactly one kind and exactly one matter is that kind.
  const saysLogo = /\s(logo|design)\s/.test(text);
  const saysWord = /\s(word|standard character)\s/.test(text);
  if (saysLogo !== saysWord) {
    const want: MarkKind = saysLogo ? "logo" : "word";
    const ofKind = new Set(kept.filter((k) => k.kind === want).map((k) => k.m.matterId));
    if (ofKind.size === 1) return { matterId: [...ofKind][0], basis: "mark" };
  }

  // Then the owner's full name (two words or more) as a phrase, alongside the mark: never the owner alone.
  const byOwner = new Set(
    kept
      .filter((k) => {
        const owner = phraseText(k.m.ownerName ?? "").trim();
        return owner.split(" ").length >= 2 && letterCount(owner) >= 4 && text.includes(` ${owner} `);
      })
      .map((k) => k.m.matterId),
  );
  if (byOwner.size === 1) return { matterId: [...byOwner][0], basis: "mark" };
  return null;
}

/**
 * Route 2 on its own (serial, then mark phrase, then lead email). Exported for the one-off backfill, which reads
 * stored activity rows: pass the subject, no preview, and the stored from/to as `participants`.
 */
export function matchMatterEvidence(evidence: MatterEvidence, matters: readonly MatterCandidate[]): MatterMatch {
  if (matters.length === 0) return null;
  const rawText = `${evidence.subject ?? ""}\n${evidence.preview ?? ""}`;

  // a. serial number
  const serials = serialNumbersIn(rawText);
  if (serials.size > 0) {
    const hits = new Set(matters.filter((m) => {
      const s = normalizeSerial(m.serialNumber);
      return s !== null && serials.has(s);
    }).map((m) => m.matterId));
    if (hits.size === 1) return { matterId: [...hits][0], basis: "serial" };
    if (hits.size > 1) return null; // one serial on two matters is bad data: never guess
  }

  // b. mark phrase
  const mark = byMark(phraseText(rawText), matters);
  if (mark) return mark;

  // c. the linked lead's address
  const addresses = new Set(evidence.participants.map(cleanAddress).filter((a): a is string => !!a));
  if (addresses.size === 0) return null;
  const byLead = new Set(
    matters.filter((m) => m.leadEmails.some((e) => {
      const a = cleanAddress(e);
      return a !== null && addresses.has(a);
    })).map((m) => m.matterId),
  );
  return byLead.size === 1 ? { matterId: [...byLead][0], basis: "lead-email" } : null;
}

export function matchMessageToMatter(
  message: ThreadMessage,
  contacts: readonly MatterContact[],
  links: readonly MatterLink[],
  matters: readonly MatterCandidate[] = [],
): MatterMatch {
  const mailbox = message.mailbox.trim().toLowerCase();
  const addresses = new Set(
    participantsOf(message)
      .map((p) => p.address?.trim().toLowerCase())
      .filter((a): a is string => !!a),
  );
  // The connected mailbox itself is never evidence about a client.
  addresses.delete(mailbox);

  const byContact = matchByContacts(message, addresses, contacts, links);
  if (byContact) return byContact;

  return matchMatterEvidence(
    { subject: message.subject, preview: message.preview, participants: [...addresses] },
    matters,
  );
}

function matchByContacts(
  message: ThreadMessage,
  addresses: ReadonlySet<string>,
  contacts: readonly MatterContact[],
  links: readonly MatterLink[],
): MatterMatch {
  const contactIds = new Set(
    contacts
      .filter((c) => {
        const email = c.email?.trim().toLowerCase() ?? "";
        return email && !isPlaceholderEmail(email) && addresses.has(email);
      })
      .map((c) => c.contactId),
  );
  if (contactIds.size === 0) return null;

  const matters = new Map<string, string | null>();
  for (const link of links) {
    if (contactIds.has(link.contactId)) matters.set(link.matterId, link.markText);
  }
  if (matters.size === 0) return null;
  if (matters.size === 1) return { matterId: [...matters.keys()][0], basis: "contact-email" };

  const subject = fold(message.subject ?? "");
  const hits = [...matters.entries()].filter(([, mark]) => {
    const m = fold(mark ?? "");
    return m.length >= 3 && subject.includes(m);
  });
  return hits.length === 1 ? { matterId: hits[0][0], basis: "contact-email+mark" } : null;
}
