import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listLeads, listStages } from "@/lib/pipeline";
import { listIntakeLeads } from "@/lib/intake/leads";
import { loadQuotes } from "@/lib/quotes/load";
import { readRows } from "./db";
import { periodDelta, unavailableMetric, type Metric } from "./metric";
import { isInPeriod, isInPreviousPeriod, isInWindow, type ReportPeriod } from "./period";
import { isWaitingOnUs, leadLabel, waitingSince } from "./leads";
import { oldestFirst, type LinkTile, type WaitingItem } from "./waiting";
import { relativeTime } from "@/lib/relative-time";

export type IntakeReport = {
  kpis: Metric[];
  waiting: WaitingItem[];
  links: LinkTile[];
  banner: string | null;
};

/**
 * Intake: where new clients come from, how many make it from first touch to
 * a signed engagement, and who is waiting on the firm.
 */
export async function loadIntakeReport(period: ReportPeriod): Promise<IntakeReport> {
  const supabase = await getScopedClient();

  const [stages, allLeads, pnc, submissions, quotesSent] = await Promise.all([
    listStages().catch(() => null),
    listLeads().catch(() => null),
    listIntakeLeads().catch(() => null),
    readRows(() =>
      supabase.from("crm_intake_submission").select("submitted_at").gte("submitted_at", period.start.toISOString()),
    ),
    loadQuotes({ status: "sent" }),
  ]);

  // --- New leads in the period -------------------------------------------
  const newLeads: Metric = allLeads
    ? (() => {
        const current = allLeads.filter((l) => isInPeriod(l.created_at, period)).length;
        const prev = allLeads.filter((l) => isInPreviousPeriod(l.created_at, period)).length;
        return { label: "New leads", value: current, delta: periodDelta(current, prev), sub: "into the pipeline" };
      })()
    : unavailableMetric("New leads", "Leads couldn't be loaded");

  // --- Public-intake completions -------------------------------------------
  const completions: Metric =
    submissions.status === "ok"
      ? { label: "Intake completions", value: submissions.rows.filter((r) => isInPeriod(r.submitted_at, period)).length, sub: "from the public intake form" }
      : unavailableMetric(
          "Intake completions",
          submissions.status === "missing" ? "The intake-form tables aren't in this environment yet" : "Couldn't be read just now",
        );

  // --- Hired this period: leads whose CURRENT stage is a 'won' stage, --------
  // entered within the window.
  let hired: Metric;
  if (!allLeads || !stages) {
    hired = unavailableMetric("Hired this period", "Leads or stages couldn't be loaded");
  } else {
    const wonStageIds = new Set(stages.filter((s) => s.category === "won").map((s) => s.id));
    const isHiredIn = (start: Date, end: Date) =>
      allLeads.filter((l) => wonStageIds.has(l.current_stage_id) && isInWindow(l.stage_entered_at, start, end)).length;
    const current = isHiredIn(period.start, period.end);
    const prev = isHiredIn(period.prevStart, period.prevEnd);
    hired = { label: "Hired this period", value: current, delta: periodDelta(current, prev), sub: "moved to a won stage" };
  }

  // --- Waiting on us, right now (a backlog snapshot, not a period figure) ---
  const waitingLeads = pnc ? pnc.filter(isWaitingOnUs) : null;
  const waitingCount: Metric = waitingLeads
    ? { label: "Waiting on us", value: waitingLeads.length, sub: "open PNCs we haven't answered" }
    : unavailableMetric("Waiting on us", "PNC leads couldn't be loaded");

  const waiting: WaitingItem[] = waitingLeads
    ? oldestFirst(waitingLeads, waitingSince, 5).map((l) => ({
        key: l.id,
        text: leadLabel(l) + (l.mark_text ? ` · ${l.mark_text}` : ""),
        meta: `Waiting since ${relativeTime(waitingSince(l))}`,
        cta: "Open",
        href: `/dashboard/leads/${l.id}/`,
      }))
    : [];

  const links: LinkTile[] = [
    { label: "PNC", sub: "Every potential client not yet signed", href: "/dashboard/intake/", count: pnc ? pnc.length : null },
    { label: "Intake forms", sub: "Public intake and custom forms", href: "/dashboard/forms/", count: null },
    {
      label: "Quotes & proposals",
      sub: "Sent and awaiting signature",
      href: "/dashboard/quotes/",
      count: quotesSent.status === "ok" ? quotesSent.quotes.length : null,
    },
    { label: "Pipeline", sub: "Every client from intake to registration", href: "/dashboard/pipeline/", count: null },
  ];

  return {
    kpis: [newLeads, completions, hired, waitingCount],
    waiting,
    links,
    banner: !allLeads || !pnc ? "Some intake sources couldn't be loaded, so these figures may be incomplete." : null,
  };
}
