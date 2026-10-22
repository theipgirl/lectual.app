import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { AGENT_DEFS, type AgentId } from "@/lib/agents/types";
import { readRows } from "./db";
import { comparisonFields, unavailableMetric, type Metric } from "./metric";
import { isInPeriod, isInPreviousPeriod, type ReportPeriod } from "./period";
import { oldestFirst, type LinkTile, type WaitingItem } from "./waiting";
import { relativeTime } from "@/lib/relative-time";
import { loadActiveQueue, type QueueLoad } from "@/lib/queue/load";

export type IposReport = {
  kpis: Metric[];
  waiting: WaitingItem[];
  links: LinkTile[];
  banner: string | null;
};

/** Only `ok` shows a number; anything else says why there isn't one. */
function waitingInQueueMetric(queue: QueueLoad): Metric {
  if (queue.status === "ok") return { label: "Waiting in queue", value: queue.items.length, sub: "drafts waiting for a person to review" };
  return unavailableMetric(
    "Waiting in queue",
    queue.status === "unconfigured" ? "No queue connected yet" : "Queue unreachable",
  );
}

/**
 * IP.OS: the firm's automation layer — AI copilot, agents, skills and the
 * firm brain. `crm_agent_proposal` is deliberately not read here: it exists
 * on lectual-dev but is neither in `src/lib/db/types.ts` nor on lectual-prod
 * yet, so per AGENTS.md this metric is dropped rather than invented.
 */
export async function loadIposReport(period: ReportPeriod, opts: { hasAgents: boolean }): Promise<IposReport> {
  const supabase = await getScopedClient();

  const [runs, settings, queue, brainCount] = await Promise.all([
    opts.hasAgents
      ? readRows(() =>
          supabase
            .from("agent_run")
            .select("agent, started_at, drafts_out, status, summary")
            .gte("started_at", period.prevStart.toISOString()),
        )
      : Promise.resolve({ status: "missing" as const, rows: [] as { agent: string; started_at: string; drafts_out: number; status: string; summary: string | null }[] }),
    opts.hasAgents
      ? readRows(() => supabase.from("agent_setting").select("agent, enabled"))
      : Promise.resolve({ status: "missing" as const, rows: [] as { agent: string; enabled: boolean }[] }),
    loadActiveQueue(),
    supabase
      .from("crm_firm_brain_entry")
      .select("id", { count: "exact", head: true })
      .then(
        (r) => (r.error ? null : r.count ?? 0),
        () => null,
      ),
  ]);

  const runsInPeriod = runs.status === "ok" ? runs.rows.filter((r) => isInPeriod(r.started_at, period)) : [];
  const prevRunsInPeriod = runs.status === "ok" ? runs.rows.filter((r) => isInPreviousPeriod(r.started_at, period)) : [];

  const runsMetric: Metric = !opts.hasAgents
    ? unavailableMetric("Agent runs", "Agents aren't turned on for this firm")
    : runs.status !== "ok"
      ? unavailableMetric("Agent runs", runs.status === "missing" ? "Agent runs aren't recorded in this environment yet" : "Couldn't be read just now")
      : { label: "Agent runs", value: runsInPeriod.length, ...comparisonFields(runsInPeriod.length, prevRunsInPeriod.length, period.range), sub: "across every agent" };

  const queueMetric = waitingInQueueMetric(queue);

  const draftsOut: Metric = !opts.hasAgents
    ? unavailableMetric("Drafts out", "Agents aren't turned on for this firm")
    : runs.status !== "ok"
      ? unavailableMetric("Drafts out", runs.status === "missing" ? "Agent runs aren't recorded in this environment yet" : "Couldn't be read just now")
      : (() => {
          const current = runsInPeriod.reduce((sum, r) => sum + (r.drafts_out ?? 0), 0);
          const prev = prevRunsInPeriod.reduce((sum, r) => sum + (r.drafts_out ?? 0), 0);
          // The queue also receives drafts from Cowork skills and staff actions;
          // say so only when it holds more than the agents wrote in the period.
          const queueHoldsMore = queue.status === "ok" && queue.items.length > current;
          return {
            label: "Drafts out",
            value: current,
            ...comparisonFields(current, prev, period.range),
            sub: queueHoldsMore
              ? "drafts written by Lectual's own agents in the period. The queue also receives drafts from Cowork skills and staff actions"
              : "drafts written by Lectual's own agents in the period",
          };
        })();

  const erroredRuns = runs.status === "ok" ? runs.rows.filter((r) => r.status === "error") : [];
  const waiting: WaitingItem[] = oldestFirst(erroredRuns, (r) => r.started_at, 5).map((r, i) => ({
    key: `${r.agent}-${r.started_at}-${i}`,
    text: `${AGENT_DEFS[r.agent as AgentId]?.name ?? r.agent} failed to run`,
    meta: `${relativeTime(r.started_at)}${r.summary ? ` · ${r.summary}` : ""}`,
    cta: "Open",
    href: "/dashboard/agents/",
  }));

  const links: LinkTile[] = [
    { label: "AI copilot", sub: "Ask the firm brain a question", href: "/dashboard/copilot/", count: null },
    ...(opts.hasAgents ? [{ label: "Agents", sub: "Scheduled automations", href: "/dashboard/agents/", count: settings.status === "ok" ? settings.rows.filter((s) => s.enabled).length : null }] : []),
    { label: "Firm brain", sub: "Voice, pricing and decisions agents draft from", href: "/dashboard/brain/", count: brainCount },
  ];

  return {
    kpis: [runsMetric, draftsOut, queueMetric],
    waiting,
    links,
    banner: null,
  };
}
