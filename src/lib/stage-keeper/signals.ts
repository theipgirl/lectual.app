/**
 * What the Stage Keeper reads, in one vocabulary. Pure, and safe for the browser: the
 * board, the lead page and the reconcile screen all describe a move in these words.
 *
 * A signal is a fact the firm already recorded: matched mail the sync classified, a consult
 * the Outlook calendar read found, a Zoom or Fathom meeting linked to the lead, a client
 * proposal whose link is live, or an approved post-consult email in the approval queue. Only
 * some signals can move a lead; the rest are listed here so the mapping can say plainly that
 * they imply nothing.
 */

export const SIGNAL_IDS = [
  "consult-scheduled",
  "consult-held",
  "questionnaire-sent",
  "post-consult-sent",
  "loe-invoice-sent",
  "welcome-sent",
  "payment-received",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

/** The signals that can only ever produce a suggestion card, never a move. */
export const SUGGEST_ONLY_SIGNALS: ReadonlySet<SignalId> = new Set<SignalId>(["welcome-sent", "payment-received"]);

/** The chip wording for each signal ("Moved by agent · LOE sent Oct 20"). */
export const SIGNAL_LABEL: Record<SignalId, string> = {
  "consult-scheduled": "Consult booked",
  "consult-held": "Consult held",
  "questionnaire-sent": "Questionnaire sent",
  "post-consult-sent": "Post-consult sent",
  "loe-invoice-sent": "LOE sent",
  "welcome-sent": "Welcome sent",
  "payment-received": "Payment received",
};

export function isSignalId(value: unknown): value is SignalId {
  return typeof value === "string" && (SIGNAL_IDS as readonly string[]).includes(value);
}

export type KeeperSignal =
  | {
      source: "mail";
      messageId: string;
      /** The `classifyEmail` type the sync stored on the timeline row. */
      type: string;
      direction: "inbound" | "outbound";
      at: string | null;
      subject: string | null;
      sensitive: boolean;
    }
  | { source: "calendar"; eventId: string; title: string | null; startsAt: string; sensitive: boolean }
  | { source: "payment"; ref: string; at: string | null }
  /** A Zoom or Fathom meeting linked to the lead (`lead_id`, never a suggestion) that has taken place. */
  | { source: "meeting"; meetingId: string; provider: string; title: string | null; startsAt: string; sensitive: boolean }
  /** A client proposal whose link is live (`sent`) or that the client accepted; one per family. */
  | { source: "proposal"; familyId: string; version: number | null; status: string; at: string | null }
  /** An approved post-consult client email in the approval queue. */
  | { source: "queue"; itemId: string; type: string; at: string | null };

/** True when the fact reads like a dispute. Only mail, calendar titles and meeting titles can; a proposal, a queue item and a payment cannot. */
export function isSensitiveSignal(signal: KeeperSignal): boolean {
  return (signal.source === "mail" || signal.source === "calendar" || signal.source === "meeting") && signal.sensitive;
}

const MAIL_SIGNALS: Record<string, SignalId> = {
  questionnaire: "questionnaire-sent",
  "post-consult": "post-consult-sent",
  "loe-invoice": "loe-invoice-sent",
  welcome: "welcome-sent",
};

/**
 * The signal a fact stands for, or null when it implies nothing. Inbound mail never moves a
 * lead, whatever its type. A strategy-session link, a discovery-call mail, a follow-up, an
 * opinion letter and "other" place nobody on the board either.
 */
export function signalIdFor(signal: KeeperSignal): SignalId | null {
  if (signal.source === "calendar") return "consult-scheduled";
  if (signal.source === "meeting") return "consult-held";
  if (signal.source === "proposal" || signal.source === "queue") return "post-consult-sent";
  if (signal.source === "payment") return "payment-received";
  if (signal.direction !== "outbound") return null;
  return MAIL_SIGNALS[signal.type] ?? null;
}

/** `<lead id>:<mail|calendar|meeting|proposal|queue>:<its id>`. One signal, one key, forever. */
export function signalKeyFor(leadId: string, signal: KeeperSignal): string {
  if (signal.source === "mail") return `${leadId}:mail:${signal.messageId}`;
  if (signal.source === "calendar") return `${leadId}:calendar:${signal.eventId}`;
  if (signal.source === "meeting") return `${leadId}:meeting:${signal.meetingId}`;
  if (signal.source === "proposal") return `${leadId}:proposal:${signal.familyId}`;
  if (signal.source === "queue") return `${leadId}:queue:${signal.itemId}`;
  return `${leadId}:payment:${signal.ref}`;
}

/** The instant a signal happened, for "newest evidence wins". Unusable dates sort oldest. */
export function signalTime(signal: KeeperSignal): number {
  const iso = signal.source === "calendar" || signal.source === "meeting" ? signal.startsAt : signal.at;
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * What is stored on a move or a suggestion. Deliberately small: mail is its type, direction,
 * date and subject; a consult is its title and start. No address, body, preview or location.
 */
export type MoveEvidence =
  | { kind: "mail"; type: string; direction: "inbound" | "outbound"; at: string | null; subject: string | null }
  | { kind: "calendar"; title: string | null; starts_at: string }
  | { kind: "payment"; at: string | null }
  | { kind: "meeting"; provider: string; title: string | null; starts_at: string }
  | { kind: "proposal"; version: number | null; status: string; at: string | null }
  | { kind: "queue"; type: string; at: string | null };

const SUBJECT_CAP = 200;
const TITLE_CAP = 200;

export function evidenceOf(signal: KeeperSignal): MoveEvidence {
  if (signal.source === "mail") {
    return {
      kind: "mail",
      type: signal.type,
      direction: signal.direction,
      at: signal.at,
      subject: signal.subject ? signal.subject.trim().slice(0, SUBJECT_CAP) || null : null,
    };
  }
  if (signal.source === "calendar") {
    return { kind: "calendar", title: signal.title ? signal.title.trim().slice(0, TITLE_CAP) || null : null, starts_at: signal.startsAt };
  }
  if (signal.source === "meeting") {
    return { kind: "meeting", provider: signal.provider, title: signal.title ? signal.title.trim().slice(0, TITLE_CAP) || null : null, starts_at: signal.startsAt };
  }
  if (signal.source === "proposal") return { kind: "proposal", version: signal.version, status: signal.status, at: signal.at };
  if (signal.source === "queue") return { kind: "queue", type: signal.type, at: signal.at };
  return { kind: "payment", at: signal.at };
}

/**
 * The date the lead really entered the stage: a mail, proposal, queue or payment signal's own
 * date, or when a held meeting began. A consult booking has no date on which it was booked in
 * what the calendar sync stores, so it has none, and the move is stamped with the run time.
 */
export function evidenceDateOf(signal: KeeperSignal): string | null {
  if (signal.source === "calendar") return null;
  if (signal.source === "meeting") return signal.startsAt;
  return signal.at;
}
