import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listLeads } from "@/lib/pipeline";
import { loadActiveQueue } from "@/lib/queue/load";
import { readRows } from "./db";
import { periodDelta, unavailableMetric, type Metric } from "./metric";
import { isInPeriod, isInPreviousPeriod, type ReportPeriod } from "./period";
import { isWaitingOnUs, leadLabel, waitingSince } from "./leads";
import { oldestFirst, type LinkTile, type WaitingItem } from "./waiting";
import { relativeTime } from "@/lib/relative-time";

export type CommunicationReport = {
  kpis: Metric[];
  waiting: WaitingItem[];
  links: LinkTile[];
  banner: string | null;
};

/**
 * Communication: intake@, My Mail, Campaigns and SMS as one view — how fast
 * the firm answers and who is still waiting on a reply. Every source is read
 * independently; one dead source degrades its own tile, never the page.
 */
export async function loadCommunicationReport(
  period: ReportPeriod,
  opts: { hasMailbox: boolean; hasAgents: boolean },
): Promise<CommunicationReport> {
  const supabase = await getScopedClient();

  const [activity, leads, queue, drips, runs] = await Promise.all([
    readRows(() =>
      supabase
        .from("crm_activity")
        .select("type, created_at")
        .in("type", ["email_received", "email_sent"])
        .gte("created_at", period.prevStart.toISOString()),
    ),
    listLeads().catch(() => null),
    loadActiveQueue(),
    readRows(() => supabase.from("crm_drip_enrollment").select("id").eq("status", "active")),
    opts.hasAgents
      ? readRows(() => supabase.from("agent_run").select("started_at, drafts_out").gte("started_at", period.prevStart.toISOString()))
      : Promise.resolve({ status: "missing" as const, rows: [] as { started_at: string; drafts_out: number }[] }),
  ]);

  // --- Emails received/sent ------------------------------------------------
  let emails: Metric;
  if (activity.status !== "ok") {
    emails = unavailableMetric(
      "Emails",
      activity.status === "missing" ? "Activity isn't recorded in this environment yet" : "Couldn't be read just now",
    );
  } else {
    const received = activity.rows.filter((r) => r.type === "email_received" && isInPeriod(r.created_at, period)).length;
    const sent = activity.rows.filter((r) => r.type === "email_sent" && isInPeriod(r.created_at, period)).length;
    const prevReceived = activity.rows.filter((r) => r.type === "email_received" && isInPreviousPeriod(r.created_at, period)).length;
    const prevSent = activity.rows.filter((r) => r.type === "email_sent" && isInPreviousPeriod(r.created_at, period)).length;
    emails = {
      label: "Emails",
      value: received + sent,
      delta: periodDelta(received + sent, prevReceived + prevSent),
      sub: `${received} received · ${sent} sent`,
    };
  }

  // --- Queue waiting ---------------------------------------------------------
  let queueMetric: Metric;
  if (queue.status === "ok") {
    queueMetric = { label: "Queue waiting", value: queue.items.length, sub: "drafts held for approval" };
  } else if (queue.status === "unconfigured") {
    queueMetric = unavailableMetric(
      "Queue waiting",
      queue.reason === "org-key" ? "No queue connected for this firm" : "The queue isn't configured for this deployment",
    );
  } else {
    queueMetric = unavailableMetric("Queue waiting", "The approval queue can't be reached right now");
  }

  // --- Agent drafts ------------------------------------------------------
  let draftsOut: Metric;
  if (!opts.hasAgents) {
    draftsOut = unavailableMetric("Agent drafts", "Agents aren't turned on for this firm");
  } else if (runs.status !== "ok") {
    draftsOut = unavailableMetric(
      "Agent drafts",
      runs.status === "missing" ? "Agent runs aren't recorded in this environment yet" : "Couldn't be read just now",
    );
  } else {
    const current = runs.rows.filter((r) => isInPeriod(r.started_at, period)).reduce((sum, r) => sum + (r.drafts_out ?? 0), 0);
    const prev = runs.rows.filter((r) => isInPreviousPeriod(r.started_at, period)).reduce((sum, r) => sum + (r.drafts_out ?? 0), 0);
    draftsOut = { label: "Agent drafts", value: current, delta: periodDelta(current, prev), sub: "written by agents, held for approval" };
  }

  // --- Active sequences (a snapshot, not a period aggregate) ---------------
  const sequences: Metric =
    drips.status === "ok"
      ? { label: "Sequences running", value: drips.rows.length, sub: "nurture and follow-up, right now" }
      : unavailableMetric(
          "Sequences running",
          drips.status === "missing" ? "Sequences aren't recorded in this environment yet" : "Couldn't be read just now",
        );

  // --- Waiting on the firm: leads we haven't answered ------------------------
  const waiting: WaitingItem[] = leads
    ? oldestFirst(leads.filter(isWaitingOnUs), waitingSince, 5).map((l) => ({
        key: l.id,
        text: leadLabel(l) + (l.mark_text ? ` · ${l.mark_text}` : ""),
        meta: `Waiting since ${relativeTime(waitingSince(l))}`,
        cta: "Open",
        href: `/dashboard/leads/${l.id}/`,
      }))
    : [];

  const links: LinkTile[] = [
    ...(opts.hasMailbox ? [{ label: "My Mail", sub: "Your Outlook or Gmail inbox", href: "/dashboard/mail/", count: null }] : []),
    { label: "Queue", sub: "Agent-triaged intake and drafts to approve", href: "/dashboard/queue/", count: queue.status === "ok" ? queue.items.length : null },
    { label: "Campaigns", sub: "Nurture and follow-up sequences", href: "/dashboard/campaigns/", count: drips.status === "ok" ? drips.rows.length : null },
    { label: "SMS", sub: "Text conversations", href: "/dashboard/sms/", count: null },
  ];

  return {
    kpis: [emails, queueMetric, draftsOut, sequences],
    waiting,
    links,
    banner: leads === null ? "Leads couldn't be loaded, so “Waiting on the firm” may be incomplete." : null,
  };
}
