import Link from "next/link";
import { notFound } from "next/navigation";
import { isReportKey, REPORTS, type ReportKey } from "@/lib/nav";
import { orgHasModule } from "@/lib/org/modules";
import { REPORT_RANGES, parseReportRange, reportPeriod } from "@/lib/reports/period";
import { loadCommunicationReport } from "@/lib/reports/communication";
import { loadIntakeReport } from "@/lib/reports/intake";
import { loadMattersReport } from "@/lib/reports/matters";
import { loadIposReport } from "@/lib/reports/ipos";
import type { Metric } from "@/lib/reports/metric";
import type { LinkTile, WaitingItem } from "@/lib/reports/waiting";

export const dynamic = "force-dynamic";

type ReportData = { kpis: Metric[]; waiting: WaitingItem[]; links: LinkTile[]; banner: string | null };

/**
 * Copy for each report — matching design/Matters_Prototype.dc.html's `rp`
 * blocks (Communication, Intake, else-branch = Active matters). IP.OS has no
 * block of its own in the prototype; it follows the same shape.
 */
const REPORT_COPY: Record<ReportKey, { sub: string; waitingTitle: string; waitingEmpty: string }> = {
  communication: {
    sub: "How fast the firm answers, where messages come from, and what's still waiting on a reply across intake, My Mail, campaigns and SMS.",
    waitingTitle: "Waiting on the firm",
    waitingEmpty: "Nothing is waiting on a reply right now.",
  },
  intake: {
    sub: "Where new clients come from, how many make it from first touch to a signed engagement, and who is waiting on the firm.",
    waitingTitle: "Waiting on the firm",
    waitingEmpty: "Nothing is waiting on the firm right now.",
  },
  matters: {
    sub: "The engaged book of work: where each matter sits between opinion letter and registration, what's due at the USPTO, and what is waiting on the firm.",
    waitingTitle: "Waiting on the firm",
    waitingEmpty: "Nothing is waiting on the firm right now.",
  },
  ipos: {
    sub: "What the firm's agents ran, what they drafted, and what needs a look.",
    waitingTitle: "Needs attention",
    waitingEmpty: "Nothing needs your attention right now.",
  },
};

/** A KPI tile: value, delta against the previous equal period, a short sub-line — or an
 * honest "—" with why, never a fabricated number (src/lib/reports/metric.ts). */
function KpiTile({ m }: { m: Metric }) {
  const positive = m.delta?.startsWith("+");
  return (
    <div className="lx-card lx-kpi">
      <span className="lx-label">{m.label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span className="lx-kpi-value">{m.value === null ? "—" : m.value}</span>
        {m.delta && <span className="lx-note" style={{ color: positive ? "var(--ok)" : "var(--wine)" }}>{m.delta}</span>}
      </span>
      <span className="lx-note">{m.value === null ? (m.note ?? "Couldn't load") : m.sub}</span>
    </div>
  );
}

/** One child section, with its own count — or no badge at all when a count isn't available. */
function LinkTileCard({ l }: { l: LinkTile }) {
  return (
    <Link href={l.href} className="lx-card lx-kpi" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{l.label}</span>
        <span className="lx-note">{l.sub}</span>
      </span>
      {l.count !== null && <span className="lx-kpi-value" style={{ fontSize: 28 }}>{l.count}</span>}
    </Link>
  );
}

/**
 * Every rail parent (Communication, Intake, Active matters, IP.OS) opens this
 * as its own view: a period selector, KPIs for that period, what's oldest and
 * waiting on the firm, and a link to each child section with its count.
 *
 * Every number comes from getScopedClient() through src/lib/reports/*.ts. An
 * unreadable or not-yet-computable metric renders "—" with why, never 0 —
 * the same rule the approval queue's three-state read established.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { key } = await params;
  if (!isReportKey(key)) notFound();
  const { range: rangeRaw } = await searchParams;
  const range = parseReportRange(rangeRaw);
  const period = reportPeriod(range);

  const [hasMailbox, hasAgents] = await Promise.all([orgHasModule("mailbox"), orgHasModule("agents")]);

  let data: ReportData;
  switch (key) {
    case "communication":
      data = await loadCommunicationReport(period, { hasMailbox, hasAgents });
      break;
    case "intake":
      data = await loadIntakeReport(period);
      break;
    case "matters":
      data = await loadMattersReport(period);
      break;
    case "ipos":
      data = await loadIposReport(period, { hasAgents });
      break;
  }

  const copy = REPORT_COPY[key];
  const base = REPORTS[key].href;
  const rangeHref = (r: number) => (r === 30 ? base : `${base}?range=${r}`);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Report</div>
          <h1 className="lx-h1">{REPORTS[key].label}</h1>
          <p className="lx-sub">{copy.sub}</p>
        </div>
        <nav className="lx-segs lx-view-toggle" aria-label="Period">
          {REPORT_RANGES.map((r) => (
            <Link key={r} href={rangeHref(r)} aria-current={range === r ? "page" : undefined} className={range === r ? "on" : undefined}>
              {r} days
            </Link>
          ))}
        </nav>
      </div>

      {data.banner && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          {data.banner}
        </p>
      )}

      <div className="lx-kpis">
        {data.kpis.map((m) => (
          <KpiTile key={m.label} m={m} />
        ))}
      </div>

      <div className="lx-split">
        <div className="lx-col">
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }}>
            <h2 className="lx-h2" style={{ fontSize: 25 }}>
              {copy.waitingTitle}
            </h2>
            {data.waiting.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>
                {copy.waitingEmpty}
              </p>
            ) : (
              <ul className="lx-list">
                {data.waiting.map((w) => (
                  <li key={w.key} className="lx-task">
                    <span style={{ minWidth: 0 }}>
                      <Link href={w.href} className="lx-rowlink">
                        {w.text}
                      </Link>
                      <span className="lx-note" style={{ display: "block" }}>
                        {w.meta}
                      </span>
                    </span>
                    <span className="lx-note" style={{ fontWeight: 500, color: "var(--ox)" }}>
                      {w.cta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="lx-col lx-col-aside" style={{ gap: 10 }}>
          {data.links.map((l) => (
            <LinkTileCard key={l.label} l={l} />
          ))}
        </aside>
      </div>
    </>
  );
}
