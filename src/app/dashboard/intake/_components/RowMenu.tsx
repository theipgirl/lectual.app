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
import { RECORD_CARD_MENU_OPEN, LEADS_ADD_TIME, LEADS_ROW_MENU, LEADS_START_TIMER, LEADS_STOP_TIMER, OWNER_COLUMN, TEAMMATE, UNASSIGNED } from "@/lib/ui/words";
import { Icon } from "@/components/ui/Icon";
import Link from "next/link";
import { SavedMarkView } from "@/components/record-card/SavedMarkView";
import { useNoShow } from "@/components/record-card/controls";
import type { IntakeCardData } from "@/lib/record-card/intake-cards";

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
  card,
  openHref,
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
  /** The card's decisions for this role (Sprint 10): which items are drawn, and the extra ones. Absent: the plain menu, as before. */
  card?: IntakeCardData;
  /** The opened-card address built on the client from the page's CURRENT address (search, paging, filters, view and grouping kept). */
  openHref?: string;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"stop" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningHere = running?.leadId === lead.id ? running : null;
  const runningElsewhere = running && !runningHere;
  const noShow = useNoShow(lead.id, name);
  const canMove = card ? card.edits.stage : true;
  const canAssign = card ? card.edits.owner : true;
  const extra = card ? card.menu.filter((m) => m.id !== "move") : [];
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
          <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-board-menu" disabled={pending}>
            <Icon name="more" />
          </button>
        )}
      >
        {(close) => (
          <div className="ix-menu-scroll">
            {extra.map((item) => {
              if (item.id === "noShow")
                return !noShow.canMark ? null : (
                  <button key="noShow" type="button" className="lp-pop-item" onClick={() => { close(); noShow.begin(); }}>
                    <span className="lp-pop-text">{item.label}</span>
                  </button>
                );
              if (item.id === "open") return null;
              return (
                <Link key={item.id} href={item.id === "step" ? `${openHref ?? card!.openHref}#card-steps` : (item.href ?? card!.fullHref)} className="lp-pop-item" onClick={close} scroll={item.id !== "step"}>
                  <span className="lp-pop-text">{item.label}</span>
                </Link>
              );
            })}
            {showMove && canMove && (
              <>
                <span className="ix-menu-h lx-label">Move to stage</span>
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
            {canAssign && <span className="ix-menu-h lx-label">{OWNER_COLUMN}</span>}
            {canAssign && <PopoverItem
              muted
              checked={lead.assigned_to == null}
              onSelect={() => {
                close();
                if (lead.assigned_to != null) onAssign(lead.id, null);
              }}
            >
              {UNASSIGNED}
            </PopoverItem>}
            {canAssign && unknownAssignee && (
              <PopoverItem checked onSelect={close}>
                {TEAMMATE}
              </PopoverItem>
            )}
            {canAssign && members.map((member) => (
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
            {card && (
              <Link href={card.fullHref} className="lp-pop-item" onClick={close}>
                <span className="lp-pop-text">{RECORD_CARD_MENU_OPEN}</span>
              </Link>
            )}
            <span className="ix-menu-h lx-label">Time</span>
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
              <span className="ix-sub ix-menu-note">
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
      {noShow.mark?.error && <SavedMarkView mark={noShow.mark} />}
      {noShow.doneLine && !noShow.mark?.error && <span className="lx-saved" role="status">{noShow.doneLine}</span>}
      {noShow.toast}
      {error && !dialog && (
        <span role="status" className="ix-sub ix-err-inline" title={error}>
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
