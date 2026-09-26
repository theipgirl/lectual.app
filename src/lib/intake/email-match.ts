/**
 * Email evidence for the Monday intake view (blueprint §12.2) — pure.
 *
 * The firm's question is "did the follow-up go out, and has this person
 * replied", and §1 row 1.7 says nobody should have to type the answer. This
 * module turns a window of shared-mailbox messages into that answer: which lead
 * each message belongs to, what kind of email it was, the cadence per lead, and
 * the diff between what the spreadsheet's notes claim and what the mailbox
 * shows.
 *
 * Nothing here sends, drafts, or writes. Nothing here reaches Lawmatics. It
 * takes messages in and returns findings; scripts/sync-intake-email.ts is the
 * only thing that writes, and only under --apply.
 *
 * MESSAGE CONTENT IS UNTRUSTED DATA. Subjects and previews are matched against
 * keyword tables and never interpreted as instructions. Nothing here is legal
 * advice and no classification is a legal conclusion — `type` is the firm's own
 * filing vocabulary for its own mail.
 *
 * No getScopedClient, no server-only import: same discipline as ./scope and
 * ./reply, so this is safe to bundle and safe to import from scripts/ by
 * relative path under bare tsx.
 */

import type { NoteEntry } from "@/lib/matters/tracker-import";
import { initialsFor } from "./initials";
import type { Party, ThreadMessage } from "./email-threads";

export type { Party, ThreadMessage } from "./email-threads";

// ── the leads we match against ───────────────────────────────────────────────

/** The slice of crm_lead matching needs. Structurally satisfied by a Lead row. */
export type MatchLead = {
  id: string;
  firstName: string;
  lastName: string;
  businessName: string | null;
  /** May be the reserved .invalid placeholder — see isPlaceholderEmail. */
  email: string | null;
  markText: string | null;
};

/** The slice of the org roster sender attribution needs. */
export type EmailDirectoryMember = {
  userId: string;
  email: string | null;
  displayName: string | null;
};

export type MatchBasis = "email" | "name" | "mark";

export type EmailMatchCandidate = {
  leadId: string;
  confidence: number;
  basis: MatchBasis;
};

export type ResolvedMatch =
  | { leadId: string; confidence: number; basis: MatchBasis }
  | { ambiguous: true; candidates: EmailMatchCandidate[] }
  | null;

/**
 * The confidence ladder, straight out of §12.2.
 *
 * `email` is 1.0 because an address is an identity, not a resemblance. Name and
 * mark together is 0.9 — two independent weak signals agreeing. Name alone is
 * exactly at the 0.7 logging threshold; mark alone is below it, because a mark
 * appears in the subject of every message about that mark, including one from
 * an examiner, a vendor, or the client's designer.
 */
export const CONFIDENCE = {
  email: 1.0,
  nameAndMark: 0.9,
  name: 0.7,
  mark: 0.5,
} as const;

/** At or above this, a match may be written. Below it, a human reads the report. */
export const LOG_THRESHOLD = CONFIDENCE.name;

/** At or above this, a placeholder address may be replaced with a real one. */
export const RECOVER_THRESHOLD = CONFIDENCE.nameAndMark;

// ── text normalization ───────────────────────────────────────────────────────

/** Diacritic-folded, lower-cased, whitespace-collapsed. Matching only. */
function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Honorifics and suffixes are not names. "Dr. Patricia Morgan" and "Patricia
 * Morgan" are the same person, and the sheet writes one while Outlook writes
 * the other.
 */
const NON_NAME_TOKENS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "prof",
  "professor",
  "rev",
  "sir",
  "atty",
  "esq",
  "esquire",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
]);

/** A (first, last) reading of a name. `first` is null for a mononym. */
type NameForm = { first: string | null; last: string };

/**
 * Every way one written name could be read.
 *
 * The firm's records and the mail disagree in three predictable ways, so each
 * gets a form rather than a fuzzy score:
 *  · middle names ("Theo R. Vandermeer") — dropped, only first and last count
 *  · honorifics ("Dr. Patricia Morgan") — dropped
 *  · a nickname in parentheses ("Mireille (Mimi) Toussaint") — kept as an ALTERNATIVE
 *    first name, so it matches a lead filed as "Mimi Toussaint" in either direction
 *
 * An address in the name slot (Graph does this when there is no display name)
 * yields nothing: splitting "sarah@chen.example" on punctuation would invent a
 * first and last name out of a domain.
 */
