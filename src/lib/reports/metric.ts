/**
 * A report KPI tile's shape (design/Matters_Prototype.dc.html's `rpKpis`):
 * a value, a delta against the previous equal period, and a short sub-line.
 *
 * `value: null` renders as "—", never a fabricated 0 — see `note` for why.
 * Pure module: building one of these never touches a database.
 */
export type Metric = {
  label: string;
  value: number | string | null;
  delta?: string | null;
  /** The prior count in words ("2 vs 168 in the previous 7 days"), shown under the value. */
  compare?: string | null;
  sub: string;
  /** Why `value` is "—" (module off, table missing, read failed). Shown in place of `sub`. */
  note?: string;
  href?: string;
};

/** A metric whose value could not be read/computed at all. */
export function unavailableMetric(label: string, note: string, href?: string): Metric {
  return { label, value: null, sub: "", note, href };
}

/** A percentage beyond this either way is not a comparison a person can use. */
export const MAX_PERCENT_CHANGE = 500;
/** A collapse to under this share of a large prior period is a one-off spike behind us (a backfilled import), not a trend. */
const SPIKE_PRIOR_MIN = 20;
const SPIKE_DROP_SHARE = 0.1;

/**
 * "+18%" / "−4%" (previous > 0), "+3" (previous was 0 and something showed
 * up), or null when a delta is not computable (either side unknown, or both
 * zero — a "+0%" would read as a real, if boring, fact rather than "nothing
 * to compare").
 *
 * A percentage is withheld (null) when it would mislead: a change beyond
 * ±500%, or a collapse to under a tenth of a prior period of 20 or more
 * (the "New leads 2, -99%" a backfilled import produced). The prior count is
 * always available in words through `comparisonText`.
 */
export function periodDelta(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (previous === 0) {
    if (diff === 0) return null;
    return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
  }
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) return null;
  if (Math.abs(pct) > MAX_PERCENT_CHANGE) return null;
  if (previous >= SPIKE_PRIOR_MIN && current < previous * SPIKE_DROP_SHARE) return null;
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/** "2 vs 168 in the previous 7 days", or null when either side is unknown. */
export function comparisonText(current: number | null, previous: number | null, days: number): string | null {
  if (current === null || previous === null) return null;
  return `${current} vs ${previous} in the previous ${days} days`;
}

/** The delta and its words, ready to spread into a Metric. */
export function comparisonFields(current: number | null, previous: number | null, days: number): Pick<Metric, "delta" | "compare"> {
  return { delta: periodDelta(current, previous), compare: comparisonText(current, previous, days) };
}
