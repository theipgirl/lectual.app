import Link from "next/link";
import type { ReactNode } from "react";
import { CONSULT_STATE_PILL, meetingRowHref } from "@/lib/proposals/consult-row";
import type { ConsultsStripData, ConsultRowView } from "@/lib/proposals/consults-load";
import { PROVIDER_LABEL } from "@/lib/meetings/types";
import { DraftMeetingButton } from "./DraftMeetingButton";
import { LinkLeadPicker } from "./LinkLeadPicker";
import { CONSULTS_EMPTY, CONSULTS_SECTION_TITLE, CONSULTS_UNAVAILABLE, consultsCapNote } from "@/lib/proposals/list-copy";

const MEETINGS_SETUP = "/dashboard/settings/integrations/meetings/";

function Cta({ row, canDraft, draftNote, leads }: { row: ConsultRowView; canDraft: boolean; draftNote: string | null; leads: { id: string; label: string }[] | null | undefined }) {
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
      // `leads` is undefined for a role that can't link (it opens the meeting instead), null when the list couldn't be read.
      return leads === undefined ? (
        <Link href={`/dashboard/meetings/${row.id}/`} className="lx-btn lx-btn-sec">
          Link to a lead
        </Link>
      ) : (
        <LinkLeadPicker meetingId={row.id} matterId={row.matterId} leads={leads} />
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
 * The "Consults and client meetings" section under the proposals table. Always open: a heading
 * and a scrollable box (about six rows) of consult-type meetings plus any meeting already linked
 * to a lead or matter, newest first. The row's main area is ONE link to the meeting page; the
 * quick buttons (Link to a lead, Draft the proposal) are its siblings, never inside the `<a>`,
 * so pressing one never navigates. Three states, never two: a failed read says it can't show
 * meetings, and only a read that worked and found nothing says there are none. "Paste or upload
 * a transcript" reveals the existing transcript form (`paste`, composed by the page).
 */
export function ConsultsStrip({
  data,
  canDraft,
  draftNote,
  paste,
  pasteOpen = false,
  leads,
  sync = null,
}: {
  /** The "Sync new meetings" control (or null when this role can't run an import). */
  sync?: ReactNode;
  data: ConsultsStripData;
  canDraft: boolean;
  /** Why drafting isn't available right now (no queue, no AI key, no settings), or null. */
  draftNote: string | null;
  paste: ReactNode | null;
  /** Open the transcript form on load (the page was opened for one lead with `?lead=`). */
  pasteOpen?: boolean;
  /** The leads a consult can be linked to (scoped read); null = couldn't be read; undefined = this role can't link. */
  leads?: { id: string; label: string }[] | null;
}) {
  const { header, meetings } = data;
  const head = (
    <>
      <span className="pq-dot" data-kind={header.status.kind} aria-hidden="true" />
      <span className="pq-mono" data-status={header.status.kind}>
        {header.title} · {header.status.text}
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
    <section className="lx-card pq-consults" aria-labelledby="pq-consults-title">
      <h2 id="pq-consults-title" className="lx-h2 pq-consults-h">
        {CONSULTS_SECTION_TITLE}
      </h2>
      {sync && <div className="pq-sync">{sync}</div>}
      {paste ? (
        <details className="pq-paste" open={pasteOpen || undefined}>
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
          <b>{CONSULTS_UNAVAILABLE}</b>
        </div>
      ) : meetings.rows.length === 0 ? (
        <div className="pq-consults-empty">
          <b>{CONSULTS_EMPTY}</b>
        </div>
      ) : (
        <ul className="pq-rows pq-rows-scroll">
          {meetings.rows.map((row) => {
            const pill = CONSULT_STATE_PILL[row.state];
            return (
              <li key={row.id} className="pq-row" data-state={row.state}>
                <a href={meetingRowHref(row.id)} className="pq-row-link">
                  <span className="pq-row-main">
                    <span className="pq-name">{row.title}</span>
                    <span className="pq-mono">
                      {row.whenLabel} · {PROVIDER_LABEL[row.provider]} · {row.linkedTo ? `Linked to ${row.linkedTo}` : "Not linked"}
                    </span>
                  </span>
                  <span className={`lx-pill lx-pill-${pill.tone}`}>{pill.label}</span>
                </a>
                <div className="pq-row-actions">
                  <Cta row={row} canDraft={canDraft} draftNote={draftNote} leads={leads} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {meetings.status === "ok" && meetings.more > 0 && (
        <div className="pq-more">
          {consultsCapNote(meetings.rows.length)}{" "}
          <Link href="/dashboard/meetings/">See all in Meetings</Link>
        </div>
      )}
    </section>
  );
}
