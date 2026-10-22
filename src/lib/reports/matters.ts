import "server-only";
import { listMatters, listUpcomingDeadlines, matterLabel, summarizeDocket } from "@/lib/matters";
import { filterBySegment } from "@/lib/matters/worklist";
// Straight from the pure module, not the @/lib/matters barrel, so a mock of the barrel keeps working.
import { deadlineKindLabel, deadlineNeedsReview } from "@/lib/matters/deadline-rules";
import { civilDaysBetween, firmCivilDate } from "@/lib/quotes/firm-time";
import { getFirmTimeZone } from "@/lib/org/profile";
import { comparisonFields, unavailableMetric, type Metric } from "./metric";
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

const UPCOMING_DAYS = 30;
const WAITING_LIMIT = 5;

/**
 * Active matters: where the engaged book of work sits between opinion letter
 * and registration, what's due at the USPTO, and what's waiting on the firm.
 */
export async function loadMattersReport(period: ReportPeriod): Promise<MattersReport> {
  const [matters, deadlines, tz] = await Promise.all([
    listMatters().catch(() => null),
    listUpcomingDeadlines({ withinDays: UPCOMING_DAYS }).catch(() => null),
    getFirmTimeZone(),
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
      ],
      banner: "Matters couldn't be loaded.",
    };
  }

  const docket = summarizeDocket(matters, period.end);

  const openMatters: Metric = { label: "Open matters", value: docket.open, sub: `${docket.waitingOn.firm} waiting on us` };

  const waitingOnFirm: Metric = { label: "Waiting on us", value: docket.waitingOn.firm, sub: "of the open docket" };

  // The firm's own calendar day. The read is bounded on the far end only, so
  // past-due rows arrive too: the KPI counts upcoming dates, and the rest is
  // split into real overdue items and old unconfirmed ones that need review.
  const today = firmCivilDate(new Date(), tz);
  const horizon = firmCivilDate(new Date(Date.now() + UPCOMING_DAYS * 86_400_000), tz);
  // listUpcomingDeadlines returns open deadlines only.
  const open = deadlines ?? [];
  const needsReview = open.filter((d) => deadlineNeedsReview(d, today));
  const overdue = open.filter((d) => d.due_date < today && !deadlineNeedsReview(d, today));
  const upcoming = open.filter((d) => d.due_date >= today && d.due_date <= horizon);

  const deadlineMetric: Metric =
    deadlines === null
      ? unavailableMetric("USPTO deadlines · 30 days", "Deadlines couldn't be loaded")
      : { label: "USPTO deadlines · 30 days", value: upcoming.length, sub: "office actions, SOUs, renewals" };

  const registered = matters.filter((m) => isInPeriod(m.registration_date, period)).length;
  const prevRegistered = matters.filter((m) => isInPreviousPeriod(m.registration_date, period)).length;
  const registrations: Metric = {
    label: "Registrations",
    value: registered,
    ...comparisonFields(registered, prevRegistered, period.range),
    sub: "marks that registered this period",
  };

  const waitingMatters = filterBySegment(matters, "firm", EMPTY_SETS);
  // Real overdue dates lead: a blown deadline is the most urgent thing here.
  const overdueItems: WaitingItem[] = oldestFirst(overdue, (d) => d.due_date, WAITING_LIMIT).map((d) => {
    const days = civilDaysBetween(d.due_date, today);
    return {
      key: `deadline-${d.id}`,
      text: `${d.title ?? deadlineKindLabel(d.kind)} · ${[d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket"}`,
      meta: `${days} ${days === 1 ? "day" : "days"} overdue`,
      cta: "Open",
      href: `/dashboard/matters/${d.matter_id}/`,
    };
  });
  const waitingItems: WaitingItem[] = oldestFirst(waitingMatters, (m) => m.stage_entered_at, WAITING_LIMIT).map((m) => ({
    key: m.id,
    text: matterLabel(m) + (m.owner_name ? ` · ${m.owner_name}` : ""),
    meta: m.stage_entered_at ? `In stage since ${relativeTime(m.stage_entered_at)}` : m.stage ? `${m.stage.code}. ${m.stage.label}` : "Not on the docket",
    cta: "Open",
    href: `/dashboard/matters/${m.id}/`,
  }));
  const waiting = [...overdueItems, ...waitingItems];

  const links: LinkTile[] = [
    { label: "All matters", sub: "The full worklist, grouped by client", href: "/dashboard/matters/", count: docket.open },
    { label: "Pipeline", sub: "Every client from intake to registration", href: "/dashboard/pipeline/", count: null },
    { label: "Documents", sub: "Filings, specimens and letters", href: "/dashboard/documents/", count: null },
    ...(needsReview.length > 0
      ? [
          {
            label: `${needsReview.length} old unconfirmed ${needsReview.length === 1 ? "deadline needs" : "deadlines need"} review`,
            sub: "Entered by hand, never confirmed, and long past due",
            href: "/dashboard/calendar/?view=agenda",
            count: needsReview.length,
          },
        ]
      : []),
  ];

  return {
    kpis: [openMatters, waitingOnFirm, deadlineMetric, registrations],
    waiting,
    links,
    banner: deadlines === null ? "Deadlines couldn't be loaded, so the 30-day figure above may be incomplete." : null,
  };
}
