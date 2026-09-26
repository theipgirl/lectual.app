import { notFound } from "next/navigation";
import { hasRole } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { aiConfigured } from "@/lib/ai/claude";
import { AGENT_DEFS, AGENT_IDS, type AgentId, type Autonomy } from "@/lib/agents/types";
import { relativeTime } from "@/lib/relative-time";
import { AgentControls } from "@/components/agents/AgentControls";

// "Run now" executes inside the page's server action.
export const maxDuration = 300;

type RunRow = {
  id: string;
  agent: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_in: number;
  drafts_out: number;
  summary: string | null;
  error: string | null;
};

const RUN_AGENT_LABEL: Record<string, string> = {
  ...Object.fromEntries(AGENT_IDS.map((a) => [a, AGENT_DEFS[a].name])),
  "mailbox-sync": "Mailbox sync",
};
const TRIGGER_LABEL: Record<string, string> = { cron: "Scheduled", manual: "Run now", webhook: "Webhook", event: "Event" };
const STATUS_TONE: Record<string, string> = { ok: "#43602F", skipped: "#7C5312", error: "#8E2733", running: "#7A5A5E" };

function duration(r: RunRow): string {
  if (!r.finished_at) return "running";
  const s = Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function AgentsPage() {
  if (!(await orgHasModule("agents"))) notFound();
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const canManage = hasRole(session.role, "senior_admin");

  // Both reads go through RLS: the firm's own settings and its own run log.
  const supabase = await getScopedClient();
  const [{ data: settingRows }, { data: runRows, error: runsError }] = await Promise.all([
    supabase.from("agent_setting").select("agent, enabled, autonomy"),
    supabase
      .from("agent_run")
      .select("id, agent, trigger, status, started_at, finished_at, items_in, drafts_out, summary, error")
      .order("started_at", { ascending: false })
      .limit(25),
  ]);
  const settings = new Map((settingRows ?? []).map((s) => [s.agent as AgentId, s]));
  const runs = (runRows ?? []) as RunRow[];
  const lastRun = (agent: AgentId) => runs.find((r) => r.agent === agent);
  const onCount = AGENT_IDS.filter((a) => settings.get(a)?.enabled).length;

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">IP.OS</div>
          <h1 className="lx-h1">Agents</h1>
          <p className="lx-sub">
            Each agent reads one source and writes one kind of thing. Anything addressed to a client
            goes into the approval queue, so switching an agent on can never put a word in front of a
            client.
          </p>
        </div>
        <div className="lx-note">
          {onCount} of {AGENT_IDS.length} on
        </div>
      </div>

      {!aiConfigured() && (
        <div className="lx-banner lx-banner-mute">
          The AI key isn&apos;t set on this deployment, so agents won&apos;t run until an
          administrator adds it.
        </div>
      )}

      <div className="lx-agrid">
        {AGENT_IDS.map((agent) => {
          const def = AGENT_DEFS[agent];
          const s = settings.get(agent);
          const enabled = Boolean(s?.enabled);
          const autonomy = (s?.autonomy as Autonomy | undefined) ?? def.defaultAutonomy;
          const last = lastRun(agent);
          return (
            <section key={agent} className={`lx-card lx-agent${enabled ? "" : " off"}`}>
              <AgentControls agent={agent} name={def.name} enabled={enabled} autonomy={autonomy} canManage={canManage} />
              <div className="lx-agent-head">
                <div style={{ fontSize: 17, fontWeight: 600 }}>{def.name}</div>
                <div className="lx-label" style={{ fontSize: 11, marginTop: 4 }}>
                  Reads · {def.reads}
                </div>
              </div>
              <p className="lx-agent-desc">{def.description}</p>
              <div className="lx-agent-foot">
                <span className="lx-note" style={{ flex: 1 }}>
                  {!enabled ? "Off" : last ? `Ran ${relativeTime(last.started_at)}` : "On · not run yet"}
                </span>
                {enabled && last && (
                  <span className={`lx-pill ${last.status === "error" ? "lx-pill-risk" : last.drafts_out ? "lx-pill-warn" : "lx-pill-ok"}`}>
                    {last.status === "error" ? "Failed" : last.drafts_out ? `${last.drafts_out} held` : `${last.items_in} read`}
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="lx-card" style={{ overflow: "auto" }}>
        <div className="lx-card-head" style={{ alignItems: "center" }}>
          <h2 className="lx-h2" style={{ fontSize: 23, flex: 1 }}>
            Recent runs
          </h2>
          <span className="lx-note">Every run is logged for the firm</span>
        </div>
        {runsError ? (
          <div className="lx-empty" role="alert">
            We couldn&apos;t load the run log.
          </div>
        ) : runs.length === 0 ? (
          <div className="lx-empty">No runs yet.</div>
        ) : (
          <table className="lx-tbl">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Trigger</th>
                <th>Result</th>
                <th>When</th>
                <th aria-label="Status" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="pri">{RUN_AGENT_LABEL[r.agent] ?? r.agent}</td>
                  <td>{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                  <td className="wrap" style={r.status === "error" ? { color: "var(--wine)" } : undefined}>
                    {r.status === "error" ? r.error ?? "Failed" : r.summary ?? "—"}
                  </td>
                  <td className="lx-num">
                    {relativeTime(r.started_at)} <span className="lx-note">· {duration(r)}</span>
                  </td>
                  <td>
                    <span className="lx-dot" style={{ background: STATUS_TONE[r.status] ?? "#7A5A5E" }} title={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="lx-upl">
        <span aria-hidden="true">§</span>
        <div>
          <b style={{ color: "var(--ox)" }}>The one rule.</b> No agent can send to a client. The
          approval queue is the only way anything leaves this firm. Agents never answer a legal
          question; they route it to the attorney.
        </div>
      </div>
    </>
  );
}
