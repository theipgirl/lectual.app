/**
 * Sequence stop conditions — the pure half. RPB's intake SOP (9 Sep), rule 1:
 * "A sequence must be stoppable by the thing that makes it wrong … the stop is
 * a recorded event — not someone remembering." And §2.5 (29 Aug): "A client
 * paid at night and received an automated Lectual follow-up the next morning."
 *
 * Three questions are answered here, each from the same `StopFacts`:
 *
 *   stopFor(facts, enrolledAt)     should this enrollment stop, and why?
 *                                  (advance()'s guard, before any step runs)
 *   clientFact(facts)              is this lead already a client? (enrolling
 *                                  is refused, with the reason)
 *   staleSince(facts, queuedAt)    has the lead signed / paid / become a client
 *                                  since this draft was queued? (the approval
 *                                  warning)
 *
 * No IO and no clock: every instant is passed in, so the rules are pinned by
 * tests/campaigns/stops.test.ts. The reads live in ./stop-facts.ts and the
 * writes in ./stop.ts.
 *
 * WHAT IS NOT DETECTED, AND SO NOT HERE AS A FACT
 *   unsubscribed  Lectual sends nothing itself (approved drafts go out from the
 *                 firm's own mailbox) and has no unsubscribe link or webhook, so
 *                 there is no signal. Staff record it with a manual stop.
 *   booked        There is no booking feed linked to a lead (Lawmatics calendar
 *                 events carry only a contact NAME). The only lead-linked call
 *                 record is an imported Fathom/Zoom meeting, which is a call that
 *                 HAPPENED. That is used, labelled "had a call"; a call that is
 *                 booked but not yet held is not detectable.
 */

export const STOP_REASONS = [
  "signed",
  "paid",
  "matter_opened",
  "client",
  "replied",
  "booked",
  "unsubscribed",
  "manual",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export function isStopReason(value: unknown): value is StopReason {
  return typeof value === "string" && (STOP_REASONS as readonly string[]).includes(value);
}

/** The phrase after "Sequence stopped —". Lower case; it sits mid-sentence. */
export const STOP_REASON_LABEL: Record<StopReason, string> = {
  signed: "signed quote",
  paid: "payment recorded",
  matter_opened: "matter opened",
  client: "became a client",
  replied: "replied",
  booked: "had a call",
  unsubscribed: "asked us to stop",
  manual: "stopped by hand",
};

/** The reasons a person can pick on the lead page's "Stop sequence". */
export const MANUAL_STOP_REASONS: readonly StopReason[] = ["manual", "unsubscribed", "booked", "replied"];

/**
 * Everything recorded about a lead that can end a sequence. Each is the
 * relevant instant (ISO), or null when there is no such fact.
 */
export type StopFacts = {
  /** Earliest accepted_at among the lead's quotes. */
  signedAt: string | null;
  /** Earliest occurred_at of a succeeded payment on the lead's quotes or matters. */
  paidAt: string | null;
  /** Earliest created_at of a matter linked to the lead. */
  matterOpenedAt: string | null;
  /** stage_entered_at when the lead's CURRENT stage is a won-category stage. */
  wonAt: string | null;
  /** crm_lead.last_inbound_at — the newest email from the lead (mailbox sync). */
  lastInboundAt: string | null;
  /** Newest started_at of an imported meeting linked to the lead. */
  lastMeetingAt: string | null;
};

export const NO_FACTS: StopFacts = {
  signedAt: null,
  paidAt: null,
  matterOpenedAt: null,
  wonAt: null,
  lastInboundAt: null,
  lastMeetingAt: null,
};

export type StopDecision = { reason: StopReason; at: string };

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * The fact that makes this lead a client, or null. Order is the order the SOP
 * names them in (Stage 7 then Stage 8): a signed quote is the strongest, then
 * money, then the matter, then a won stage someone moved them to by hand.
 * These count WHENEVER they happened — a client is a client.
 */
export function clientFact(facts: StopFacts): StopDecision | null {
  if (facts.signedAt) return { reason: "signed", at: facts.signedAt };
  if (facts.paidAt) return { reason: "paid", at: facts.paidAt };
  if (facts.matterOpenedAt) return { reason: "matter_opened", at: facts.matterOpenedAt };
  if (facts.wonAt) return { reason: "client", at: facts.wonAt };
  return null;
}

/**
 * Should an enrollment that started at `enrolledAt` stop now?
 *
 * Client facts stop it regardless of when they happened. A reply or a call
 * stops it only when it came AFTER enrolling — an old email from before the
 * lead was enrolled is not a response to this sequence. An unparseable
 * `enrolledAt` is treated as "always before": the guard errs towards stopping.
 */
export function stopFor(facts: StopFacts, enrolledAt: string | null): StopDecision | null {
  const client = clientFact(facts);
  if (client) return client;
  const since = ms(enrolledAt) ?? Number.NEGATIVE_INFINITY;
  const meeting = ms(facts.lastMeetingAt);
  if (meeting !== null && meeting > since) return { reason: "booked", at: facts.lastMeetingAt as string };
  const inbound = ms(facts.lastInboundAt);
  if (inbound !== null && inbound > since) return { reason: "replied", at: facts.lastInboundAt as string };
  return null;
}

/**
 * The client facts recorded AFTER a draft was queued — what makes it stale.
 * Empty means nothing has changed since. Replies are not in this list: a reply
 * is often what a follow-up answers. Newest first is not needed; SOP order is.
 */
export function staleSince(facts: StopFacts, queuedAt: string): StopDecision[] {
  const since = ms(queuedAt);
  if (since === null) return [];
  const out: StopDecision[] = [];
  const add = (reason: StopReason, at: string | null) => {
    const t = ms(at);
    if (t !== null && t > since) out.push({ reason, at: at as string });
  };
  add("signed", facts.signedAt);
  add("paid", facts.paidAt);
  add("matter_opened", facts.matterOpenedAt);
  add("client", facts.wonAt);
  return out;
}

/** Earliest non-null instant of several. */
export function earliest(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const v of values) {
    const t = ms(v);
    if (t !== null && t < bestMs) {
      best = v as string;
      bestMs = t;
    }
  }
  return best;
}

