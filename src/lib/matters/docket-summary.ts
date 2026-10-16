/**
 * Pure docket aggregation — no database, no server-only imports.
 *
 * The ops home page is a firm's first screen every morning, and for RPB it read
 * as an empty product: it counted leads, tasks and queue drafts, none of which
 * that firm has, while 110 live matters sat one click away and completely
 * uncounted. This module is the arithmetic behind the docket section that fixes
 * that — kept pure so it can be tested without a database, the same reason
 * stage-rules.ts lives apart from stages.ts.
 *
 * Two rules it inherits from stage-rules.ts and does not relitigate:
 *
 *  1. Staleness is measured against WHO is holding the matter (`waiting_on`),
 *     never against a hardcoded stage number.
 *  2. Counting fails toward showing work, not toward silence. A matter that is
 *     not on the docket yet is counted as open and reported separately as
 *     unplaced — it is never quietly dropped out of the totals, because a
 *     number that under-reports the book of business is the same class of lie
 *     as an approval queue rendering "all caught up" while unreachable.
 */

import { daysInStage, matterIsStale, STALE_THRESHOLD_DAYS, type MatterWaitingOn } from "./stage-rules";

/**
 * The shape summarizeDocket needs. Structural on purpose: `Matter`
 * (MatterRow & { stage }) satisfies it without this module importing the
 * server-only matters lib.
 */
export type DocketMatterInput = {
  id: string;
  matter_number: string;
  title: string | null;
  mark_text: string | null;
  status: string;
  stage_entered_at: string | null;
  stage: {
    code: string;
    label: string;
    is_open: boolean;
    waiting_on: MatterWaitingOn;
  } | null;
};

/** One row of the "worst offenders" list, ready to render. */
export type StalledMatter = {
  id: string;
  /** Mark text if the file has one, else the matter title, else its number. */
  label: string;
  matterNumber: string;
  stageCode: string | null;
  stageLabel: string | null;
  waitingOn: MatterWaitingOn;
  daysInStage: number;
  /** Days past this matter's threshold — what sorts the list. */
  daysOverThreshold: number;
};

export type DocketSummary = {
  /** Every matter handed in, open or closed. */
  total: number;
  /** Matters still live — see isOpenMatter. */
  open: number;
  /** Open matters by who is holding them. Unplaced matters are NOT in here. */
  waitingOn: Record<MatterWaitingOn, number>;
  /** Open matters with no stage yet — counted in `open`, reported separately. */
  unplaced: number;
  /** Open matters past their threshold, worst first. */
  stalled: StalledMatter[];
};

const WAITING_ON_VALUES: MatterWaitingOn[] = ["firm", "client", "uspto", "court"];

export const WAITING_ON_LABEL: Record<MatterWaitingOn, string> = {
  firm: "Waiting on firm",
  client: "Waiting on client",
  uspto: "Waiting on USPTO",
  court: "Waiting on court",
};

/**
 * Is this matter still live?
 *
 * Two independent signals can close a file: the lifecycle column
 * (`status = 'closed'`) and the docket stage's own `is_open = false` (the
 * registered/abandoned/closed columns of the board). Either one closes it;
 * a matter with neither — including one not yet placed on the docket — is open.
 */
export function isOpenMatter(matter: DocketMatterInput): boolean {
  if (matter.status === "closed") return false;
  if (matter.stage && !matter.stage.is_open) return false;
  return true;
}

/** Best human name for a matter: the mark, else the title, else the number. */
export function matterLabel(matter: DocketMatterInput): string {
  return matter.mark_text?.trim() || matter.title?.trim() || matter.matter_number;
}

/**
 * Counts the open docket and picks out the matters that have gone quiet.
 *
 * `now` is injected so the caller (and the tests) control the clock rather than
 * reading it three times mid-aggregation.
 */
export function summarizeDocket(
  matters: readonly DocketMatterInput[],
  now: Date = new Date(),
): DocketSummary {
  // Spelled out rather than derived, because the exhaustive Record is what
  // makes a new waiting_on value a COMPILE error here instead of a `NaN` in a
  // KPI tile: `waitingOn[who] += 1` on a missing key silently yields NaN.
  const waitingOn: Record<MatterWaitingOn, number> = {
    firm: 0,
    client: 0,
    uspto: 0,
    court: 0,
  };
  const stalled: StalledMatter[] = [];
  let open = 0;
  let unplaced = 0;

  for (const matter of matters) {
    if (!isOpenMatter(matter)) continue;
    open += 1;

    if (!matter.stage) {
      unplaced += 1;
      continue;
    }

    waitingOn[matter.stage.waiting_on] += 1;

    if (!matterIsStale({ stage_entered_at: matter.stage_entered_at, waiting_on: matter.stage.waiting_on }, now)) {
      continue;
    }
    // matterIsStale only returns true when the day count resolved, so this
    // cannot be null here; the ?? 0 keeps the type honest without a cast.
    const days = daysInStage(matter.stage_entered_at, now) ?? 0;
    stalled.push({
      id: matter.id,
      label: matterLabel(matter),
      matterNumber: matter.matter_number,
      stageCode: matter.stage.code,
      stageLabel: matter.stage.label,
      waitingOn: matter.stage.waiting_on,
      daysInStage: days,
      daysOverThreshold: days - STALE_THRESHOLD_DAYS[matter.stage.waiting_on],
    });
  }

  stalled.sort((a, b) => b.daysOverThreshold - a.daysOverThreshold || a.label.localeCompare(b.label));

  return { total: matters.length, open, waitingOn, unplaced, stalled };
}

export { WAITING_ON_VALUES };