export function nameForms(raw: string | null | undefined): NameForm[] {
  const text = (raw ?? "").trim();
  if (!text || text.includes("@")) return [];

  const nicknames: string[] = [];
  for (const m of text.matchAll(/\(([^)]*)\)/g)) {
    const inner = fold(m[1]).replace(/[^\p{L}\s'-]+/gu, " ").trim();
    const token = inner.split(/\s+/).filter(Boolean)[0];
    if (token) nicknames.push(token);
  }

  const tokens = fold(text.replace(/\([^)]*\)/g, " "))
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .split(/\s+/)
    .filter((t) => /^\p{L}/u.test(t))
    .filter((t) => !NON_NAME_TOKENS.has(t));

  if (tokens.length === 0) return [];
  const last = tokens[tokens.length - 1];
  const first = tokens.length > 1 ? tokens[0] : null;

  const forms: NameForm[] = [{ first, last }];
  for (const nick of nicknames) forms.push({ first: nick, last });
  return forms;
}

/**
 * Do two written names denote the same person?
 *
 * The last name must match — always. That is the one rule §12.2 states
 * outright, and it is what keeps "Amara" in a subject line from matching every
 * Amara in the pipeline. A mononym on either side (the export has one) matches
 * on the last name alone; there is no first name to disagree about.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const formsA = nameForms(a);
  const formsB = nameForms(b);
  for (const x of formsA) {
    for (const y of formsB) {
      if (x.last !== y.last) continue;
      if (x.first === null || y.first === null) return true;
      if (x.first === y.first) return true;
    }
  }
  return false;
}

/**
 * RFC 2606 reserves `.invalid`, so an address in it can never resolve. The
 * sheet importer parks every address-less lead on one (`@intake.invalid`).
 * Testing the reserved TLD rather than the exact domain means any future
 * placeholder is recognized without this module having to be told about it.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return true; // No address at all is the same problem as a fake one.
  return value.endsWith(".invalid");
}

function domainOf(address: string | null | undefined): string | null {
  const at = (address ?? "").lastIndexOf("@");
  return at > 0 ? (address as string).slice(at + 1).toLowerCase() : null;
}

/** from + to + cc — everyone the message names. */
export function participantsOf(message: ThreadMessage): Party[] {
  return [message.from, ...message.to, ...message.cc];
}

// ── matching ─────────────────────────────────────────────────────────────────

/**
 * Which intake leads could this message be about?
 *
 * Returns EVERY candidate at or above the mark-only floor, strongest first, so
 * the caller can see the ambiguity rather than inherit a decision. Sorting ties
 * by lead id keeps the output deterministic — a report that reshuffles between
 * runs is a report nobody trusts.
 */
