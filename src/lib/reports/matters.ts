import "server-only";
import { listMatters, listUpcomingDeadlines, matterLabel, summarizeDocket } from "@/lib/matters";
import { filterBySegment } from "@/lib/matters/worklist";
import { periodDelta, unavailableMetric, type Metric } from "./metric";
import { isInPeriod, isInPreviousPeriod, type ReportPeriod } from "./period";
import { oldestFirst, type LinkTile, type WaitingItem } from "./waiting";
import { relativeTime } from "@/lib/relative-time";

export type MattersReport = {
  kpis: Metric[];
  waiting: WaitingItem[];
  links: LinkTile[];
  banner: string | null;
};

const EMPTY_SETS = { review: new Set<string>(), stalled: new Set<string>() };

/**
 * Active matters: where the engaged book of work sits between opinion letter
 * and registration, what's due at the USPTO, and what's waiting on the firm.
 */
export async function loadMattersReport(period: ReportPeriod): Promise<MattersReport> {
  const [matters, deadlines] = await Promise.all([
    listMatters().catch(() => null),
    listUpcomingDeadlines({ withinDays: 30 }).catch(() => null),
  ]);

  if (!matters) {
    const failed = unavailableMetric("", "Matters couldn't be loaded");
    return {
      kpis: [{ ...failed, label: "Open matters" }, { ...failed, label: "Waiting on us" }, { ...failed, label: "USPTO deadlines · 30 days" }, { ...failed, label: "Registrations" }],
      waiting: [],
      links: [
        { label: "All matters", sub: "The full worklist, grouped by client", href: "/dashboard/matters/", count: null },
        { label: "Pipeline", sub: "Every client from intake to registration", href: "/dashboard/pipeline/", count: null },
        { label: "Documents", sub: "Filings, specimens and letters", href: "/dashboard/documents/", count: null },
        { label: "Client portals", sub: "What each client can see", href: "/dashboard/portals/", count: null },
      ],
      banner: "Matters couldn't be loaded.",
    };
  }

  const docket = summarizeDocket(matters, period.end);

  const openMatters: Metric = { label: "Open matters", value: docket.open, sub: `${docket.waitingOn.firm} waiting on us` };

  const waitingOnFirm: Metric = { label: "Waiting on us", value: docket.waitingOn.firm, sub: "of the open docket" };

  const deadlineMetric: Metric =
    deadlines === null
      ? unavailableMetric("USPTO deadlines · 30 days", "Deadlines couldn't be loaded")
      : { label: "USPTO deadlines · 30 days", value: deadlines.length, sub: "office actions, SOUs, renewals" };

  const registered = matters.filter((m) => isInPeriod(m.registration_date, period)).length;
  const prevRegistered = matters.filter((m) => isInPreviousPeriod(m.registration_date, period)).length;
  const registrations: Metric = {
    label: "Registrations",
    value: registered,
    delta: periodDelta(registered, prevRegistered),
    sub: "marks that registered this period",
  };

  const waitingMatters = filterBySegment(matters, "firm", EMPTY_SETS);
  const waiting: WaitingItem[] = oldestFirst(waitingMatters, (m) => m.stage_entered_at, 5).map((m) => ({
    key: m.id,
    text: matterLabel(m) + (m.owner_name ? ` · ${m.owner_name}` : ""),
    meta: m.stage_entered_at ? `In stage since ${relativeTime(m.stage_entered_at)}` : m.stage ? `${m.stage.code}. ${m.stage.label}` : "Not on the docket",
    cta: "Open",
    href: `/dashboard/matters/${m.id}/`,
  }));

  const links: LinkTile[] = [
    { label: "All matters", sub: "The full worklist, grouped by client", href: "/dashboard/matters/", count: docket.open },
    { label: "Pipeline", sub: "Every client from intake to registration", href: "/dashboard/pipeline/", count: null },
    { label: "Documents", sub: "Filings, specimens and letters", href: "/dashboard/documents/", count: null },
    { label: "Client portals", sub: "What each client can see", href: "/dashboard/portals/", count: null },
  ];

  return {
    kpis: [openMatters, waitingOnFirm, deadlineMetric, registrations],
    waiting,
    links,
    banner: deadlines === null ? "Deadlines couldn't be loaded, so the 30-day figure above may be incomplete." : null,
  };
}
