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
import AgentMoveChip from "./AgentMoveChip";
import RowMenu from "./RowMenu";
import { LEADS_DUPLICATE, LEADS_MOVED_MARK, LEADS_MOVED_MARK_TITLE, LEADS_NEEDS_STAGE } from "@/lib/ui/words";
import { duplicateTitle, type DuplicateOf } from "@/lib/intake/duplicates";

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
  now: _now,
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
}: {
  row: IntakeRow;
  stages: Stage[];
  members: MemberIdentity[];
  now: Date;
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
}) {
  const lead = row.lead;
  const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  const business = lead.mark_text?.trim() || lead.business_name?.trim() || "";
  const source = lead.referral_source?.trim() || "";
  const line = [business, source].filter(Boolean).join(" · ");
  const touch = touchStampFor(row);
  const pill = temperaturePill(row.temperature);
  const drafts = pendingFor(pendingApprovals, lead.id);
  const decision = decisionOpen(row.decision, lead.current_stage_id) ? row.decision : null;

  return (
    <div
      data-lead-id={lead.id}
      className="ix-card"
      data-selected={selected ? "" : undefined}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", lead.id)}
      style={{ opacity: pending ? 0.55 : 1 }}
    >
      <div className="ix-card-top">
        {selecting && onToggleSelect && (
          <input type="checkbox" className="intake-select" aria-label={`Select ${name}`} checked={selected} onChange={() => onToggleSelect(lead.id)} draggable={false} />
        )}
        <Link href={`/dashboard/leads/${lead.id}`} className="ix-card-name" title={name} style={{ color: touch.waitingOnUs ? "var(--burg)" : undefined }}>
          {name}
        </Link>
      </div>
      <span className="ix-sub" title={line || undefined}>
        {line || "—"}
      </span>
      {(pill || drafts.length > 0 || decision || row.agentMove || duplicate || movedOut) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {pill && (
            <span className="ix-temp" data-tone={pill.tone} data-suggested={pill.suggested ? "" : undefined} title={pill.title} aria-label={pill.ariaLabel}>
              {pill.text}
            </span>
          )}
          <NeedsRebeccaBadge pending={drafts} />
          {decision && (
            <span className="ix-marker" data-needs-decision title={needsStageTitle(decision)}>
              {LEADS_NEEDS_STAGE}
            </span>
          )}
          <AgentMoveChip move={row.agentMove} />
          {duplicate && (
            <a className="ix-marker ix-marker-dup" data-duplicate href={`/dashboard/leads/${duplicate.leadId}/`} title={duplicateTitle(duplicate)}>
              {LEADS_DUPLICATE}
            </a>
          )}
          {movedOut && (
            <span className="ix-marker ix-marker-quiet" data-moved title={LEADS_MOVED_MARK_TITLE}>
              {LEADS_MOVED_MARK}
            </span>
          )}
        </div>
      )}
      <div className="ix-card-foot">
        <span className="ix-touch" data-in={touch.waitingOnUs ? "" : undefined} title={touch.waitingOnUs ? "Waiting on us" : "Waiting on them"}>
          <span className="lx-sr">{touch.waitingOnUs ? "Waiting on us: " : "Waiting on them: "}</span>
          {touch.text}
        </span>
        {showTimeChip(time?.byLeadId[lead.id], time?.running ?? null, lead.id, time === null) && (
          <TimeChip leadId={lead.id} leadName={name} summary={time?.byLeadId[lead.id]} unavailable={time === null} running={time?.running ?? null} members={members} compact />
        )}
        <RowMenu lead={lead} name={name} stages={stages} members={members} running={time?.running ?? null} onMoveStage={onMoveStage} onAssign={onAssign} />
      </div>
      <span className="lx-sr">{row.stage ? stageLabelFor(row.stage) : ""}</span>
      {error && (
        <p role="status" className="ix-err" style={{ margin: 0, borderRadius: 6 }}>
          {error}
        </p>
      )}
    </div>
  );
}
