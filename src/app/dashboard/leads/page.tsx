import Link from "next/link";
import { listLeads, listStages, type Lead } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { relativeTime } from "@/lib/relative-time";
import { NewLeadForm } from "@/components/leads/LeadForms";

const TEMP: Record<string, { label: string; tone: string }> = {
  hot: { label: "Hot", tone: "lx-pill-risk" },
  warm: { label: "Warm", tone: "lx-pill-warn" },
  cold: { label: "Cold", tone: "lx-pill-mute" },
};

/** The AI's lane, read off ai_summary ("HOT — reason"), when no person has set a temperature. */
function laneOf(lead: Lead): string | null {
  if (lead.temperature) return lead.temperature;
  const m = lead.ai_summary?.match(/^(HOT|WARM|COLD)\b/);
  return m ? m[1].toLowerCase() : null;
}

function lastTouch(lead: Lead): string | null {
  const a = lead.last_inbound_at ? Date.parse(lead.last_inbound_at) : 0;
  const b = lead.last_outbound_at ? Date.parse(lead.last_outbound_at) : 0;
  const t = Math.max(a, b);
  return t ? new Date(t).toISOString() : null;
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string }> }) {
  const { stage, q } = await searchParams;
  // listLeads splices the term into a PostgREST or() filter; commas and
  // parentheses there would add filter terms, so they never reach it.
  const search = (q ?? "").replace(/[,()]/g, " ").trim().slice(0, 80);

  const [stages, leads, members] = await Promise.all([
    listStages(),
    listLeads({ stageId: stage || undefined, search: search || undefined }),
    listMemberDirectory().catch(() => []),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const memberName = new Map(members.map((m) => [m.userId, m.displayName ?? m.email ?? "Teammate"]));

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Intake</div>
          <h1 className="lx-h1">Leads</h1>
          <p className="lx-sub">Everyone who has come in and not yet signed. Newest activity first; the lane is a person&apos;s call where one has been made, otherwise the triage agent&apos;s.</p>
        </div>
        <form className="lx-search-form" role="search">
          {stage && <input type="hidden" name="stage" value={stage} />}
          <input className="lx-input" name="q" defaultValue={search} placeholder="Name, business or email" aria-label="Search leads" />
        </form>
      </div>

      <nav aria-label="Stage" className="lx-chips">
        <Link href={`/dashboard/leads/${search ? `?q=${encodeURIComponent(search)}` : ""}`} aria-current={!stage ? "page" : undefined}>
          All stages
        </Link>
        {stages.map((s) => (
          <Link key={s.id} href={`/dashboard/leads/?stage=${s.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`} aria-current={stage === s.id ? "page" : undefined}>
            {s.name}
          </Link>
        ))}
      </nav>

      <details className="lx-card lx-disclosure">
        <summary>New lead</summary>
        <NewLeadForm stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
      </details>

      {leads.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {search || stage ? "No leads match" : "No leads yet"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {search || stage ? "Try a different stage or search." : "Leads from the assessment, your mailboxes and the form above land here."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th>Mark</th>
                <th>Stage</th>
                <th>Lane</th>
                <th>Last touch</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const lane = laneOf(lead);
                const touch = lastTouch(lead);
                return (
                  <tr key={lead.id}>
                    <td className="pri">
                      <Link href={`/dashboard/leads/${lead.id}/`} className="lx-rowlink">
                        {`${lead.first_name} ${lead.last_name}`.trim() || lead.email}
                      </Link>
                      {lead.business_name && <div className="lx-note">{lead.business_name}</div>}
                    </td>
                    <td className="lx-num">{lead.mark_text ?? "—"}</td>
                    <td>{stageName.get(lead.current_stage_id) ?? "—"}</td>
                    <td>{lane ? <span className={`lx-pill ${TEMP[lane].tone}`}>{TEMP[lane].label}{!lead.temperature ? " · AI" : ""}</span> : <span className="lx-note">—</span>}</td>
                    <td className="lx-num">{touch ? relativeTime(touch) : "—"}</td>
                    <td>{lead.assigned_to ? memberName.get(lead.assigned_to) ?? "Teammate" : <span className="lx-note">Unassigned</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
