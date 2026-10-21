// Deterministic inbox triage for the inbox-summary agent.
//
// Ported from lawmatics-mcp `src/triage.ts` (see PORTED_FROM.md for the three deliberate
// changes). Rules-based rather than model-based so it is cheap, repeatable, and explainable
// when an attorney asks "why was that flagged?". The buckets mirror the `inbox-summary` skill
// in the lectual-plugin repo.
//
// This is a PRIORITIZER, not a decision-maker. Nothing here sends, replies, or files anything:
// it only decides what order a person reads their mail in. It is pure: no environment, no
// database, no network.
//
// "Needs you" requires a POSITIVE SIGNAL (an urgent phrase, high importance from a human,
// official correspondence). It is not the default for unmatched mail: a bucket holding the
// whole inbox is one the reader learns to skip.
//
// Email content is UNTRUSTED. These functions only pattern-match against text; they never
// interpret it as an instruction.

import { SENSITIVE_PHRASES, classifyEmail } from "@/lib/intake/email-match";

/**
 * `approve` sits above `needs-you`: a teammate's draft is blocked on the attorney's copy
 * approval, so it is the cheapest thing to unblock and the most expensive to leave sitting.
 */
export type Bucket = "approve" | "needs-you" | "route" | "fyi" | "low" | "scam";

/** Who a routed message should go to, as a ROLE. Never a person's name: every firm gets the same labels. */
export const ROLE = {
  attorney: "Attorney",
  intake: "Intake",
  filings: "Filings",
  partnerships: "Partnerships",
  discovery: "Discovery calls",
} as const;
export type RoleLabel = (typeof ROLE)[keyof typeof ROLE];

export type TriagedMessage = {
  id: string;
  mailbox: string;
  from: string;
  fromAddress: string | null;
  subject: string;
  preview: string;
  receivedAt: string | null;
  /** Deep link into the provider's thread, when it supplied one. */
  webLink: string | null;
  bucket: Bucket;
  /** Short human-readable justification, shown in the digest so triage is auditable. */
  reason: string;
  /** Who this should go to, as a role label. */
  assignTo?: RoleLabel;
  /** The subject or preview reads like a dispute (the six sensitive phrases). Such a thread gets no draft. */
  sensitive: boolean;
};

export type TriageInput = {
  id: string;
  mailbox: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  preview: string;
  receivedDateTime: string | null;
  importance?: string | null;
  webLink?: string | null;
};

/** What the rules need to know about the firm. Domains come from its connected mailboxes. */
export type TriageContext = {
  /** The firm's own domains (internal traffic, not a client waiting on an answer). Lower-case. */
  firmDomains: readonly string[];
};

const USPTO_DOMAINS = ["uspto.gov", "copyright.gov", "loc.gov"];

/** Senders that never expect a reply. */
const AUTOMATED_LOCALPARTS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "mailer-daemon",
  "postmaster",
  "support",
  "billing",
  "receipts",
  "alerts",
];

/** The domain of an address, lower-case, or null. */
export function domainOf(address: string | null | undefined): string | null {
  const at = (address ?? "").lastIndexOf("@");
  return at > 0 ? (address as string).slice(at + 1).trim().toLowerCase() || null : null;
}

/** The firm's own domains, from the addresses of its connected mailboxes. */
export function firmDomainsOf(mailboxAddresses: readonly string[]): string[] {
  return [...new Set(mailboxAddresses.map(domainOf).filter((d): d is string => d !== null))];
}

/**
 * The firm's convention: a teammate prefixes the subject with DRAFT and pastes the proposed
 * email below. Checked as a subject prefix rather than anywhere in the text, so a passing
 * mention of "the draft" in a normal thread does not qualify.
 */
