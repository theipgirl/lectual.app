import Link from "next/link";
import { currentRole } from "@/lib/auth/current-role";
import { getFirmTimeZone } from "@/lib/org/profile";
import { firmCivilDate } from "@/lib/quotes/firm-time";
import { formatCents } from "@/lib/quotes/money";
import { formatShortFirmDate } from "@/lib/quotes/labels";
import { relativeTime } from "@/lib/relative-time";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { listProposals, type ProposalListItem } from "@/lib/proposals/store";
import { PROPOSAL_ADMIN_ROLES, PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import {
  PROPOSAL_DISPLAY_KEYS,
  PROPOSAL_DISPLAY_LABEL,
  parseDisplayFilter,
  proposalDisplayStatus,
  proposalDisplayTone,
} from "@/lib/proposals/display-status";
import { loadLeadOptions } from "@/lib/proposals/lead-options";
import { loadDraftBlock } from "@/lib/consult-proposal/draft-gate";
import { DRAFT_BLOCK_NOTE } from "@/lib/consult-proposal/draft-availability";
import { MAX_PASTED_TRANSCRIPT_CHARS } from "@/lib/consult-proposal/types";
import { TranscriptDraft } from "@/components/proposal-editor/TranscriptDraft";
import { requireProposalsModule } from "./gate";
import "./proposals.css";

export const dynamic = "force-dynamic";

/**
 * Client proposals — one row per client offer (its newest version), over a
 * three-state read: rows, empty, or "couldn't load". An unreachable database
 * never renders as "No proposals yet".
 *
 * The statuses are the ones the firm uses (Draft / Sent / Accepted / Expired /
 * Blocked, Closed under All), derived by `proposalDisplayStatus` from the stored
 * status, the expiry date and the rule breaks that would block approval. Chip
 * counts come from the unfiltered set. `?status=` takes the display keys; an
 * older stored value (approved, withdrawn, superseded) is mapped onto them.
 *
 * Gate: the `proposals` module (notFound when off, so one firm cannot learn
 * what another has). Reading is for the whole firm (0089's select policy is
 * org members); starting a proposal is for the staff roles, and the action
 * re-checks that.
 */
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireProposalsModule();
  const { status: statusRaw } = await searchParams;
  const status = parseDisplayFilter(statusRaw);

  const role = await currentRole();
  const canWrite = !!role && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
  const canDraftFromTranscript = canWrite && CAN_WRITE_LEAD.includes(role);

  let listed: ProposalListItem[] = [];
  let failed = false;
  try {
    listed = await listProposals();
  } catch {
    failed = true;
  }
  const today = firmCivilDate(new Date(), await getFirmTimeZone());
  const all = listed.map((r) => ({ row: r, display: proposalDisplayStatus(r, { today, issues: r.blocking_issue }) }));
  const rows = status ? all.filter((r) => r.display.key === status) : all;
  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.display.key, (counts.get(r.display.key) ?? 0) + 1);

  const [leadsRead, draftBlock] = canDraftFromTranscript ? await Promise.all([loadLeadOptions(), loadDraftBlock()]) : [null, null];

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

      {canDraftFromTranscript && (
        <details className="lx-card lx-disclosure">
          <summary>Draft from a transcript</summary>
          <div style={{ padding: "12px 18px 18px" }}>
            {draftBlock ? (
              <p className="lx-note" style={{ margin: 0 }} data-draft-block={draftBlock}>
                {DRAFT_BLOCK_NOTE[draftBlock]}
                {draftBlock === "no-settings" && (
                  <>
                    {" "}
                    <Link href="/dashboard/settings/proposals/">Open the settings</Link>
                  </>
                )}
              </p>
            ) : leadsRead?.status === "ok" ? (
              <TranscriptDraft leads={leadsRead.leads} maxChars={MAX_PASTED_TRANSCRIPT_CHARS} />
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>
                The leads couldn&apos;t be loaded just now, so this form isn&apos;t offered. This is a problem reaching the database, not an empty list. Try again shortly.
              </p>
            )}
          </div>
        </details>
      )}

      {!failed && all.length > 0 && (
        <nav aria-label="Filter proposals by status" className="lx-chips">
          <Link href="/dashboard/proposals/" aria-current={!status ? "page" : undefined}>
            All
            <span className="lx-chip-count">{all.length}</span>
          </Link>
          {PROPOSAL_DISPLAY_KEYS.map((key) => {
            const count = counts.get(key) ?? 0;
            // Closed is listed under All; it is a chip only while you are on it.
            if (key === "closed" ? status !== "closed" : count === 0 && status !== key) return null;
            return (
              <Link key={key} href={`/dashboard/proposals/?status=${key}`} aria-current={status === key ? "page" : undefined}>
                {PROPOSAL_DISPLAY_LABEL[key]}
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
              {rows.map(({ row: r, display }) => (
                <tr key={r.id}>
                  <td className="pri wrap">
                    <Link href={`/dashboard/proposals/${r.id}/`} className="lx-rowlink">
                      {r.client_name}
                    </Link>
                    <div className="lx-note">{r.title}</div>
                  </td>
                  <td className="lx-num">v{r.version}</td>
                  <td>
                    <span className={`lx-pill lx-pill-${proposalDisplayTone(display.key)}`}>{display.label}</span>
                    {display.sub && <div className="lx-note">{display.sub}</div>}
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
