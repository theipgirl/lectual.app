import Link from "next/link";
import type { ReactNode } from "react";
import { CONSULT_STATE_PILL, CONSULT_WINDOW_DAYS } from "@/lib/proposals/consult-row";
import type { ConsultsStripData, ConsultRowView } from "@/lib/proposals/consults-load";
import { DraftMeetingButton } from "./DraftMeetingButton";

const MEETINGS_SETUP = "/dashboard/settings/integrations/meetings/";

function Cta({ row, canDraft, draftNote }: { row: ConsultRowView; canDraft: boolean; draftNote: string | null }) {
  switch (row.state) {
    case "drafted": {
      const href = row.proposalId ? `/dashboard/proposals/${row.proposalId}/` : row.leadId ? `/dashboard/leads/${row.leadId}/` : `/dashboard/meetings/${row.id}/`;
      return (
        <Link href={href} className="lx-btn lx-btn-sec">
          Open the draft
        </Link>
      );
    }
    case "unlinked":
      return (
        <Link href={`/dashboard/meetings/${row.id}/`} className="lx-btn lx-btn-sec">
          Link a lead first
        </Link>
      );
    case "transcribing":
      return (
        <button type="button" className="lx-btn lx-btn-sec" disabled>
          Not ready
        </button>
      );
    default:
      if (!canDraft) return null;
      return draftNote ? (
        <button type="button" className="lx-btn lx-btn-pri" disabled title={draftNote}>
          Draft the proposal
        </button>
      ) : (
        <DraftMeetingButton meetingId={row.id} />
      );
  }
}

/**
 * The top card of the proposals page: recent Zoom / Fathom consults and what can be done with
 * each. The header says which provider and whether it is connected; "Paste or upload a
 * transcript" reveals the existing transcript form below it (`paste`, composed by the page,
 * or null when the role can't draft). Three states, never two: a failed meetings read says
 * "Couldn't load consults", and only a read that worked and found nothing says there were none.
 */
export function ConsultsStrip({
  data,
  canDraft,
  draftNote,
  paste,
}: {
  data: ConsultsStripData;
  canDraft: boolean;
  /** Why drafting isn't available right now (no queue, no AI key, no settings), or null. */
  draftNote: string | null;
  paste: ReactNode | null;
}) {
  const { header, meetings } = data;
  const head = (
    <>
      <span className="pq-dot" data-kind={header.status.kind} aria-hidden="true" />
      <span className="pq-consults-title">{header.title}</span>
      <span className="pq-mono" data-status={header.status.kind}>
        {header.status.text}
      </span>
      {header.status.kind === "none" && (
        <Link href={MEETINGS_SETUP} className="pq-mono">
          Connect Zoom or Fathom
        </Link>
      )}
      {header.status.kind === "reauth" && (
        <Link href={MEETINGS_SETUP} className="pq-mono">
          Reconnect
        </Link>
      )}
    </>
  );

  return (
    <section className="lx-card pq-consults" aria-label="Recent consults">
      {paste ? (
        <details className="pq-paste">
          <summary className="pq-consults-head">
            {head}
            <span className="lx-btn lx-btn-sec lx-btn-sm pq-paste-btn">Paste or upload a transcript</span>
          </summary>
          <div className="pq-paste-body">{paste}</div>
        </details>
      ) : (
        <div className="pq-consults-head">{head}</div>
      )}

      {meetings.status === "unavailable" ? (
        <div className="pq-consults-empty" role="status">
          <b>Couldn&apos;t load consults</b>
          <span className="lx-note">This is a problem reaching the database, not an empty list. Try again shortly.</span>
        </div>
      ) : meetings.rows.length === 0 ? (
        <div className="pq-consults-empty">
          <b>No consults in the last {CONSULT_WINDOW_DAYS} days</b>
        </div>
      ) : (
        <ul className="pq-rows">
          {meetings.rows.map((row) => {
            const pill = CONSULT_STATE_PILL[row.state];
            return (
              <li key={row.id} className="pq-row" data-state={row.state}>
                <div className="pq-row-main">
                  <div>
                    <span className="pq-name">{row.clientName}</span>
                    {row.company && <span className="pq-co">{row.company}</span>}
                  </div>
                  <div className="pq-mono">{row.line}</div>
                </div>
                <span className={`lx-pill lx-pill-${pill.tone}`}>{pill.label}</span>
                <Cta row={row} canDraft={canDraft} draftNote={draftNote} />
              </li>
            );
          })}
        </ul>
      )}
      {meetings.status === "ok" && meetings.more > 0 && (
        <div className="pq-more">
          <Link href="/dashboard/meetings/">{meetings.more} more</Link>
        </div>
      )}
    </section>
  );
}
