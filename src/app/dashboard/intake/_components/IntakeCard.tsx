"use client";

import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { pendingFor } from "@/lib/intake/needs-rebecca";
import TimeChip from "@/components/intake/TimeChip";
import { stageLabelFor, touchStampFor } from "@/lib/intake/views";
import { decisionOpen } from "@/lib/intake/stage-decision";
import { needsStageTitle, showTimeChip } from "@/lib/intake/leads-view";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import NeedsRebeccaBadge from "./NeedsRebeccaBadge";
import AssistantChips from "./AssistantChips";
import { assistantItems } from "@/lib/intake/assistant-column";
import RowMenu from "./RowMenu";
import { BLANK, LEADS_COMPARE_OPEN, LEADS_DUPLICATE, LEADS_MOVED_MARK, LEADS_MOVED_MARK_TITLE, LEADS_NEEDS_STAGE } from "@/lib/ui/words";
import { MEANING_TONE } from "@/lib/ui/tones";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";
import { leadLabel } from "@/lib/record-card/lead-label";
import type { IntakeCardData } from "@/lib/record-card/intake-cards";
import { NextStepLine } from "@/components/record-card/controls";
import { SavedNote } from "@/components/ui/SavedNote";
import { RECORD_CARD_SAVED, recordCardOpenLabel } from "@/lib/ui/words";
import type { Lane } from "@/lib/leads/lane";
import type { ReferralSource } from "@/lib/intake";
import TemperatureCell from "./TemperatureCell";
import SourceCell from "./SourceCell";
import OwnerCell from "./OwnerCell";
import "@/components/record-card/record-card.css";

/**
 * One lead on either board. Draggable (the lead id travels as `text/plain`). The card is small on purpose: the name (two
 * lines, never cut mid-word), "business · source" on one line, ONE temperature pill, the last touch date, and a "…" menu
 * that carries the stage move and the owner (the keyboard route for both drags) and the time actions. A lead imported
 * from Lawmatics whose stage nobody chose has one small "Needs a stage" marker (the Lawmatics stage is its title).
 * The checkbox exists only while the board is in select mode.
 */
