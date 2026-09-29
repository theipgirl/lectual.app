"use client";

import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import TimeChip from "@/components/intake/TimeChip";
import {
  initialsOf,
  memberLabel,
  nextStepFor,
  stageCodeFor,
  stageLabelFor,
  touchStampFor,
} from "@/lib/intake/views";
import Popover, { PopoverItem } from "./Popover";
import {
  NEXT,
  NEXT_HOT,
  OWNER_CHIP,
  OWNER_CHIP_NONE,
  STAGE_PILL,
  STAGE_WARN,
  TEMP_DOT,
  TEMP_DOT_NONE,
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
  onMoveStage,
  onAssign,
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
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
}) {
  const lead = row.lead;
  const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  const mark = lead.mark_text?.trim() || lead.business_name?.trim() || "—";
  const touch = touchStampFor(row);
  const step = nextStepFor(row, now);
  const dot = TEMP_DOT[row.temperature.level] ?? TEMP_DOT_NONE;
  const ownerName = row.owner ? memberLabel(row.owner) : null;

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
        <span style={{ flex: 1 }} />
        <span
          aria-hidden
          style={dot}
          title={`${row.temperature.level} — ${row.temperature.reason}`}
        />
      </div>

      <div className="intake-mono" style={{ ...ellipsis, fontSize: 10.5, color: "var(--mute)" }}>
        {mark}
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
