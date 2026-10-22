"use client";

import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import type { ReferralSource } from "@/lib/intake";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { pendingFor } from "@/lib/intake/needs-rebecca";
import TimeChip from "@/components/intake/TimeChip";
import { LtnSuggestion } from "@/components/intake/LtnSuggestion";
import {
  initialsOf,
  memberLabel,
  nextStepFor,
  stageCodeFor,
  stageLabelFor,
  touchStampFor,
} from "@/lib/intake/views";
import Popover, { PopoverItem } from "./Popover";
import NeedsRebeccaBadge from "./NeedsRebeccaBadge";
import AgentMoveChip from "./AgentMoveChip";
import SourceCell from "./SourceCell";
import { temperatureLabel, temperatureTitle } from "@/lib/intake/effective-temperature";
import {
  NEXT,
  NEXT_HOT,
  OWNER_CHIP,
  OWNER_CHIP_NONE,
  STAGE_PILL,
  STAGE_WARN,
  TEMP_PILL,
  TOUCH_IN_SMALL,
  TOUCH_OUT_SMALL,
} from "./styles";

const ellipsis: React.CSSProperties = {
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/**
 * One lead on either board (canvas 10b / 10c).
 *
 * Draggable with the native HTML5 API — the lead id travels as `text/plain`,
 * the same contract `PipelineLeadCard` uses, so the two boards in this product
 * behave identically under the mouse.
 *
 * The ⋯ menu is NOT a duplicate of the drag: it is the only way a keyboard
 * gets a lead from one column to another, and it carries both moves (stage and
 * owner) on both boards so the answer to "how do I do this without a mouse"
 * doesn't depend on which grouping you happen to be looking at.
 */
export default function IntakeCard({
  row,
  variant,
  stages,
  members,
  now,
  pending,
  error,
  time,
  pendingApprovals,
  onMoveStage,
  onAssign,
  onSetSource,
}: {
  row: IntakeRow;
  /** 10b shows the owner chip; 10c shows the next step and the stage pill. */
  variant: "stage" | "owner";
  stages: Stage[];
  members: MemberIdentity[];
  now: Date;
  pending: boolean;
  error?: string;
  /** This week's time per lead, or null when that read failed (§13.1). */
  time: IntakeTime | null;
  /** Absent = nothing to show; see needs-rebecca.ts for the three states. */
  pendingApprovals?: LeadPendingApprovals;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
  onSetSource: (leadId: string, source: ReferralSource | null) => void;
}) {
  const lead = row.lead;
  const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  const mark = lead.mark_text?.trim() || lead.business_name?.trim() || "—";
  const touch = touchStampFor(row);
  const step = nextStepFor(row, now);
  const temperature = row.temperature;
  const ownerName = row.owner ? memberLabel(row.owner) : null;
  const pendingDrafts = pendingFor(pendingApprovals, lead.id);

  const menu = (
    <Popover
      label={`Move ${name}`}
      align="right"
      width={210}
      trigger={({ onClick, ref, ...aria }) => (
        <button
          {...aria}
          ref={ref}
          type="button"
          onClick={onClick}
          className="intake-mono"
          style={{
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--mute)",
            borderRadius: 5,
            fontSize: 10,
            lineHeight: 1,
            padding: "3px 5px",
            cursor: "pointer",
          }}
        >
          ⋯
        </button>
      )}
    >
      {(close) => (
        <>
          <span className="intake-eyebrow" style={{ padding: "4px 8px" }}>
            Move to stage
          </span>
          {stages.map((stage) => (
            <PopoverItem
              key={stage.id}
              checked={lead.current_stage_id === stage.id}
              onSelect={() => {
                close();
                if (lead.current_stage_id !== stage.id) onMoveStage(lead.id, stage.id);
              }}
            >
              {stageCodeFor(stage)} · {stageLabelFor(stage)}
            </PopoverItem>
          ))}
          <span className="intake-eyebrow" style={{ padding: "8px 8px 4px" }}>
            Assign to
          </span>
          <PopoverItem
            muted
            checked={lead.assigned_to == null}
            onSelect={() => {
              close();
              onAssign(lead.id, null);
            }}
          >
            Unassigned
          </PopoverItem>
          {members.map((member) => (
            <PopoverItem
              key={member.userId}
              checked={lead.assigned_to === member.userId}
              onSelect={() => {
                close();
                onAssign(lead.id, member.userId);
              }}
            >
              {memberLabel(member)}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );

  return (
    <div
      data-lead-id={lead.id}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", lead.id)}
      style={{
        padding: variant === "owner" ? 12 : 11,
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--ground)",
        display: "flex",
        flexDirection: "column",
        gap: variant === "owner" ? 7 : 6,
        cursor: "grab",
        opacity: pending ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Link
          href={`/dashboard/leads/${lead.id}`}
          style={{
            ...ellipsis,
            fontSize: 12.5,
            fontWeight: 500,
            lineHeight: 1.3,
            color: touch.waitingOnUs ? "var(--burg)" : "var(--ink)",
          }}
        >
          {name}
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <div className="intake-mono" style={{ ...ellipsis, fontSize: 10.5, color: "var(--mute)", flex: 1 }}>
          {mark}
        </div>
        <SourceCell
          leadName={name}
          source={lead.referral_source}
          detail={lead.referral_detail}
          pending={pending}
          compact
          onSet={(source) => onSetSource(lead.id, source)}
        />
      </div>

      {pendingDrafts.length > 0 && (
        <div>
          <NeedsRebeccaBadge pending={pendingDrafts} />
        </div>
      )}

      {row.agentMove && (
        <div style={{ minWidth: 0 }}>
          <AgentMoveChip move={row.agentMove} />
        </div>
      )}

      {row.temperature.suggestion && (
        <div style={ellipsis}>
          <LtnSuggestion suggestion={row.temperature.suggestion} leadId={lead.id} />
        </div>
      )}

      {/* One temperature line. A person's reads as a fact, in its own colour; a
          derived one reads as a suggestion, in words; with neither, "Not routed".
          The reason is the tooltip. */}
      <div
        style={{
          ...ellipsis,
          fontSize: 11,
          ...(temperature.source === "person" && temperature.value
            ? { color: TEMP_PILL[temperature.value].color, fontWeight: 500 }
            : { color: "var(--mute)", fontStyle: "italic" }),
        }}
        title={temperatureTitle(temperature)}
      >
        {temperatureLabel(temperature)}
      </div>

      {variant === "owner" && (
        <div style={{ ...(step.urgent ? NEXT_HOT : NEXT), fontSize: 12, textWrap: "pretty" }}>
          {step.text}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {variant === "owner" ? (
          <span
            style={{ ...(row.stage ? STAGE_PILL : STAGE_WARN), ...ellipsis, display: "inline-block" }}
          >
            {stageCodeFor(row.stage)} · {stageLabelFor(row.stage)}
          </span>
        ) : (
          <span
            style={{ ...(ownerName ? OWNER_CHIP : OWNER_CHIP_NONE), ...ellipsis, display: "inline-block" }}
            title={ownerName ?? "Nobody owns the next response yet"}
          >
            {row.owner ? initialsOf(row.owner) : "—"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={touch.waitingOnUs ? TOUCH_IN_SMALL : TOUCH_OUT_SMALL}>{touch.text}</span>
        {/* §13.1 — one slot, both boards: this footer row is the same on the
            by-stage and by-owner variants, so the ⏱ lands in the same place
            on either card. */}
        <TimeChip
          leadId={lead.id}
          leadName={name}
          summary={time?.byLeadId[lead.id]}
          unavailable={time === null}
          running={time?.running ?? null}
          members={members}
          compact
        />
        {menu}
      </div>

      {error && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--crit)",
            background: "var(--critbg)",
            borderRadius: 6,
            padding: "5px 7px",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