/** Latest non-null instant of several. */
export function latest(values: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    const t = ms(v);
    if (t !== null && t > bestMs) {
      best = v as string;
      bestMs = t;
    }
  }
  return best;
}

/** "Oct 3" in the firm's zone (a bad zone falls back to UTC rather than throwing). */
export function shortDate(iso: string | null, timeZone?: string): string {
  const t = ms(iso);
  if (t === null) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone }).format(new Date(t));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(t));
  }
}

/** "Sequence stopped — signed quote, Oct 3". A stopped row with no recorded reason still says it stopped. */
export function stopLine(stop: { reason: string | null; at: string | null }, timeZone?: string): string {
  const label = isStopReason(stop.reason) ? STOP_REASON_LABEL[stop.reason] : null;
  const date = shortDate(stop.at, timeZone);
  return ["Sequence stopped", [label, date].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
}

/** "Signed Oct 3" — the headline of the approval warning. */
export function staleHeadline(fact: StopDecision, timeZone?: string): string {
  const verb: Record<StopReason, string> = {
    signed: "Signed",
    paid: "Paid",
    matter_opened: "Matter opened",
    client: "Became a client",
    replied: "Replied",
    booked: "Had a call",
    unsubscribed: "Asked us to stop",
    manual: "Stopped",
  };
  return `${verb[fact.reason]} ${shortDate(fact.at, timeZone)}`.trim();
}

/** Why a lead can't be enrolled, as a sentence for the person who tried. */
export function enrollRefusal(leadName: string, fact: StopDecision, timeZone?: string): string {
  const what: Record<StopReason, string> = {
    signed: "signed a quote",
    paid: "paid",
    matter_opened: "has a matter open",
    client: "is in a won stage",
    replied: "replied",
    booked: "had a call",
    unsubscribed: "asked us to stop",
    manual: "was stopped by hand",
  };
  const when = shortDate(fact.at, timeZone);
  return `${leadName} is already a client — ${what[fact.reason]}${when ? ` on ${when}` : ""}. Campaigns are for leads who haven't hired the firm, so nothing was enrolled.`;
}