export default function IntakeCard({
  row,
  stages,
  members,
  pending,
  error,
  time,
  pendingApprovals,
  onMoveStage,
  onAssign,
  selecting = false,
  selected = false,
  onToggleSelect,
  duplicate,
  movedOut = false,
  now,
  timeZone,
  onCompare,
  card,
  saved = false,
  onSetLane,
  onSetSource,
}: {
  row: IntakeRow;
  stages: Stage[];
  members: MemberIdentity[];
  pending: boolean;
  error?: string;
  time: IntakeTime | null;
  pendingApprovals?: LeadPendingApprovals;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (leadId: string) => void;
  duplicate?: DuplicateOf;
  movedOut?: boolean;
  now: Date;
  timeZone?: string;
  onCompare?: (leadId: string, otherId: string, trigger: HTMLElement) => void;
  /** Sprint 10: what this role may do on the card, and the card's open link and lines. Absent: the plain card, as before. */
  card?: IntakeCardData;
  /** The action's own `{ ok: true }` just landed: a quiet "Saved". */
  saved?: boolean;
  onSetLane?: (leadId: string, lane: Lane | null) => void;
  onSetSource?: (leadId: string, source: ReferralSource | null) => void;
}) {
  const lead = row.lead;
  // The PERSON's name first; the business and the mark are the sub-line, and the company stands in only with no person's name.
  const label = leadLabel(lead);
  const name = label.name;
  const source = lead.referral_source?.trim() || "";
  const line = card ? (label.sub ?? "") : [label.sub, source].filter(Boolean).join(" · ");
  const touch = touchStampFor(row, { now, timeZone });
  const pill = temperaturePill(row.temperature);
  const drafts = pendingFor(pendingApprovals, lead.id, row.stage);
  const decision = decisionOpen(row.decision, lead.current_stage_id) ? row.decision : null;

  return (
    <li
      data-lead-id={lead.id}
      className="lx-board-card ix-card"
      data-tone={touch.waitingOnUs ? MEANING_TONE.needsPerson : undefined}
      data-selected={selected ? "" : undefined}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", lead.id)}
      data-pending={pending ? "" : undefined}
    >
      <div className="lx-board-card-top ix-card-top">
        {selecting && onToggleSelect && (
          <input type="checkbox" className="intake-select" aria-label={`Select ${name}`} checked={selected} onChange={() => onToggleSelect(lead.id)} draggable={false} />
        )}
        <span className="lx-board-card-title">
          <Link href={card?.openHref ?? `/dashboard/leads/${lead.id}`} scroll={card ? false : undefined} data-card-open={card ? "" : undefined} aria-label={card ? recordCardOpenLabel(name) : undefined} className={`${selecting ? "" : "lx-rowlink "}ix-card-name`} title={name} data-in={touch.waitingOnUs ? "" : undefined}>
            {name}
          </Link>
        </span>
      </div>
      <span className="lx-board-card-meta" title={line || undefined}>
        {line || BLANK}
      </span>
      {(card || pill || drafts.length > 0 || decision || assistantItems(row).length > 0 || duplicate || movedOut) && (
        <div className="ix-card-pills">
          {card ? (
            <TemperatureCell leadName={name} temperature={row.temperature} pending={pending} canEdit={card.edits.temperature} onSet={(lane) => onSetLane?.(lead.id, lane)} />
          ) : (
            pill && (
              <span className="ix-temp" data-tone={pill.tone} data-suggested={pill.suggested ? "" : undefined} title={pill.title} aria-label={pill.ariaLabel}>
                {pill.text}
              </span>
            )
          )}
          {card?.approvals ? (
            card.approvals.href ? (
              <Link href={card.approvals.href} className="lx-pill lx-pill-warn lx-pill-wrap rc-attn">
                {card.approvals.text}
              </Link>
            ) : (
              <span className="lx-pill lx-pill-mute">{card.approvals.text}</span>
            )
          ) : (
            !card && <NeedsRebeccaBadge pending={drafts} />
          )}
          {decision && (
            <span className="lx-pill lx-pill-warn lx-pill-wrap" data-needs-decision title={needsStageTitle(decision)}>
              {LEADS_NEEDS_STAGE}
            </span>
          )}
          <AssistantChips row={row} />
          {duplicate && (
            <button type="button" className="lx-pill lx-pill-warn lx-pill-wrap ix-pill-btn" data-duplicate aria-haspopup="dialog" aria-label={LEADS_COMPARE_OPEN(name)} title={duplicateTitle(duplicate)} onClick={(event) => onCompare?.(lead.id, duplicate.leadId, event.currentTarget)}>
              {LEADS_DUPLICATE}
            </button>
          )}
          {movedOut && (
            <span className="lx-pill lx-pill-mute" data-moved title={LEADS_MOVED_MARK_TITLE}>
              {LEADS_MOVED_MARK}
            </span>
          )}
        </div>
      )}
      {card && (
        <div className="rc-bottom" data-card-bottom>
          <div className="rc-bottom-row">
            <SourceCell leadName={name} source={lead.referral_source} detail={lead.referral_detail} pending={pending} compact canEdit={card.edits.source} onSet={(next) => onSetSource?.(lead.id, next)} />
            <OwnerCell leadName={name} owner={row.owner} assignedTo={lead.assigned_to} members={members} pending={pending} canEdit={card.edits.owner} onAssign={(userId) => onAssign(lead.id, userId)} />
            <SavedNote show={saved}>{RECORD_CARD_SAVED}</SavedNote>
          </div>
          <NextStepLine kind="lead" id={lead.id} line={card.nextStep} dueIso={card.dueIso} text={card.bottom.nextStep} />
          <span title={touch.title}>{card.bottom.lastActivity}</span>
        </div>
      )}
      <div className="lx-board-card-foot ix-card-foot">
        {!card && <span className="ix-touch" data-in={touch.waitingOnUs ? "" : undefined} data-touch={touch.state} title={touch.title}>
          {touch.text}
        </span>}
        {showTimeChip(time?.byLeadId[lead.id], time?.running ?? null, lead.id, time === null) && (
          <TimeChip leadId={lead.id} leadName={name} summary={time?.byLeadId[lead.id]} unavailable={time === null} running={time?.running ?? null} members={members} compact />
        )}
        <RowMenu card={card} lead={lead} name={name} stages={stages} members={members} running={time?.running ?? null} onMoveStage={onMoveStage} onAssign={onAssign} />
      </div>
      <span className="lx-sr">{row.stage ? stageLabelFor(row.stage) : ""}</span>
      {error && (
        <p role="status" className="ix-err">
          {error}
        </p>
      )}
    </li>
  );
}