const DRAFT_SUBJECT = /^\s*(?:\[)?\s*draft\b/i;

/** A teammate asking for copy approval on a draft they have written. */
const APPROVAL_PHRASES = [
  "for your approval",
  "for approval",
  "approve this",
  "okay to send",
  "ok to send",
  "draft for review",
  "draft for your review",
  "please review",
  "can you review",
  "review and approve",
  "let me know if this looks good",
  "does this look good",
  "ready to send",
  "before i send",
];

/**
 * Unmistakable bulk-marketing markers, checked BEFORE the urgency keywords. Legal-education
 * vendors sell by naming practice areas, so their subject lines collide with the urgency
 * vocabulary by construction; a real client email does not advertise a webinar seat.
 * `cle` uses a word boundary so "circle", "cycle" and "uncle" do not fire.
 */
const STRONG_MARKETING = /\b(?:webinar|cle credit|cle credits|live cle|register now|save your seat|early bird|unsubscribe|view in browser|sponsored)\b|\bcle\b/i;

/** Office-action language: attorney work, even when it arrives from the USPTO. */
const ATTORNEY_USPTO_PHRASES = ["office action", "refusal", "suspension", "final refusal", "examiner"];

/** Partnerships, collabs, social, and the follow-up sequences. */
const PARTNERSHIP_PHRASES = ["collab", "collaboration", "partnership", "sponsor", "brand deal", "instagram", "tiktok", "social media", "ugc", "press feature"];

/** Booking the first call. */
const DISCOVERY_PHRASES = ["discovery call", "book a call", "schedule a call", "consultation request", "book a consult"];

// Trademark-directory and USPTO-impersonation scams are a standing threat to IP firms and their
// clients: official-sounding sender, a real serial number, an invented fee, a short deadline.
// The signal that separates them from real USPTO mail is the sending domain; the USPTO never
// invoices from a commercial domain.
const SCAM_PHRASES = [
  "trademark registration fee",
  "trademark monitoring service",
  "international trademark register",
  "patent and trademark register",
  "publication fee",
  "renewal fee",
  "final notice",
  "wire transfer",
  "your payment is due",
  "registration is about to expire",
];
const SCAM_SUBJECT_HINTS = ["uspto", "trademark", "patent office", "wipo", "registration"];

/** The six sensitive phrases are the app's own list (never a second copy), appended after the rest. */
const NEEDS_YOU_PHRASES: readonly string[] = [
  "office action",
  "deadline",
  "urgent",
  "asap",
  "cease and desist",
  "please advise",
  "can you confirm",
  "question about",
  "refund",
  "complaint",
  "terminate",
  ...SENSITIVE_PHRASES,
];

const LOW_PHRASES = [
  "unsubscribe",
  "newsletter",
  "webinar",
  "free trial",
  "special offer",
  "act now",
  "limited time",
  "boost your",
  "seo",
  "we noticed your website",
  "guest post",
  "partnership opportunity",
];

const FYI_PHRASES = ["out of office", "automatic reply", "delivery receipt", "read receipt", "calendar invite", "invoice paid", "receipt for", "payment received"];

function haystack(m: TriageInput): string {
  return `${m.subject ?? ""} ${m.preview}`.toLowerCase();
}

function has(text: string, phrases: readonly string[]): string | null {
  for (const p of phrases) if (text.includes(p)) return p;
  return null;
}

function isInternal(address: string | null, ctx: TriageContext): boolean {
  const domain = domainOf(address);
  if (!domain) return false;
  return ctx.firmDomains.some((d) => d && (domain === d || domain.endsWith(`.${d}`)));
}

export function isAutomatedSender(address: string | null): boolean {
  if (!address) return false;
  const local = address.split("@")[0] ?? "";
  return AUTOMATED_LOCALPARTS.some((p) => local === p || local.startsWith(`${p}+`) || local.startsWith(`${p}-`));
}

/** Domains whose mail is genuine docketing traffic no matter what it says. */
export function isOfficialSender(address: string | null): boolean {
  const domain = domainOf(address);
  return domain !== null && USPTO_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Classify one message into exactly one bucket.
 *
 * Order matters and is deliberate: scam detection runs before everything so a convincing fake
 * cannot be promoted into "needs you" by its own urgency language, and routing rules for the
 * shared mailboxes run before the generic buckets.
 */
export function triageMessage(m: TriageInput, ctx: TriageContext): TriagedMessage {
  const text = haystack(m);
  const official = isOfficialSender(m.fromAddress);
  const base = {
    id: m.id,
    mailbox: m.mailbox,
    from: m.fromName ? `${m.fromName} <${m.fromAddress ?? "?"}>` : (m.fromAddress ?? "unknown sender"),
    fromAddress: m.fromAddress,
    subject: m.subject ?? "(no subject)",
    preview: m.preview,
    receivedAt: m.receivedDateTime,
    webLink: m.webLink ?? null,
    sensitive: classifyEmail(m.subject, m.preview).sensitive,
  };

  // 1. Scam: official-sounding trademark/USPTO mail from a non-official domain.
  if (!official) {
    const phrase = has(text, SCAM_PHRASES);
    const looksOfficial = SCAM_SUBJECT_HINTS.some((h) => text.includes(h));
    if (phrase && looksOfficial) {
      return { ...base, bucket: "scam", reason: `"${phrase}" from a non-USPTO domain, likely a trademark-directory scam` };
    }
  }

  // 2. Official USPTO / Copyright Office mail. An office action or refusal is attorney work, and
  //    routing it to the filings queue would move a hard deadline away from the person who has
  //    to answer it, so the content decides, not just the sender.
  if (official) {
    const attorneyMatter = has(text, ATTORNEY_USPTO_PHRASES);
    if (attorneyMatter) return { ...base, bucket: "needs-you", reason: `USPTO: ${attorneyMatter}`, assignTo: ROLE.attorney };
    return { ...base, bucket: "route", reason: "USPTO/Copyright Office correspondence, a docketing event", assignTo: ROLE.filings };
  }

  // 2b. A teammate waiting on copy approval. Above everything else, and BEFORE the needs-you
  //     phrase check: a drafted office-action notice contains "office action", but what the
  //     attorney has to do with it is approve the copy, not answer the USPTO.
  if (isInternal(m.fromAddress, ctx)) {
    const draftPrefix = DRAFT_SUBJECT.test(m.subject ?? "");
    const ask = has(text, APPROVAL_PHRASES);
    if (draftPrefix || ask) {
      return {
        ...base,
        bucket: "approve",
        reason: draftPrefix ? `${m.fromName ?? "A teammate"} sent a draft for your copy approval` : `${m.fromName ?? "A teammate"} asked: "${ask}"`,
        assignTo: ROLE.attorney,
      };
    }
  }

  // 3. Shared-mailbox routing. info@ is public intake; other boxes mean something specific.
  const box = m.mailbox.split("@")[0];
  const marketing = has(text, LOW_PHRASES);

  // Someone asking for a call goes to discovery, checked before the generic intake rule.
  const wantsCall = has(text, DISCOVERY_PHRASES);
  if (wantsCall && !marketing) return { ...base, bucket: "route", reason: `wants a call: "${wantsCall}"`, assignTo: ROLE.discovery };

  if (text.includes("questionnaire")) return { ...base, bucket: "route", reason: "questionnaire activity", assignTo: ROLE.intake };
  if (text.includes("filing receipt") || text.includes("serial number")) {
    return { ...base, bucket: "route", reason: "filing receipt, start the filing follow-up", assignTo: ROLE.filings };
  }

  // Partnerships and social, but only once the cold-outreach markers are ruled out, or every SEO
  // pitch mentioning Instagram becomes someone's problem.
  if (!marketing) {
    const social = has(text, PARTNERSHIP_PHRASES);
    if (social) return { ...base, bucket: "route", reason: `partnership/social: "${social}"`, assignTo: ROLE.partnerships };
  }

  if (box === "info" && !marketing) {
    return { ...base, bucket: "route", reason: "inbound to the public intake address, possible new lead", assignTo: ROLE.intake };
  }

  // 3b. Bulk marketing, ruled out BEFORE urgency. Internal senders are exempt: a teammate
  //     forwarding a real deadline should not be silenced by one stray word.
  if (!isInternal(m.fromAddress, ctx) && STRONG_MARKETING.test(text)) {
    return { ...base, bucket: "low", reason: "legal-education / bulk marketing" };
  }

  // 4. Needs the attorney, but only on an actual signal. An urgent phrase still wins from an
  //    internal or automated sender, because a real deadline can arrive from either.
  const urgent = has(text, NEEDS_YOU_PHRASES);
  if (urgent) return { ...base, bucket: "needs-you", reason: `mentions "${urgent}"`, assignTo: ROLE.attorney };
  if (m.importance === "high" && !isAutomatedSender(m.fromAddress)) {
    return { ...base, bucket: "needs-you", reason: "flagged high importance by sender", assignTo: ROLE.attorney };
  }

  // 5. Noise and acknowledgements.
  if (has(text, FYI_PHRASES)) return { ...base, bucket: "fyi", reason: "automated acknowledgement" };
  const low = has(text, LOW_PHRASES);
  if (low) return { ...base, bucket: "low", reason: `marketing/solicitation ("${low}")` };

  // 6. Everything else is FYI. This deliberately does NOT default to needs-you: a bucket that
  //    catches everything tells the reader nothing.
  if (isInternal(m.fromAddress, ctx)) return { ...base, bucket: "fyi", reason: "internal firm mail" };
  if (isAutomatedSender(m.fromAddress)) return { ...base, bucket: "fyi", reason: "automated sender" };
  return { ...base, bucket: "fyi", reason: "no action signal detected" };
}

/** De-duplicate a thread cc'd to several mailboxes, keeping the first and merging the boxes. */
export function dedupeByConversation<T extends { id: string; mailbox: string }>(messages: T[], conversationIdOf: (m: T) => string | null): T[] {
  const seen = new Map<string, T>();
  const out: T[] = [];
  for (const m of messages) {
    const key = conversationIdOf(m) ?? m.id;
    const prior = seen.get(key);
    if (prior) {
      if (!prior.mailbox.split(" · ").includes(m.mailbox)) prior.mailbox = `${prior.mailbox} · ${m.mailbox}`;
      continue;
    }
    seen.set(key, m);
    out.push(m);
  }
  return out;
}

/** The plugin's order: what to act on first, scams before the skimmable pile. */
export const BUCKET_ORDER: readonly Bucket[] = ["approve", "needs-you", "route", "scam", "fyi", "low"];

export const BUCKET_LABEL: Record<Bucket, string> = {
  approve: "Waiting on your approval",
  "needs-you": "Needs you",
  route: "Routed",
  scam: "Suspected scam, do not engage",
  fyi: "FYI",
  low: "Skimmable",
};
