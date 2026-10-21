import { relativeTime } from "@/lib/relative-time";
import { describeActivity } from "@/components/leads/describe";
import { UndoAgentMoveButton } from "@/components/leads/StageKeeperControls";
import { isAgentMoveRow, undoStateFor } from "@/lib/stage-keeper/moves";

type Row = { id: string; type: string; actor_type: string | null; created_at: string; payload: unknown };

/** What the lead page tells the timeline so a Stage Keeper move can offer Undo. */
export type TimelineUndo = {
  leadId: string;
  /** The viewer's role may move stages (the same list `moveLeadStage` enforces). */
  canMove: boolean;
  /** Where the lead is now: Undo is offered only while it is still where the agent put it. */
  currentStageId: string | null;
};

/**
 * A record's activity timeline (lead or matter). Voice notes play from a
 * short-lived signed URL the page minted through the caller's own scoped
 * client (voiceNotePlaybackUrls); a note whose URL couldn't be minted still
 * shows its transcript.
 *
 * On a lead, a move by the Stage Keeper carries an Undo button for a person who may move stages,
 * while the lead is still where the agent put it and the move hasn't been undone. Otherwise the
 * line stands without the button (or says "Undone").
 */
export function Timeline({
  rows,
  mediaUrls = {},
  timeZone,
  undo,
}: {
  rows: readonly Row[];
  mediaUrls?: Record<string, string>;
  timeZone?: string;
  undo?: TimelineUndo;
}) {
  if (rows.length === 0) return <p className="lx-note">Nothing yet.</p>;
  return (
    <ol className="lx-timeline">
      {rows.slice(0, 100).map((r) => {
        const d = describeActivity(r, { timeZone });
        const audio = mediaUrls[r.id];
        const undoState = undo && isAgentMoveRow(r) ? undoStateFor(rows, r.id, undo.currentStageId) : null;
        return (
          <li key={r.id} data-tone={d.tone}>
            <div className="lx-timeline-head">
              <span>{d.title}</span>
              <span className="lx-note">{relativeTime(r.created_at)}</span>
            </div>
            {audio && <audio controls preload="none" src={audio} aria-label="Voice note" style={{ width: "100%", height: 34, marginTop: 6 }} />}
            {d.detail && <p>{d.detail}</p>}
            {d.link && (
              <a href={d.link} target="_blank" rel="noreferrer noopener" className="lx-note">
                Open in mail
              </a>
            )}
            {undo && undoState === "available" && undo.canMove && <UndoAgentMoveButton leadId={undo.leadId} activityId={r.id} />}
            {undoState === "undone" && <p className="lx-note">Undone</p>}
          </li>
        );
      })}
    </ol>
  );
}
