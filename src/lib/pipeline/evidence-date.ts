/**
 * The date a caller says a lead really entered its stage, or null when it is unusable: not an ISO
 * date, not a real calendar day, or later than now. An unusable date is ignored (the move stamps
 * now); it is never an error.
 */
export function usableEvidenceDate(value: string | null | undefined, nowMs: number): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms > nowMs) return null;
  // Date.parse rolls "2026-02-31" over to March; a real day reads back as itself.
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (day.getUTCFullYear() !== Number(match[1]) || day.getUTCMonth() !== Number(match[2]) - 1 || day.getUTCDate() !== Number(match[3])) {
    return null;
  }
  return new Date(ms).toISOString();
}
