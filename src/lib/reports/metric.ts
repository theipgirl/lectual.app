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
  sub: string;
  /** Why `value` is "—" (module off, table missing, read failed). Shown in place of `sub`. */
  note?: string;
  href?: string;
};

/** A metric whose value could not be read/computed at all. */
export function unavailableMetric(label: string, note: string, href?: string): Metric {
  return { label, value: null, sub: "", note, href };
}

/**
 * "+18%" / "−4%" (previous > 0), "+3" (previous was 0 and something showed
 * up), or null when a delta is not computable (either side unknown, or both
 * zero — a "+0%" would read as a real, if boring, fact rather than "nothing
 * to compare").
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
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}
