import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { formatCents } from "@/lib/quotes/money";
import { formatShortFirmDate } from "@/lib/quotes/labels";
import { relativeTime } from "@/lib/relative-time";
import { listProposals, type ProposalListItem } from "@/lib/proposals/store";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STATUSES, PROPOSAL_STAFF_WRITE_ROLES, isProposalStatus } from "@/lib/proposals/types";
import { statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { requireProposalsModule } from "./gate";
import "./proposals.css";

export const dynamic = "force-dynamic";

/**
 * Client proposals — one row per client offer (its newest version), over a
 * three-state read: rows, empty, or "couldn't load". An unreachable database
 * never renders as "No proposals yet".
 *
 * Gate: the `proposals` module (notFound when off, so one firm cannot learn
 * what another has). Reading is for the whole firm (0089's select policy is
 * org members); starting a proposal is for the staff roles, and the action
 * re-checks that.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireProposalsModule();
  const { status: statusRaw } = await searchParams;
  const status = isProposalStatus(statusRaw) ? statusRaw : undefined;

  const role = await currentRole();
  const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);

  let all: ProposalListItem[] = [];
  let failed = false;
  try {
    all = await listProposals();
  } catch {
    failed = true;
  }
  const rows = status ? all.filter((r) => r.status === status) : all;
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Intake</div>
          <h1 className="lx-h1">Client proposals</h1>
          <p className="lx-sub">
            The page a client reviews and accepts after their strategy call. Only a named approver can approve one, and nothing
            reaches a client until it is marked as sent. Legal fees and USPTO fees are always shown separately.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {role && PROPOSAL_ADMIN_ROLES.includes(role) && (
            <Link href="/dashboard/settings/proposals/" className="lx-btn lx-btn-sec">
              Settings
            </Link>
          )}
          {canWrite && (
            <Link href="/dashboard/proposals/new/" className="lx-btn lx-btn-pri">
              New proposal
            </Link>
          )}
        </div>
      </div>

      {!failed && all.length > 0 && (
        <nav aria-label="Filter proposals by status" className="lx-chips">
          <Link href="/dashboard/proposals/" aria-current={!status ? "page" : undefined}>
            All
            <span className="lx-chip-count">{all.length}</span>
          </Link>
          {PROPOSAL_STATUSES.map((s) => {
            const count = counts.get(s) ?? 0;
            if (count === 0 && status !== s) return null;
            return (
              <Link key={s} href={`/dashboard/proposals/?status=${s}`} aria-current={status === s ? "page" : undefined}>
                {statusLabel(s)}
                <span className="lx-chip-count">{count}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {failed ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            Proposals couldn&apos;t be loaded
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            This is a problem reaching the database, not an empty list. Try again shortly.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>
            {all.length === 0 ? "No proposals yet" : "Nothing matches"}
          </h2>
          <p className="lx-note" style={{ margin: 0 }}>
            {all.length === 0
              ? canWrite
                ? "Start one from a lead, or with New proposal. It stays a draft until a named approver approves it."
                : "When one is started it will be listed here."
              : "Every proposal is still here. Try another filter."}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Version</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Legal fee</th>
                <th style={{ textAlign: "right" }}>USPTO fees</th>
                <th>Expires</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="pri wrap">
                    <Link href={`/dashboard/proposals/${r.id}/`} className="lx-rowlink">
                      {r.client_name}
                    </Link>
                    <div className="lx-note">{r.title}</div>
                  </td>
                  <td className="lx-num">v{r.version}</td>
                  <td>
                    <span className={`lx-pill lx-pill-${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="lx-num" style={{ textAlign: "right" }}>
                    {formatCents(r.legal_total_cents)}
                  </td>
                  <td className="lx-num" style={{ textAlign: "right" }}>
                    {formatCents(r.gov_total_cents)}
                  </td>
                  <td className="lx-num">{r.expires_on ? formatShortFirmDate(`${r.expires_on}T12:00:00Z`, "UTC") : <span className="lx-note">—</span>}</td>
                  <td className="lx-num">{relativeTime(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!failed && rows.length > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          Fees are for the offer as first shown (what is pre-ticked); once accepted, the amounts the client chose.
        </p>
      )}
    </>
  );
}
