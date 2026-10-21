"use client";

import { useActionState } from "react";
import {
  acceptStageSuggestionAction,
  dismissStageSuggestionAction,
  undoAgentMoveAction,
  type StageKeeperActionState,
} from "@/app/dashboard/leads/[id]/stage-keeper-actions";
import { reasonText } from "@/lib/stage-keeper/format";
import { WHY_TEXT, type StageSuggestion } from "@/lib/stage-keeper/moves";

function Err({ state }: { state: StageKeeperActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

/** "Undo" on a Stage Keeper move in the timeline: puts the lead back where it was. */
export function UndoAgentMoveButton({ leadId, activityId }: { leadId: string; activityId: string }) {
  const [state, action, pending] = useActionState<StageKeeperActionState, FormData>(undoAgentMoveAction, {});
  return (
    <form action={action} style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="activityId" value={activityId} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Undoing…" : "Undo"}
      </button>
      <Err state={state} />
    </form>
  );
}

/**
 * One Stage Keeper suggestion waiting for a person: the stage, why it is a suggestion and the
 * evidence, with Accept and Dismiss. A suggestion the lead has moved past offers Dismiss only,
 * because accepting it would be refused.
 */
export function StageSuggestionCard({
  leadId,
  suggestion,
  currentStageId,
  canDecide,
  timeZone,
}: {
  leadId: string;
  suggestion: StageSuggestion;
  currentStageId: string | null;
  canDecide: boolean;
  timeZone: string;
}) {
  const [acceptState, accept, accepting] = useActionState<StageKeeperActionState, FormData>(acceptStageSuggestionAction, {});
  const [dismissState, dismiss, dismissing] = useActionState<StageKeeperActionState, FormData>(dismissStageSuggestionAction, {});
  const stale = currentStageId !== suggestion.fromStageId;
  const busy = accepting || dismissing;
  return (
    <div className="lx-proposal" data-suggestion={suggestion.activityId}>
      <p style={{ margin: 0, color: "var(--body)" }}>
        <b>{suggestion.toStage ?? "A later stage"}</b>
        {suggestion.fromStage ? <span className="lx-note">{` (now ${suggestion.fromStage})`}</span> : null}
      </p>
      <p className="lx-note" style={{ margin: 0 }}>{`Because ${reasonText(suggestion.evidence, timeZone)}.`}</p>
      {suggestion.why && (
        <p className="lx-note" style={{ margin: 0 }}>
          {WHY_TEXT[suggestion.why]}
        </p>
      )}
      {stale && (
        <p className="lx-note" style={{ margin: 0 }}>
          This lead has moved since, so this suggestion is out of date.
        </p>
      )}
      {canDecide && (
        <div style={{ display: "flex", gap: 8 }}>
          {!stale && (
            <form action={accept}>
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="activityId" value={suggestion.activityId} />
              <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={busy}>
                {accepting ? "Moving…" : "Accept"}
              </button>
            </form>
          )}
          <form action={dismiss}>
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="activityId" value={suggestion.activityId} />
            <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={busy}>
              {dismissing ? "Dismissing…" : "Dismiss"}
            </button>
          </form>
        </div>
      )}
      <Err state={acceptState} />
      <Err state={dismissState} />
    </div>
  );
}
