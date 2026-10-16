import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { AUTOMATION_ADMIN_ROLES, listEnrollments, listSequences, listTemplates, type DripSequence } from "@/lib/automation";
import { loadActiveQueue } from "@/lib/queue/load";
import { sequenceStatusLabel, sequenceStatusTone } from "@/lib/campaigns/steps";
import { relativeTime } from "@/lib/relative-time";
import { NewSequenceForm } from "./_components/CampaignForms";
import "./campaigns.css";

export const dynamic = "force-dynamic";

/**
 * Campaigns — nurture and follow-up sequences over crm_drip_sequence /
 * crm_drip_step / crm_drip_enrollment / crm_email_template
 * (src/lib/automation/drips.ts). Design: design/Lectual_Other_Pages.html's
 * campaignsPage()/campDrawer(), adapted to what this schema actually holds —
 * see PORTED_FROM.md for the specifics (no audience-segment field, no
 * branching "leaves when" triggers; enrollment is per-lead).
 *
 * ── EVERY SEND IS A DRAFT ────────────────────────────────────────────────────
 * The KPI band's "Held for approval" count is the SAME approval queue every
 * other agent in this app drafts into, filtered to this feature's own agent
 * name ("campaign") — never a second queue. A three-state read
 * (loadActiveQueue) backs it, so an unreachable queue renders "—" with an
 * explanation, never 0 (AGENTS.md: never render a failed read as an empty
 * list or a 0).
 *
 * ── WHO MAY BUILD A CAMPAIGN ─────────────────────────────────────────────────
 * "New campaign" only renders for AUTOMATION_ADMIN_ROLES (owner / admin /
 * senior_admin — mirrors crm_drip_sequence's `*_insert_admin` RLS policy).
 * The action re-checks this itself; the page-level check is a courtesy, not
 * the gate (AGENTS.md).
 */
export default async function CampaignsPage() {
  const role = await currentRole();
  const canManage = role !== null && AUTOMATION_ADMIN_ROLES.includes(role);

  let sequences: DripSequence[] = [];
  let activeEnrolledBySequence = new Map<string, number>();
  let totalActiveEnrolled = 0;
  let templateCount: number | null = null;
  let loadError: string | null = null;
  try {
    const [seq, enrollments, templates] = await Promise.all([
      listSequences(),
      listEnrollments(),
      listTemplates(),
    ]);
    sequences = seq;
    templateCount = templates.length;
    const counts = new Map<string, number>();
    for (const enrollment of enrollments) {
      if (enrollment.status !== "active") continue;
      counts.set(enrollment.sequence_id, (counts.get(enrollment.sequence_id) ?? 0) + 1);
      totalActiveEnrolled += 1;
    }
    activeEnrolledBySequence = counts;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Couldn't load campaigns.";
  }

  const queue = await loadActiveQueue();
  const campaignDrafts = queue.status === "ok" ? queue.items.filter((item) => item.agent === "campaign").length : null;
  const activeSequences = sequences.filter((s) => s.active).length;

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Nurture &amp; follow-up</div>
          <h1 className="lx-h1">Campaigns</h1>
          <p className="lx-sub">
            Sequences for leads who haven&apos;t signed yet, and for existing clients. Every email step drafts into
            the approval queue from the firm&apos;s own templates — nothing sends until a person approves it.
          </p>
        </div>
        <Link href="/dashboard/campaigns/templates/" className="lx-btn lx-btn-sec">
          Email templates
        </Link>
      </div>

      <div className="lx-kpis">
        <div className="lx-card lx-kpi">
          <span className="lx-label">Enrolled</span>
          <span className="lx-kpi-value">{loadError ? "—" : totalActiveEnrolled}</span>
          <span className="lx-note">
            {loadError ? "Couldn't load" : `across ${activeSequences} active campaign${activeSequences === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="lx-card lx-kpi">
          <span className="lx-label">Held for approval</span>
          <span className="lx-kpi-value">{campaignDrafts === null ? "—" : campaignDrafts}</span>
          <span className="lx-note">
            {queue.status === "ok"
              ? "campaign emails waiting for review"
              : queue.status === "unconfigured"
                ? "approvals aren't set up for this firm"
                : "couldn't reach the approval queue"}
          </span>
        </div>
        <div className="lx-card lx-kpi">
          <span className="lx-label">Campaigns</span>
          <span className="lx-kpi-value">{loadError ? "—" : sequences.length}</span>
          <span className="lx-note">
            {loadError ? "Couldn't load" : `${activeSequences} active · ${sequences.length - activeSequences} paused`}
          </span>
        </div>
        <Link href="/dashboard/campaigns/templates/" className="lx-card lx-kpi">
          <span className="lx-label">Email templates</span>
          <span className="lx-kpi-value">{templateCount === null ? "—" : templateCount}</span>
          <span className="lx-note">in the library</span>
        </Link>
      </div>

      {canManage && (
        <details className="lx-card lx-disclosure">
          <summary>New campaign</summary>
          <NewSequenceForm />
        </details>
      )}

      {loadError ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Campaigns couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            This is a problem reaching the database, not an empty list. Try again shortly.
          </p>
        </div>
      ) : sequences.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            No campaigns yet
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {canManage ? "Create one above — it starts with no steps until you add them." : "Ask a firm admin to set one up."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Enrolled</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {sequences.map((sequence) => (
                <tr key={sequence.id}>
                  <td className="pri wrap">
                    <Link href={`/dashboard/campaigns/${sequence.id}/`} className="lx-rowlink">
                      {sequence.name}
                    </Link>
                    {sequence.description && <div className="lx-note">{sequence.description}</div>}
                  </td>
                  <td>
                    <span className={`lx-pill ${sequenceStatusTone(sequence.active)}`}>{sequenceStatusLabel(sequence.active)}</span>
                  </td>
                  <td className="lx-num" style={{ textAlign: "right" }}>
                    {activeEnrolledBySequence.get(sequence.id) ?? 0}
                  </td>
                  <td className="lx-num">{relativeTime(sequence.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="lx-note lx-campaigns-firmnote">
        Attorney advertising: every email step is written from a template in the firm&apos;s own library and held for
        review before it reaches anyone. A campaign never emails or files anything on its own.
      </p>
    </>
  );
}
