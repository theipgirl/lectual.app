import type { Metric } from "@/lib/reports/metric";

/** A KPI tile: value, delta against the previous equal period, a short sub-line — or an
 * honest "—" with why, never a fabricated number (src/lib/reports/metric.ts). */
export function KpiTile({ m }: { m: Metric }) {
  const positive = m.delta?.startsWith("+");
  return (
    <div className="lx-card lx-kpi">
      <span className="lx-label">{m.label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span className="lx-kpi-value">{m.value === null ? "—" : m.value}</span>
        {m.delta && <span className="lx-note" style={{ color: positive ? "var(--ok)" : "var(--wine)" }}>{m.delta}</span>}
      </span>
      <span className="lx-note">{m.value === null ? (m.note ?? "Couldn't load") : m.sub}</span>
      {m.value !== null && m.compare && <span className="lx-note">{m.compare}</span>}
    </div>
  );
}
