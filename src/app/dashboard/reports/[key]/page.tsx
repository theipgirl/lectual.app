import Link from "next/link";
import { notFound } from "next/navigation";
import { isReportKey, REPORTS, REPORTS_INDEX, type ReportKey } from "@/lib/nav";
import { orgHasModule } from "@/lib/org/modules";
import { REPORT_RANGES, parseReportRange, reportPeriod } from "@/lib/reports/period";
import { loadCommunicationReport } from "@/lib/reports/communication";
import { loadIntakeReport } from "@/lib/reports/intake";
import { canSeeFormsAndProposals } from "@/lib/auth/forms-proposals";
import { currentRole } from "@/lib/auth/current-role";
import { loadMattersReport } from "@/lib/reports/matters";
import { loadIposReport } from "@/lib/reports/ipos";
import { KpiTile } from "@/components/reports/KpiTile";
import type { Metric } from "@/lib/reports/metric";
import type { LinkTile, WaitingItem } from "@/lib/reports/waiting";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { ViewToggle } from "@/components/ViewToggle";
import { MAIL_NAME } from "@/lib/ui/words";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: pageTitle(isReportKey(key) ? REPORTS[key].label : "Report") };
}

export const dynamic = "force-dynamic";

type ReportData = { kpis: Metric[]; waiting: WaitingItem[]; links: LinkTile[]; banner: string | null };

/**
 * Copy for each report — matching design/Matters_Prototype.dc.html's `rp`
 * blocks (Communication, Intake, else-branch = Active matters). IP.OS has no
 * block of its own in the prototype; it follows the same shape.
 */
const REPORT_COPY: Record<ReportKey, { sub: string; waitingTitle: string; waitingEmpty: string }> = {
  communication: {
    sub: `How fast the firm answers, where messages come from, and what's still waiting on a reply across intake, ${MAIL_NAME}, campaigns and SMS.`,
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
    sub: "What the firm's assistants ran, what they drafted, and what needs a look.",
    waitingTitle: "Needs attention",
    waitingEmpty: "Nothing needs your attention right now.",
  },
};

/** One child section, with its own count — or no badge at all when a count isn't available. */
function LinkTileCard({ l }: { l: LinkTile }) {
  return (
    <Link href={l.href} className="lx-card lx-kpi" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="lx-h3" style={{ display: "block" }}>{l.label}</span>
        <span className="lx-note">{l.sub}</span>
      </span>
      {l.count !== null && <span className="lx-kpi-value">{l.count}</span>}
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
      data = await loadIntakeReport(period, { canOpenForms: canSeeFormsAndProposals(await currentRole()) });
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
      <PageHeader
        back={{ href: REPORTS_INDEX, label: "Reports" }}
        title={REPORTS[key].label}
        sub={<>{copy.sub}</>}
        actions={
          <ViewToggle
            label="Period"
            value={String(range)}
            views={REPORT_RANGES.map((r) => ({ value: String(r), label: `${r} days` }))}
            hrefFor={(v) => rangeHref(Number(v))}
            prefetch={false}
          />
        }
      />

      {data.banner && <Notice tone="warn">{data.banner}</Notice>}

      <div className="lx-kpis">
        {data.kpis.map((m) => (
          <KpiTile key={m.label} m={m} />
        ))}
      </div>

      <div className="lx-split">
        <div className="lx-col">
          <section className="lx-card lx-pad" style={{ display: "grid", gap: 10 }}>
            <h2 className="lx-h2">{copy.waitingTitle}</h2>
            {data.waiting.length === 0 ? (
              <EmptyState variant="line">{copy.waitingEmpty}</EmptyState>
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
