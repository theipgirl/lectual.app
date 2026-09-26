/**
 * Pure filing-followup monthly-status-update logic — no database, no AI, no
 * server-only imports. Same discipline as stage-rules.ts / team-status.ts:
 * this is the arithmetic a client component or a plain unit test can import
 * directly.
 *
 * Ports two things staff currently do by hand, per Dawn's 2026-06-22
 * walkthrough (lectual-plugin skills/filing-followup/SKILL.md):
 *
 *  1. The due-ness computation crew/monthly-status-sweep.md runs on a
 *     schedule — "is this matter due for its next monthly status email?" —
 *     for the dashboard's real-time button instead of an overnight sweep.
 *     Same stage (`18. Awaiting Trademark Registration`), same ~5-month
 *     sequence, same "queue the NEXT sequential month, never skip ahead"
 *     rule. This dashboard has one advantage the crew task explicitly
 *     doesn't: it can read the real approval queue for what's already been
 *     drafted (see filing-followup-queue.ts), so it doesn't need that file's
 *     calendar-only fallback or its "VERIFY" caveat on every headline.
 *  2. Template 2 (the monthly status update) from
 *     firm/templates/filing-emails.md, filled in deterministically — no AI.
 *     This mirrors src/lib/documents/loe.ts's buildTrademarkLoeDraft, not
 *     opinion-letter.ts's askClaude path: the SOP says boilerplate is
 *     reproduced "close to verbatim," and N/X are arithmetic off the real
 *     filing date, not judgment calls a model should be making. There is
 *     nothing here for Claude to summarize or synthesize.
 */

/** The docket stage this whole feature watches — "18. Awaiting Trademark
 * Registration" in scripts/rpb-matter-stages.ts. A stage's identity is its
 * full code (see stages.ts's own note); this one has no sub-stage letter. */
export const AWAITING_REGISTRATION_STAGE_CODE = "18";

/** The SOP's "~5 months" monthly sequence length. Past this, the sweep
 * stops auto-drafting and flags the matter for a human to verify the stage
 * is even still accurate (crew/monthly-status-sweep.md step 3). */
export const MONTHLY_SEQUENCE_MAX_MONTHS = 5;

/**
 * The single EA-review estimate this feature uses for X (months remaining),
 * resolving firm/templates/filing-emails.md's own flagged inconsistency
 * ("Timeline consistency note": the filing email says 8–10 months, the
 * monthly template's sample said ~4). 9 is the midpoint of the filing
 * email's stated range — the number every client already saw at filing — so
 * N + X here is always consistent with what was already sent, per the SOP's
 * "pick ONE consistent basis" instruction.
 */
export const FIRM_EA_REVIEW_ESTIMATE_MONTHS = 9;

/**
 * Whole months from a civil filing date (YYYY-MM-DD) to `now`. Floored, so a
 * filing from earlier this same calendar month is 0 (not yet a month in).
 * Returns 0 for an unparseable date rather than throwing — callers check
 * `filingDate` for null/presence separately.
 */
