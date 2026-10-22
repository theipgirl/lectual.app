/**
 * How long a record has been in its stage, as the Pipeline card says it.
 *
 * An import stamps `stage_entered_at` with the moment it ran, so every
 * imported lead read the same "61d in stage" whatever had happened to it. That
 * is the import date, not a stage entry. So:
 *   1. the newest `stage_changed` activity, when the card has one, is the real
 *      entry: count from it;
 *   2. a stage entry that equals the record's created (import) time, or the
 *      time it was last pulled from Lawmatics, reads "In stage since import"
 *      with no day count;
 *   3. otherwise count days from `stage_entered_at`.
 * Display only: nothing here writes to a lead.
 */
export const SINCE_IMPORT_LABEL = "In stage since import";

/** Two stamps closer than this are the same moment (one import statement). */
const SAME_MOMENT_MS = 5 * 60_000;

export type StageAgeInput = {
  stageEnteredAt: string | null;
  createdAt?: string | null;
  /** When the record was last pulled from Lawmatics, if it came from there. */
  importedAt?: string | null;
  /** Newest `stage_changed` activity for this record, when the page read one. */
  lastStageChangeAt?: string | null;
  now: Date;
};

export type StageAgeDisplay = { days: number | null; label: string | null; sinceImport: boolean };

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function wholeDays(from: number, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from) / 86_400_000));
}

export function daysInStageLabel(days: number): string {
  return `${days}d in stage`;
}

export function stageAgeDisplay(input: StageAgeInput): StageAgeDisplay {
  const change = ms(input.lastStageChangeAt);
  if (change !== null && change <= input.now.getTime()) {
    const days = wholeDays(change, input.now);
    return { days, label: daysInStageLabel(days), sinceImport: false };
  }
  const entered = ms(input.stageEnteredAt);
  if (entered === null) return { days: null, label: null, sinceImport: false };
  const stamps = [ms(input.createdAt), ms(input.importedAt)].filter((t): t is number => t !== null);
  if (stamps.some((t) => Math.abs(t - entered) <= SAME_MOMENT_MS)) {
    return { days: null, label: SINCE_IMPORT_LABEL, sinceImport: true };
  }
  const days = wholeDays(entered, input.now);
  return { days, label: daysInStageLabel(days), sinceImport: false };
}