export function matchMessageToLeads(
  message: ThreadMessage,
  leads: readonly MatchLead[],
): EmailMatchCandidate[] {
  const participants = participantsOf(message);
  const addresses = new Set(
    participants.map((p) => p.address?.trim().toLowerCase()).filter((a): a is string => !!a),
  );
  const names = participants.map((p) => p.name);
  const subject = fold(message.subject ?? "");

  const candidates: EmailMatchCandidate[] = [];

  for (const lead of leads) {
    // A placeholder address is shared by every address-less lead in the org, so
    // matching on it would match them all. It counts for nothing here.
    const leadEmail = lead.email?.trim().toLowerCase() ?? "";
    const emailHit = !!leadEmail && !isPlaceholderEmail(leadEmail) && addresses.has(leadEmail);

    const leadName = `${lead.firstName} ${lead.lastName}`.trim();
    const nameHit = names.some((n) => namesMatch(n, leadName));

    const mark = fold(lead.markText ?? "");
    // Two characters is a word fragment, not a mark — "GO" would match half the
    // inbox. Three is the shortest the export actually carries.
    const markHit = mark.length >= 3 && subject.includes(mark);

    if (emailHit) {
      candidates.push({ leadId: lead.id, confidence: CONFIDENCE.email, basis: "email" });
    } else if (nameHit && markHit) {
      // Basis is the stronger of the two signals; the confidence records that
      // both fired.
      candidates.push({ leadId: lead.id, confidence: CONFIDENCE.nameAndMark, basis: "name" });
    } else if (nameHit) {
      candidates.push({ leadId: lead.id, confidence: CONFIDENCE.name, basis: "name" });
    } else if (markHit) {
      candidates.push({ leadId: lead.id, confidence: CONFIDENCE.mark, basis: "mark" });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence || a.leadId.localeCompare(b.leadId));
}

/**
 * Turn candidates into a decision, or refuse to.
 *
 * Three outcomes and no fourth: one lead at or above 0.7 is a match; two or
 * more at that level, or nothing above the floor, is ambiguous and goes in the
 * report for a human; no candidate at all is simply not about any intake lead.
 *
 * Ambiguous is NEVER logged. Filing a client's email on the wrong person's
 * timeline is worse than not filing it — the wrong lead then looks worked and
 * the right one looks neglected, and both errors are invisible.
 */
export function resolveMatch(candidates: readonly EmailMatchCandidate[]): ResolvedMatch {
  if (candidates.length === 0) return null;

  const strong = candidates.filter((c) => c.confidence >= LOG_THRESHOLD);
  const strongLeadIds = new Set(strong.map((c) => c.leadId));

  if (strongLeadIds.size === 1) {
    const best = strong[0];
    return { leadId: best.leadId, confidence: best.confidence, basis: best.basis };
  }
  return { ambiguous: true, candidates: [...candidates] };
}

/**
 * The real address to write onto a lead still parked on a placeholder.
 *
 * Only from a match of 0.9 or better, and only from the participant whose
 * DISPLAY NAME is this lead's — a strong match can arrive on a thread that also
 * cc's the client's accountant, and "the one non-firm address on the message"
 * would happily write theirs. Falls back to the sole non-firm participant when
 * there is exactly one, which is the ordinary two-party thread.
 *
 * "Firm" is derived from the mailbox this message was read from rather than a
 * hardcoded domain list, so this stays correct for the next tenant.
 */
export function recoverEmail(
  lead: Pick<MatchLead, "firstName" | "lastName" | "email">,
  match: { confidence: number },
  message: ThreadMessage,
): string | null {
  if (!isPlaceholderEmail(lead.email)) return null;
  if (match.confidence < RECOVER_THRESHOLD) return null;

  const firmDomain = domainOf(message.mailbox);
  const leadName = `${lead.firstName} ${lead.lastName}`.trim();

  const usable = participantsOf(message).filter((p) => {
    const address = p.address?.trim().toLowerCase();
    if (!address) return false;
    if (isPlaceholderEmail(address)) return false;
    return domainOf(address) !== firmDomain;
  });

  const byName = usable.find((p) => namesMatch(p.name, leadName));
  if (byName?.address) return byName.address;

  const distinct = new Set(usable.map((p) => p.address as string));
  return distinct.size === 1 ? [...distinct][0] : null;
}

// ── classification ───────────────────────────────────────────────────────────

export const EMAIL_TYPES = [
  "strategy-session-link",
  "discovery-call",
  "post-consult",
  "follow-up",
  "loe-invoice",
  "welcome",
  "questionnaire",
  "opinion-letter",
  "other",
] as const;

export type EmailType = (typeof EMAIL_TYPES)[number];

export type EmailClassification = {
  type: EmailType;
  /**
   * The thread is about a dispute. It is filed as `other` and its preview is
   * dropped — see classifyEmail.
   */
  sensitive: boolean;
};

/**
 * Copied verbatim from lawmatics-mcp's `src/triage.ts` NEEDS_YOU_PHRASES — the
 * same six the `inbox-summary` skill flags "[needs Rebecca — no draft]", and the
 * ones §12.2 names. Kept as a copy rather than an import because that repo is a
 * separate deployment; if the list moves there, it moves here.
 */
export const SENSITIVE_PHRASES = [
  "opposing counsel",
  "litigation",
  "dispute",
  "lawsuit",
  "settlement",
  "bar complaint",
] as const;

/** Hyphens and underscores collapse, so "post-consultation" reads as "post consultation". */
function classifiable(subject: string | null, preview: string | null): string {
  return fold(`${subject ?? ""} ${preview ?? ""}`).replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Ordered, because the firm's own vocabulary overlaps: "post-consult follow up"
 * is a post-consult, and "welcome to your strategy session" is the session
 * link. First rule that fires wins.
 */
const TYPE_RULES: Array<{ type: EmailType; phrases: readonly (string | RegExp)[] }> = [
  { type: "strategy-session-link", phrases: ["strategy session", "legal strategy"] },
  { type: "discovery-call", phrases: ["discovery call"] },
  // "post consult" is a prefix of "post consultation" once hyphens collapse.
  { type: "post-consult", phrases: ["post consult", "following our call"] },
  { type: "follow-up", phrases: ["follow up", "following up", "checking in", "circling back"] },
  // \bloe\b, not "loe": otherwise "aloe" and "sloe" file as engagement letters.
  { type: "loe-invoice", phrases: ["engagement letter", /\bloe\b/, "invoice", "deposit"] },
  { type: "welcome", phrases: ["welcome"] },
  { type: "questionnaire", phrases: ["questionnaire", "intake form", "interest form"] },
  { type: "opinion-letter", phrases: ["opinion letter", "search opinion", "trademark opinion"] },
];

/**
 * File one message into the vocabulary the notes already use.
 *
 * A sensitive thread short-circuits to `other`. Not because the type would be
 * wrong, but because the useful thing to record about "opposing counsel wrote"
 * is that it happened, and the least useful thing to leave in a timeline a
 * whole firm can read is a fragment of it.
 */
export function classifyEmail(
  subject: string | null | undefined,
  preview: string | null | undefined,
): EmailClassification {
  const text = classifiable(subject ?? null, preview ?? null);
  if (SENSITIVE_PHRASES.some((p) => text.includes(p))) {
    return { type: "other", sensitive: true };
  }
  for (const rule of TYPE_RULES) {
    const hit = rule.phrases.some((p) => (typeof p === "string" ? text.includes(p) : p.test(text)));
    if (hit) return { type: rule.type, sensitive: false };
  }
  return { type: "other", sensitive: false };
}

/**
 * A message whose preview is gone if it was sensitive.
 *
 * Done here, at the edge, rather than trusted to every renderer downstream:
 * "no preview retained anywhere" is a property of the data, not a rule people
 * have to remember.
 */
export function redactSensitive(message: ThreadMessage, sensitive: boolean): ThreadMessage {
  return sensitive ? { ...message, preview: "" } : message;
}

// ── sender attribution ───────────────────────────────────────────────────────

/**
 * Whose touch was this?
 *
 * By member EMAIL, which is what makes the role mailboxes work: `support@` is
 * Dawn's member address, so a message from it is Dawn's touch (§12.3). A
 * message from the shared box (`trademark@`, `intake@`) belongs to no member,
 * so this returns null and the touch keeps its `fromAddress` — attributed to
 * the mailbox, which is the honest answer.
 */
export function staffInitialsFor(
  address: string | null | undefined,
  directory: readonly EmailDirectoryMember[],
): string | null {
  const wanted = (address ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const member = directory.find((m) => (m.email ?? "").trim().toLowerCase() === wanted);
  if (!member?.displayName) return null;
  const initials = initialsFor(member.displayName);
  return initials || null;
}

// ── cadence ──────────────────────────────────────────────────────────────────

export type Touch = {
  messageId: string;
  /** ISO timestamp. A message with no timestamp is not a touch — see cadenceFor. */
  at: string;
  direction: "inbound" | "outbound";
  type: EmailType;
  sensitive: boolean;
  fromAddress: string | null;
  /** Null when the sender is the shared mailbox or anyone outside the roster. */
  staffInitials: string | null;
  subject: string | null;
};

export type Cadence = {
  touches: Touch[];
  outboundCount: number;
  inboundCount: number;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  /** Median days between consecutive OUTBOUND touches; null below two of them. */
  medianGapDays: number | null;
  /** The last touch is inbound — §1 row 1.10, "has the person replied". */
  replied: boolean;
};

const DAY_MS = 86_400_000;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Two decimals: a cadence of "4.33 days" is a number, "4.333333" is noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The cadence of one lead's mail.
 *
 * Messages with no timestamp are DROPPED rather than sorted to the front: a
 * touch with no date cannot corroborate a note, cannot set last_outbound_at,
 * and would silently become the "last" touch under an empty-string sort.
 */
export function cadenceFor(
  messages: readonly ThreadMessage[],
  directory: readonly EmailDirectoryMember[],
): Cadence {
  const touches: Touch[] = messages
    .filter((m) => !!m.at)
    .map((m) => {
      const { type, sensitive } = classifyEmail(m.subject, m.preview);
      return {
        messageId: m.id,
        at: m.at as string,
        direction: m.direction,
        type,
        sensitive,
        fromAddress: m.from.address,
        staffInitials: staffInitialsFor(m.from.address, directory),
        subject: m.subject,
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.messageId.localeCompare(b.messageId));

  const outbound = touches.filter((t) => t.direction === "outbound");
  const inbound = touches.filter((t) => t.direction === "inbound");

  const gaps: number[] = [];
  for (let i = 1; i < outbound.length; i += 1) {
    const prev = Date.parse(outbound[i - 1].at);
    const next = Date.parse(outbound[i].at);
    if (Number.isNaN(prev) || Number.isNaN(next)) continue;
    gaps.push((next - prev) / DAY_MS);
  }
  const gap = median(gaps);

  return {
    touches,
    outboundCount: outbound.length,
    inboundCount: inbound.length,
    lastOutboundAt: outbound.length ? outbound[outbound.length - 1].at : null,
    lastInboundAt: inbound.length ? inbound[inbound.length - 1].at : null,
    medianGapDays: gap === null ? null : round2(gap),
    replied: touches.length > 0 && touches[touches.length - 1].direction === "inbound",
  };
}

// ── corroboration ────────────────────────────────────────────────────────────

export type CorroborationStatus = "corroborated" | "note-only" | "email-only";

export type CorroborationRow = {
  status: CorroborationStatus;
  /** Sheet-note side. */
  noteDate: string | null;
  noteInitials: string | null;
  noteText: string | null;
  /** Mailbox side. */
  touchAt: string | null;
  touchType: EmailType | null;
  touchInitials: string | null;
  touchFromAddress: string | null;
};

/** UTC day number, so "8.10.26" and a 23:40Z send are one day apart, not two. */
function dayNumber(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS);
}

/**
 * The diff the Monday meeting cares about: what the sheet says happened versus
 * what the mailbox shows.
 *
 * Only dated note entries that carry initials take part — an undated note is
 * information without a when, and one with no initials names no sender, so
 * neither can be confirmed or contradicted by a message. They are simply not in
 * this table; they remain on the lead's timeline as the imported notes they are.
 *
 * Only OUTBOUND touches can be `email-only`. An inbound message is the client
 * writing; nobody was ever going to log a note for it, so listing it as a
 * missing note would make every replied-to lead look badly documented.
 *
 * Each touch is claimed at most once, nearest note first, so two follow-ups a
 * day apart cannot both corroborate against the same send.
 */
export function corroborate(
  noteEntries: readonly NoteEntry[],
  touches: readonly Touch[],
  toleranceDays = 1,
): CorroborationRow[] {
  const outbound = touches.filter((t) => t.direction === "outbound");
  const claimed = new Set<string>();
  const rows: CorroborationRow[] = [];

  const dated = noteEntries
    .filter((n) => !!n.date && !!n.initials)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  for (const note of dated) {
    const noteDay = dayNumber(`${note.date}T00:00:00Z`);
    let best: { touch: Touch; distance: number } | null = null;
    if (noteDay !== null) {
      for (const touch of outbound) {
        if (claimed.has(touch.messageId)) continue;
        const touchDay = dayNumber(touch.at);
        if (touchDay === null) continue;
        const distance = Math.abs(touchDay - noteDay);
        if (distance > toleranceDays) continue;
        if (best === null || distance < best.distance) best = { touch, distance };
      }
    }

    if (best) {
      claimed.add(best.touch.messageId);
      rows.push({
        status: "corroborated",
        noteDate: note.date,
        noteInitials: note.initials,
        noteText: note.text,
        touchAt: best.touch.at,
        touchType: best.touch.type,
        touchInitials: best.touch.staffInitials,
        touchFromAddress: best.touch.fromAddress,
      });
    } else {
      rows.push({
        status: "note-only",
        noteDate: note.date,
        noteInitials: note.initials,
        noteText: note.text,
        touchAt: null,
        touchType: null,
        touchInitials: null,
        touchFromAddress: null,
      });
    }
  }

  for (const touch of outbound) {
    if (claimed.has(touch.messageId)) continue;
    rows.push({
      status: "email-only",
      noteDate: null,
      noteInitials: null,
      noteText: null,
      touchAt: touch.at,
      touchType: touch.type,
      touchInitials: touch.staffInitials,
      touchFromAddress: touch.fromAddress,
    });
  }

  return rows.sort((a, b) => {
    const left = (a.noteDate ?? a.touchAt ?? "").slice(0, 10);
    const right = (b.noteDate ?? b.touchAt ?? "").slice(0, 10);
    return left.localeCompare(right);
  });
}

// ── the report ───────────────────────────────────────────────────────────────

/** Where a synced email activity row came from — the provenance stamp in payload. */
export const EMAIL_ACTIVITY_SOURCE = "intake-email-sync";

/** A lead as the report sees it: matchable, plus what the row already claims. */
export type EvidenceLead = MatchLead & {
  stageName: string | null;
  assignedTo: string | null;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
};

export type MatchedMessage = {
  /** Preview already blanked when sensitive — see redactSensitive. */
  message: ThreadMessage;
  confidence: number;
  basis: MatchBasis;
  type: EmailType;
  sensitive: boolean;
};

export type LeadEvidence = {
  lead: EvidenceLead;
  matched: MatchedMessage[];
  cadence: Cadence;
  corroboration: CorroborationRow[];
  /** A real address for a lead still on a placeholder, or null. */
  recoveredEmail: string | null;
  /** Distinct staff initials seen sending for this lead, sorted. */
  senderInitials: string[];
  /** Mailboxes that sent for this lead with no member behind them (the shared boxes). */
  senderMailboxes: string[];
  /**
   * The newest touch is inbound AND newer than what the row already recorded —
   * i.e. this run is the first to see the reply. The notification condition.
   */
  newReply: boolean;
};

export type AmbiguousMessage = {
  message: ThreadMessage;
  candidates: EmailMatchCandidate[];
};

export type EmailEvidenceReport = {
  /** Only leads with at least one matched message, newest activity first. */
  leads: LeadEvidence[];
  ambiguous: AmbiguousMessage[];
  unmatched: ThreadMessage[];
  totals: {
    messages: number;
    matched: number;
    ambiguous: number;
    unmatched: number;
    sensitive: number;
    leadsWithMail: number;
    recoveries: number;
    newReplies: number;
  };
};

/**
 * Is `candidate` a strictly later INSTANT than `known`?
 *
 * The two sides arrive in different serialisations of the same clock: Graph
 * hands back "2026-08-11T12:34:56Z", and the value PostgREST reads back out of
 * the timestamptz column this script wrote it to is "2026-08-11T12:34:56+00:00".
 * Compared as strings those differ at index 19 ('Z' > '+'), so the identical
 * instant reads as newer every run — the same reply would ring the bell and
 * re-issue an UPDATE forever, and the "never rewind" guards would be decided by
 * string form rather than by time. Compare parsed epochs instead.
 *
 * A missing `known` means anything real is newer. An unparseable value on
 * either side falls back to the lexicographic read rather than inventing an
 * ordering.
 */
export function isLaterInstant(
  candidate: string | null | undefined,
  known: string | null | undefined,
): boolean {
  if (!candidate) return false;
  if (!known) return true;
  const left = Date.parse(candidate);
  const right = Date.parse(known);
  if (Number.isNaN(left) || Number.isNaN(right)) return candidate > known;
  return left > right;
}

export type BuildEvidenceInput = {
  messages: readonly ThreadMessage[];
  leads: readonly EvidenceLead[];
  directory: readonly EmailDirectoryMember[];
  /** Sheet notes already on each lead's timeline, parsed by splitNoteEntries. */
  notesByLeadId?: ReadonlyMap<string, readonly NoteEntry[]>;
  toleranceDays?: number;
};

/**
 * The whole pure pass: match, classify, measure, corroborate.
 *
 * Extracted from the CLI so every decision is testable without a database —
 * scripts/sync-intake-email.ts is then only I/O (read leads, print this, and
 * under --apply, write it).
 */
export function buildEmailEvidence(input: BuildEvidenceInput): EmailEvidenceReport {
  const notes = input.notesByLeadId ?? new Map<string, readonly NoteEntry[]>();
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const matchedByLead = new Map<string, MatchedMessage[]>();
  const ambiguous: AmbiguousMessage[] = [];
  const unmatched: ThreadMessage[] = [];
  let sensitiveCount = 0;

  for (const raw of input.messages) {
    const { type, sensitive } = classifyEmail(raw.subject, raw.preview);
    if (sensitive) sensitiveCount += 1;
    const message = redactSensitive(raw, sensitive);

    const resolved = resolveMatch(matchMessageToLeads(message, input.leads));
    if (resolved === null) {
      unmatched.push(message);
      continue;
    }
    if ("ambiguous" in resolved) {
      ambiguous.push({ message, candidates: resolved.candidates });
      continue;
    }
    const bucket = matchedByLead.get(resolved.leadId) ?? [];
    bucket.push({ message, confidence: resolved.confidence, basis: resolved.basis, type, sensitive });
    matchedByLead.set(resolved.leadId, bucket);
  }

  const leads: LeadEvidence[] = [];
  for (const [leadId, matched] of matchedByLead) {
    const lead = leadById.get(leadId);
    if (!lead) continue; // Cannot happen: ids come from input.leads.

    const cadence = cadenceFor(
      matched.map((m) => m.message),
      input.directory,
    );
    const corroboration = corroborate(
      notes.get(leadId) ?? [],
      cadence.touches,
      input.toleranceDays,
    );

    // Strongest evidence first, then most recent — the address on a 1.0 match
    // is the one to trust, and a lead on a real address recovers nothing.
    const forRecovery = [...matched].sort(
      (a, b) => b.confidence - a.confidence || (b.message.at ?? "").localeCompare(a.message.at ?? ""),
    );
    let recoveredEmail: string | null = null;
    for (const m of forRecovery) {
      recoveredEmail = recoverEmail(lead, m, m.message);
      if (recoveredEmail) break;
    }

    const senderInitials = [
      ...new Set(
        cadence.touches
          .filter((t) => t.direction === "outbound" && t.staffInitials)
          .map((t) => t.staffInitials as string),
      ),
    ].sort();
    const senderMailboxes = [
      ...new Set(
        cadence.touches
          .filter((t) => t.direction === "outbound" && !t.staffInitials && t.fromAddress)
          .map((t) => t.fromAddress as string),
      ),
    ].sort();

    const newReply = cadence.replied && isLaterInstant(cadence.lastInboundAt, lead.lastInboundAt);

    leads.push({
      lead,
      matched,
      cadence,
      corroboration,
      recoveredEmail,
      senderInitials,
      senderMailboxes,
      newReply,
    });
  }

  leads.sort((a, b) => {
    const left = a.cadence.touches[a.cadence.touches.length - 1]?.at ?? "";
    const right = b.cadence.touches[b.cadence.touches.length - 1]?.at ?? "";
    return right.localeCompare(left) || a.lead.id.localeCompare(b.lead.id);
  });

  return {
    leads,
    ambiguous,
    unmatched,
    totals: {
      messages: input.messages.length,
      matched: [...matchedByLead.values()].reduce((n, m) => n + m.length, 0),
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
      sensitive: sensitiveCount,
      leadsWithMail: leads.length,
      recoveries: leads.filter((l) => l.recoveredEmail !== null).length,
      newReplies: leads.filter((l) => l.newReply).length,
    },
  };
}

// ── activity rows ────────────────────────────────────────────────────────────

/** `email_sent` / `email_received` — the crm_activity_type for a touch. */
export function activityTypeFor(direction: "inbound" | "outbound"): "email_sent" | "email_received" {
  return direction === "outbound" ? "email_sent" : "email_received";
}

/**
 * The crm_activity payload for one synced message (§12.2).
 *
 * NO BODY AND NO PREVIEW — not even a redacted one. The timeline records that a
 * message of a given kind happened between these parties; the message itself
 * stays in the mailbox, behind Outlook's own access controls. `web_link` is how
 * a reader gets to it, which means the reader's own mailbox permissions decide
 * whether they may.
 */
export function activityPayloadForMessage(m: MatchedMessage): Record<string, unknown> {
  const { message } = m;
  return {
    source: EMAIL_ACTIVITY_SOURCE,
    message_id: message.id,
    conversation_id: message.conversationId,
    at: message.at,
    direction: message.direction,
    type: m.type,
    from: message.from.address,
    to: message.to.map((p) => p.address).filter(Boolean),
    subject: message.subject,
    mailbox: message.mailbox,
    web_link: message.webLink,
    basis: m.basis,
    confidence: m.confidence,
    sensitive: m.sensitive,
  };
}

// ── rendering ────────────────────────────────────────────────────────────────

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

function leadName(lead: EvidenceLead): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "(no name)";
}

/** "3 out · 1 in · last out 2026-08-10 · last in 2026-08-11 · median gap 7 d · replied". */
export function cadenceLine(cadence: Cadence): string {
  return [
    `${cadence.outboundCount} out`,
    `${cadence.inboundCount} in`,
    `last out ${day(cadence.lastOutboundAt)}`,
    `last in ${day(cadence.lastInboundAt)}`,
    `median gap ${cadence.medianGapDays === null ? "—" : `${cadence.medianGapDays} d`}`,
    cadence.replied ? "replied" : "no reply",
  ].join(" · ");
}

export type ReportMeta = {
  orgName: string;
  mailboxes: readonly string[];
  since: string | null;
  until: string | null;
  apply: boolean;
  /** Any mailbox whose window was incomplete — surfaced, never swallowed. */
  warnings?: readonly string[];
};

/**
 * The operator's report, as Markdown (`--report out.md`) and, line for line,
 * what the CLI prints.
 *
 * Deliberately dull and complete. It is read next to the spreadsheet at a
 * Monday meeting, so every lead gets its cadence line and its corroboration
 * table even when they say "nothing happened" — and the ambiguous, unmatched
 * and sensitive counts are always present, including when they are zero. A
 * section that disappears when empty reads as a section that was never run.
 */
export function renderEmailReport(report: EmailEvidenceReport, meta: ReportMeta): string {
  const out: string[] = [];
  out.push(`# Intake email evidence — ${meta.orgName}`);
  out.push("");
  out.push(`- Mode: **${meta.apply ? "APPLY" : "DRY RUN"}**`);
  out.push(`- Mailboxes: ${meta.mailboxes.join(", ") || "—"}`);
  out.push(`- Window: ${day(meta.since)} → ${meta.until ? day(meta.until) : "now"}`);
  out.push(
    `- Messages: ${report.totals.messages} read · ${report.totals.matched} matched · ` +
      `${report.totals.ambiguous} ambiguous · ${report.totals.unmatched} unmatched`,
  );
  out.push(
    `- Leads with mail: ${report.totals.leadsWithMail} · addresses recovered: ` +
      `${report.totals.recoveries} · new replies: ${report.totals.newReplies} · ` +
      `sensitive threads: ${report.totals.sensitive}`,
  );
  for (const warning of meta.warnings ?? []) out.push(`- ⚠ ${warning}`);
  out.push("");
  out.push(
    "> Email evidence only. Nothing here was sent, drafted, or written to Lawmatics, " +
      "and no classification is a legal conclusion.",
  );
  out.push("");

  out.push("## Leads");
  out.push("");
  if (report.leads.length === 0) {
    out.push("_No intake lead matched any message in this window._");
    out.push("");
  }
  for (const entry of report.leads) {
    const { lead } = entry;
    out.push(`### ${leadName(lead)}${lead.markText ? ` — ${lead.markText}` : ""}`);
    out.push("");
    out.push(`- Stage: ${lead.stageName ?? "—"}`);
    out.push(
      `- Email: ${
        entry.recoveredEmail
          ? `**${entry.recoveredEmail}** (recovered — row still says ${lead.email ?? "—"})`
          : isPlaceholderEmail(lead.email)
            ? "placeholder"
            : (lead.email ?? "—")
      }`,
    );
    out.push(`- Cadence: ${cadenceLine(entry.cadence)}`);
    out.push(
      `- Senders: ${
        [...entry.senderInitials, ...entry.senderMailboxes.map((m) => `${m} (shared mailbox)`)].join(", ") ||
        "—"
      }`,
    );
    if (entry.newReply) out.push("- 🔔 New reply since the last sync");
    out.push("");
    out.push("| | Note | Email |");
    out.push("|---|---|---|");
    if (entry.corroboration.length === 0) {
      out.push("| — | _no dated notes, no outbound mail_ | |");
    }
    for (const row of entry.corroboration) {
      const note = row.noteDate ? `${row.noteDate} ${row.noteInitials ?? ""}`.trim() : "—";
      const email = row.touchAt
        ? `${day(row.touchAt)} ${row.touchType}${row.touchInitials ? ` (${row.touchInitials})` : ""}`
        : "—";
      out.push(`| ${row.status} | ${note} | ${email} |`);
    }
    out.push("");
  }

  out.push(`## Ambiguous — reported, never logged (${report.ambiguous.length})`);
  out.push("");
  if (report.ambiguous.length === 0) out.push("_None._");
  for (const item of report.ambiguous) {
    const who = item.candidates.map((c) => `${c.leadId} ${c.confidence}/${c.basis}`).join(", ");
    out.push(`- ${day(item.message.at)} · ${item.message.subject ?? "(no subject)"} → ${who || "no candidate"}`);
  }
  out.push("");

  out.push(`## Unmatched (${report.unmatched.length})`);
  out.push("");
  if (report.unmatched.length === 0) out.push("_None._");
  for (const message of report.unmatched) {
    out.push(
      `- ${day(message.at)} · ${message.direction} · ${message.from.address ?? "?"} · ${
        message.subject ?? "(no subject)"
      }`,
    );
  }
  out.push("");

  out.push(`## Sensitive threads (${report.totals.sensitive})`);
  out.push("");
  out.push(
    report.totals.sensitive === 0
      ? "_None._"
      : `${report.totals.sensitive} message(s) matched a dispute phrase. They are filed as \`other\` ` +
          "with no preview kept, here or in the timeline.",
  );
  out.push("");

  return out.join("\n");
}
