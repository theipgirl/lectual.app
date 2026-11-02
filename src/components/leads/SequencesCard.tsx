"use client";

import Link from "next/link";
import { useActionState } from "react";
import { stopLeadSequenceAction, type LeadSequenceState } from "@/app/dashboard/leads/[id]/sequence-actions";
import { MANUAL_STOP_REASONS, STOP_REASON_LABEL } from "@/lib/campaigns/stops";

export type SequenceRow = {
  id: string;
  sequenceId: string;
  sequenceName: string | null;
  status: string;
  statusLabel: string;
  statusTone: string;
  step: string;
  /** "Campaign stopped — signed quote, Oct 3" for a stopped row. */
  stopLine: string | null;
};

const MANUAL_LABEL: Record<string, string> = {
  manual: "Other / no reason",
  unsubscribed: "They asked us to stop",
  booked: "They booked a call",
  replied: "They replied (outside the synced inbox)",
};

function StopForm({ leadId, enrollmentId }: { leadId: string; enrollmentId: string }) {
  const [state, action, pending] = useActionState<LeadSequenceState, FormData>(stopLeadSequenceAction, {});
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <select className="lx-input" name="reason" defaultValue="manual" aria-label="Why stop this campaign" style={{ width: "auto", paddingBlock: 4, paddingLeft: 8 }}>
        {MANUAL_STOP_REASONS.map((r) => (
          <option key={r} value={r}>
            {MANUAL_LABEL[r] ?? STOP_REASON_LABEL[r]}
          </option>
        ))}
      </select>
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Stopping…" : "Stop campaign"}
      </button>
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)", flexBasis: "100%" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * The lead's campaign enrollments (intake SOP rule 1): which sequences are
 * running, and for any that stopped, WHY — "Campaign stopped — signed quote,
 * Oct 3" — read from the recorded stop, never re-derived. A person can stop a
 * running one by hand and say why; it's recorded with their name and is final.
 */
export function SequencesCard(props: { leadId: string; rows: SequenceRow[] | null; canOperate: boolean }) {
  const { leadId, rows } = props;
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }} aria-labelledby="sequences-heading">
      <h2 id="sequences-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
        Campaigns
      </h2>
      {rows === null ? (
        <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
          Couldn&apos;t load this lead&apos;s campaigns. That isn&apos;t the same as none — try again shortly.
        </p>
      ) : rows.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          Not in any campaign.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link href={`/dashboard/campaigns/${r.sequenceId}/`} style={{ fontWeight: 500, color: "var(--ink)" }}>
                  {r.sequenceName ?? "Campaign"}
                </Link>
                <span className={`lx-pill ${r.statusTone}`}>{r.statusLabel}</span>
                <span className="lx-note">{r.step}</span>
              </div>
              {r.stopLine && (
                <p className="lx-note" style={{ margin: 0, color: "var(--ink)" }} data-testid="sequence-stop-line">
                  {r.stopLine}
                </p>
              )}
              {props.canOperate && (r.status === "active" || r.status === "paused") && <StopForm leadId={leadId} enrollmentId={r.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