export function monthsElapsed(filingDateIso: string, now: Date = new Date()): number {
  const filed = new Date(`${filingDateIso}T00:00:00.000Z`);
  if (Number.isNaN(filed.getTime())) return 0;
  let months =
    (now.getUTCFullYear() - filed.getUTCFullYear()) * 12 + (now.getUTCMonth() - filed.getUTCMonth());
  if (now.getUTCDate() < filed.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export type FollowUpStatus =
  | { kind: "no_filing_date" }
  | { kind: "not_due"; monthsElapsed: number }
  | { kind: "due"; monthsElapsed: number; monthNumber: number; monthsRemainingEstimate: number }
  | { kind: "already_queued"; monthNumber: number }
  | { kind: "stale"; monthsElapsed: number }
  /** The approval queue couldn't be read, so it's unknown whether this
   * month's update was already drafted. Never offer to draft in this state —
   * that's exactly how a client ends up with two status emails for the same
   * month (the failure crew/monthly-status-sweep.md's KNOWN LIMITATION
   * section exists to prevent). */
  | { kind: "queue_unknown" };

/**
 * Decides whether a matter in the awaiting-registration stage is due for its
 * next monthly status update.
 *
 * `monthsAlreadyQueued` is every month number this matter already has a
 * queued-or-approved CLIENT_EMAIL draft for (see filing-followup-queue.ts).
 * `null` means "couldn't determine" (queue unreachable/not configured) —
 * distinct from `[]`, which means "reached the queue, genuinely nothing
 * queued yet" — same ok/unconfigured/unavailable discipline
 * src/lib/queue/load.ts uses for the same reason: an unknown state must
 * never be read as "safe to draft."
 *
 * The next month queued is always `max(alreadyQueued) + 1`, never jumped
 * ahead to match `monthsElapsed` directly — a matter that sat unattended for
 * three months gets offered month 1 first, then 2, then 3, one at a time,
 * matching the crew sweep's "one matter per tick, most overdue first" and
 * never implying a sequence that skipped months actually went out.
 */
export function computeFollowUpStatus(
  input: { filingDate: string | null; monthsAlreadyQueued: readonly number[] | null },
  now: Date = new Date(),
): FollowUpStatus {
  if (!input.filingDate) return { kind: "no_filing_date" };

  const elapsed = monthsElapsed(input.filingDate, now);
  if (elapsed < 1) return { kind: "not_due", monthsElapsed: elapsed };
  if (elapsed > MONTHLY_SEQUENCE_MAX_MONTHS) return { kind: "stale", monthsElapsed: elapsed };

  if (input.monthsAlreadyQueued === null) return { kind: "queue_unknown" };

  const maxQueued = input.monthsAlreadyQueued.length ? Math.max(...input.monthsAlreadyQueued) : 0;
  const targetMonth = Math.min(elapsed, MONTHLY_SEQUENCE_MAX_MONTHS);
  if (maxQueued >= targetMonth) return { kind: "already_queued", monthNumber: maxQueued };

  const monthNumber = maxQueued + 1;
  const monthsRemainingEstimate = Math.max(1, FIRM_EA_REVIEW_ESTIMATE_MONTHS - monthNumber);
  return { kind: "due", monthsElapsed: elapsed, monthNumber, monthsRemainingEstimate };
}

/** True for the states where a human should see something actionable — due,
 * stale (needs a stage/status check), or missing the filing date it needs to
 * compute anything at all. Excludes `not_due`, `already_queued`, and
 * `queue_unknown`'s ordinary case from a "needs attention" list, though the
 * caller should still surface `queue_unknown` itself as its own banner
 * rather than silently dropping it (see filing-followup-queue.ts). */
export function followUpNeedsAttention(status: FollowUpStatus): boolean {
  return status.kind === "due" || status.kind === "stale" || status.kind === "no_filing_date";
}

/** Headline pattern every monthly-update draft is queued under — kept
 * identical to crew/monthly-status-sweep.md's own headline shape so a draft
 * queued by the crew task and one queued from this dashboard are
 * indistinguishable to loadFollowUpQueueState's parser. */
export function monthlyUpdateHeadline(markText: string, monthNumber: number): string {
  return `Monthly Status Update — Month ${monthNumber} of ~${MONTHLY_SEQUENCE_MAX_MONTHS} — ${markText}`;
}

const HEADLINE_MONTH_RE = /Monthly Status Update — Month (\d+) of ~\d+/;

/** Recovers the month number from a queued draft's headline, or null if the
 * headline doesn't match this feature's pattern at all (a different draft
 * type, or hand-edited beyond recognition — treated as "not one of ours"
 * rather than guessed at). */
export function parseMonthlyUpdateMonth(headline: string): number | null {
  const m = HEADLINE_MONTH_RE.exec(headline);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export type MonthlyStatusFacts = {
  clientFirstName: string;
  markText: string;
  monthNumber: number;
  monthsRemainingEstimate: number;
};

export type MonthlyStatusDraft = {
  headline: string;
  summary: string;
  subject: string;
  draftBody: string;
};

/**
 * Fills Template 2 (firm/templates/filing-emails.md) deterministically.
 * Every variable field (`[First Name]`, `[MARK]`, `[N]`, `[X]`) is filled
 * exactly as given; the boilerplate sentences around them are reproduced
 * verbatim, per the filing-followup SOP's HARD RULE 2 equivalent in
 * opinion-letter.ts ("boilerplate... reproduced close to verbatim... do not
 * improve or paraphrase").
 */
export function buildMonthlyStatusUpdateDraft(facts: MonthlyStatusFacts): MonthlyStatusDraft {
  const monthsWord = facts.monthNumber === 1 ? "month" : "months";
  const remainingWord = facts.monthsRemainingEstimate === 1 ? "month" : "months";

  const draftBody = `⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.

Hello ${facts.clientFirstName},

I hope all is well.

I wanted to follow up with a quick update on your trademark application for **${facts.markText}**.

We're now about **${facts.monthNumber} ${monthsWord}** into the process, and based on current USPTO timelines, we anticipate the examining attorney's initial review in approximately **${facts.monthsRemainingEstimate} ${remainingWord}**. This is right on track with standard processing times, so there's no action needed from you at this stage.

We'll continue to monitor your application closely and will reach out as soon as there's movement or if any response is required.

In the meantime, if you have any questions or would like to discuss other intellectual property or business matters, please don't hesitate to reach out.

Warm regards,
RPB Law Operations

---
Internal (not part of the email): Month ${facts.monthNumber} of ~${MONTHLY_SEQUENCE_MAX_MONTHS}, computed from the matter's filing date. Firm EA-review estimate used: ${FIRM_EA_REVIEW_ESTIMATE_MONTHS} months (see filing-followup.ts). Confirm this is genuinely the next update due before approving.`;

  return {
    headline: monthlyUpdateHeadline(facts.markText, facts.monthNumber),
    summary: `Filing follow-up: month ${facts.monthNumber} of ~${MONTHLY_SEQUENCE_MAX_MONTHS} status update for ${facts.markText}.`,
    subject: "A quick update on your trademark application",
    draftBody,
  };
}

/** The minimal matter shape buildFilingFollowUpRows needs — structural, like
 * docket-summary.ts's DocketMatterInput, so the server-side `Matter` type
 * satisfies it without this module importing anything server-only. */
export type FilingFollowUpMatterInput = {
  id: string;
  matter_number: string;
  mark_text: string | null;
  title: string | null;
  filing_date: string | null;
  stage: { code: string } | null;
};

export type FilingFollowUpRow = {
  matterId: string;
  matterNumber: string;
  label: string;
  status: FollowUpStatus;
};

/**
 * `queuedMonthsByMatter === null` means the queue state is unknown (couldn't
 * reach it / not configured) — every row falls back to `queue_unknown`
 * rather than silently reading as "nothing queued yet." When it's a map,
 * a matter simply absent from it has genuinely queued nothing (`[]`).
 */
export type QueuedMonthsLookup = ReadonlyMap<string, readonly number[]> | null;

/**
 * Every stage-18 matter's follow-up status, sorted most-actionable first
 * (due, then stale, then missing a filing date, then everything else) — the
 * order the Team Status "Filing follow-ups due" section renders in.
 */
export function buildFilingFollowUpRows(
  matters: readonly FilingFollowUpMatterInput[],
  queuedMonthsByMatter: QueuedMonthsLookup,
  now: Date = new Date(),
): FilingFollowUpRow[] {
  const rows: FilingFollowUpRow[] = [];
  for (const m of matters) {
    if (m.stage?.code !== AWAITING_REGISTRATION_STAGE_CODE) continue;
    const monthsAlreadyQueued = queuedMonthsByMatter ? queuedMonthsByMatter.get(m.id) ?? [] : null;
    const status = computeFollowUpStatus({ filingDate: m.filing_date, monthsAlreadyQueued }, now);
    rows.push({
      matterId: m.id,
      matterNumber: m.matter_number,
      label: m.mark_text?.trim() || m.title?.trim() || m.matter_number,
      status,
    });
  }

  const rank: Record<FollowUpStatus["kind"], number> = {
    due: 0,
    stale: 1,
    no_filing_date: 2,
    queue_unknown: 3,
    not_due: 4,
    already_queued: 5,
  };
  rows.sort((a, b) => rank[a.status.kind] - rank[b.status.kind]);
  return rows;
}
