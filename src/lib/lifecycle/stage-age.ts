/**
 * How long a record has been in its stage, as the Pipeline card says it.
 *
 * An import stamps `stage_entered_at` with the moment it ran, so every
 * imported lead read the same "61d in stage" whatever had happened to it. That
 * is the import date, not a stage entry. That only applies to a record that
 * carries an import marker (`imported`); a form or manual record whose stage
 * date equals its created time was simply created, so it counts days. So:
 *   1. a `stage_entered_at` that is NOT the created or Lawmatics-synced stamp was
 *      set on purpose (a move, a reconcile with the sheet's date, an Undo): count
 *      from it, whatever the activity log says;
 *   2. when it IS the import stamp, the newest `stage_changed` activity, if the
 *      card has one, is the real entry: count from it;
 *   3. otherwise it reads "In stage since import" with no day count.
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
  /** True when the record carries an import marker (Lawmatics id or sync, sheet key). Without one, nothing stamped its dates but the app. */
  imported?: boolean;
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
  const entered = ms(input.stageEnteredAt);
  const change = ms(input.lastStageChangeAt);
  const usableChange = change !== null && change <= input.now.getTime() ? change : null;
  const stamps = [ms(input.createdAt), ms(input.importedAt)].filter((t): t is number => t !== null);
  const isImportStamp = input.imported === true && entered !== null && stamps.some((t) => Math.abs(t - entered) <= SAME_MOMENT_MS);
  if (entered !== null && !isImportStamp) {
    const days = wholeDays(entered, input.now);
    return { days, label: daysInStageLabel(days), sinceImport: false };
  }
  if (usableChange !== null) {
    const days = wholeDays(usableChange, input.now);
    return { days, label: daysInStageLabel(days), sinceImport: false };
  }
  if (entered === null) return { days: null, label: null, sinceImport: false };
  return { days: null, label: SINCE_IMPORT_LABEL, sinceImport: true };
}
