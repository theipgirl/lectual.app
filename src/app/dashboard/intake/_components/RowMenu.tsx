"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { RunningSummary } from "@/lib/time";
import { memberLabel, stageLabelFor } from "@/lib/intake/views";
import { addManualTimeAction, startTimerAction, stopTimerAction } from "../time-actions";
import TimeEntryDialog, { type TimeEntrySubmit } from "@/components/intake/TimeEntryDialog";
import Popover, { PopoverItem } from "./Popover";
import { LEADS_ADD_TIME, LEADS_ROW_MENU, LEADS_START_TIMER, LEADS_STOP_TIMER } from "@/lib/ui/words";

/**
 * The "…" on a list row and a board card: the ONE place the small per-lead actions live, with words (no unlabeled mini
 * buttons). Move to stage (the keyboard route for a drag), Assign to (the board's keyboard route for the owner drag; also
 * the row's Assign, since the Owner column is hidden when nobody is assigned), and the time actions (Start timer, Stop
 * timer, Add time; the ⏱ chip itself only shows when there is time this week or a running timer).
 *
 * It is a real Popover: Tab reaches it, Enter opens it, Escape closes it and returns focus.
 */
export default function RowMenu({
  lead,
  name,
  stages,
  members,
  running,
  showMove = true,
  onMoveStage,
  onAssign,
}: {
  lead: { id: string; current_stage_id: string; assigned_to: string | null };
  name: string;
  stages: Stage[];
  members: MemberIdentity[];
  /** The caller's own open timer, wherever it is. */
  running: RunningSummary | null;
  showMove?: boolean;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"stop" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningHere = running?.leadId === lead.id ? running : null;
  const runningElsewhere = running && !runningHere;
  const unknownAssignee = lead.assigned_to != null && !members.some((m) => m.userId === lead.assigned_to);

  function run(act: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await act();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      router.refresh();
    });
  }

  function submit(input: TimeEntrySubmit) {
    if (dialog === "stop") {
      if (runningHere) run(() => stopTimerAction(runningHere.entryId, input.note, lead.id));
      return;
    }
    run(() => addManualTimeAction(lead.id, input.seconds ?? 0, input.note, input.atIso));
  }

  return (
    <span role="presentation" onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
      <Popover
        label={LEADS_ROW_MENU(name)}
        align="right"
        width={220}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} className="ix-icon-btn" disabled={pending}>
            <span aria-hidden>…</span>
          </button>
        )}
      >
        {(close) => (
          <div className="ix-menu-scroll">
            {showMove && (
              <>
                <span className="ix-menu-h">Move to stage</span>
                {stages.map((stage) => (
                  <PopoverItem
                    key={stage.id}
                    checked={lead.current_stage_id === stage.id}
                    onSelect={() => {
                      close();
                      if (lead.current_stage_id !== stage.id) onMoveStage(lead.id, stage.id);
                    }}
                  >
                    {stageLabelFor(stage)}
                  </PopoverItem>
                ))}
              </>
            )}
            <span className="ix-menu-h">Assign to</span>
            <PopoverItem
              muted
              checked={lead.assigned_to == null}
              onSelect={() => {
                close();
                if (lead.assigned_to != null) onAssign(lead.id, null);
              }}
            >
              Unassigned
            </PopoverItem>
            {unknownAssignee && (
              <PopoverItem checked onSelect={close}>
                Unknown teammate
              </PopoverItem>
            )}
            {members.map((member) => (
              <PopoverItem
                key={member.userId}
                checked={lead.assigned_to === member.userId}
                onSelect={() => {
                  close();
                  if (lead.assigned_to !== member.userId) onAssign(lead.id, member.userId);
                }}
              >
                {memberLabel(member)}
              </PopoverItem>
            ))}
            <span className="ix-menu-h">Time</span>
            {runningHere ? (
              <PopoverItem
                onSelect={() => {
                  close();
                  setDialog("stop");
                }}
              >
                {LEADS_STOP_TIMER}
              </PopoverItem>
            ) : runningElsewhere ? (
              <span className="ix-sub" style={{ padding: "4px 8px", whiteSpace: "normal" }}>
                A timer is already running on {running?.leadName ?? "another lead"}. Stop it first.
              </span>
            ) : (
              <PopoverItem
                onSelect={() => {
                  close();
                  run(() => startTimerAction(lead.id));
                }}
              >
                {LEADS_START_TIMER}
              </PopoverItem>
            )}
            <PopoverItem
              onSelect={() => {
                close();
                setDialog("manual");
              }}
            >
              {LEADS_ADD_TIME}
            </PopoverItem>
          </div>
        )}
      </Popover>
      {error && !dialog && (
        <span role="status" className="ix-sub" style={{ color: "var(--crit)", marginLeft: 6 }} title={error}>
          {error}
        </span>
      )}
      {dialog && (
        <TimeEntryDialog
          mode={dialog}
          leadName={name}
          pending={pending}
          error={error}
          onCancel={() => {
            setDialog(null);
            setError(null);
          }}
          onSubmit={submit}
        />
      )}
    </span>
  );
}
