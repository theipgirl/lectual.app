"use client";

import { useState } from "react";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import type { IntakeRow } from "@/lib/intake/rows";
import type { IntakeTime } from "@/lib/time";
import { ownerColumns, stageColumns } from "@/lib/intake/views";
import IntakeCard from "./IntakeCard";
import { CHIP_COUNT, ownerAvatar, ownerAvatarFor } from "./styles";

/** Narrower than this and a card is unreadable, so the board scrolls instead. */
const MIN_COLUMN = 210;

const columnShell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  border: "1px solid var(--line)",
  borderRadius: 13,
  background: "var(--surface)",
  overflow: "hidden",
};

const pill = (background: string, color: string): React.CSSProperties => ({
  fontFamily: "var(--font-jetbrains-mono), monospace",
  fontSize: 10.5,
  padding: "3px 7px",
  borderRadius: 5,
  background,
  color,
  whiteSpace: "nowrap",
});

/**
 * Both boards (canvas 10b and 10c) — same columns component, two groupings.
 *
 * They share one implementation because they are the same question asked two
 * ways: which bucket is a lead in, and dragging it moves it to another. The
 * only differences are what a column IS (a stage / a person), what the drop
 * writes (moveLeadStage / assignLead) and which face the card shows.
 *
 * Everything is filtered upstream: these get the rows the table would be
 * showing, so a filter chip narrows all three views identically.
 */
export default function IntakeBoard({
  group,
  rows,
  stages,
  members,
  now,
  pendingLeadId,
  errors,
  time,
  onMoveStage,
  onAssign,
}: {
  group: "stage" | "owner";
  rows: IntakeRow[];
  /** Intake stages, in order — the columns of the by-stage board. */
  stages: Stage[];
  members: MemberIdentity[];
  now: Date;
  pendingLeadId: string | null;
  errors: Record<string, string>;
  /** This week's time per lead, or null when that read failed (§13.1). */
  time: IntakeTime | null;
  onMoveStage: (leadId: string, stageId: string) => void;
  onAssign: (leadId: string, userId: string | null) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const columns =
    group === "stage"
      ? stageColumns(rows, stages).map((column) => ({
          // "unassigned" can't collide with a uuid, and a stage id can't be the
          // empty string — so the drop key doubles as the column's React key.
          key: column.stage.id,
          rows: column.rows,
          count: column.count,
          head: (
            <>
              <span style={pill("var(--oxbg)", "var(--ox)")}>{column.code}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {column.label}
              </span>
            </>
          ),
          label: `${column.code} · ${column.label}`,
          onDrop: (leadId: string) => onMoveStage(leadId, column.stage.id),
        }))
      : ownerColumns(rows, members).map((column, index) => ({
          key: column.key ?? "unassigned",
          rows: column.rows,
          count: column.count,
          head: (
            <>
              <span style={column.key === null ? ownerAvatar("none") : ownerAvatarFor(index - 1)}>
                {column.initials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 12.5,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {column.label}
                </span>
                <span
                  className="intake-mono"
                  style={{ display: "block", fontSize: 10.5, color: "var(--mute)", marginTop: 2 }}
                >
                  {column.load}
                </span>
              </span>
            </>
          ),
          label: column.label,
          onDrop: (leadId: string) => onAssign(leadId, column.key),
        }));

  return (
    <div
      className="intake-scroll"
      style={{ flex: 1, minHeight: 0, minWidth: 0, paddingBottom: 6 }}
    >
      <div
        style={{
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: `minmax(${MIN_COLUMN}px, 1fr)`,
          gap: group === "stage" ? 11 : 14,
          minHeight: "100%",
          alignItems: "stretch",
        }}
      >
        {columns.map((column) => {
          const isTarget = dragOver === column.key;
          return (
            <section
              key={column.key}
              aria-label={`${column.label}, ${column.count} leads`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(column.key);
              }}
              onDragLeave={() => setDragOver((key) => (key === column.key ? null : key))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const leadId = event.dataTransfer.getData("text/plain");
                if (leadId) column.onDrop(leadId);
              }}
              style={{
                ...columnShell,
                padding: group === "stage" ? 12 : 14,
                gap: group === "stage" ? 9 : 10,
                borderColor: isTarget ? "var(--ox)" : "var(--line)",
                background: isTarget ? "var(--cream)" : "var(--surface)",
              }}
            >
              <header style={{ display: "flex", alignItems: "center", gap: group === "stage" ? 7 : 9 }}>
                {column.head}
                <span style={{ flex: 1 }} />
                <span style={{ ...CHIP_COUNT, color: "var(--mute)" }}>{column.count}</span>
              </header>

              {column.rows.map((row) => (
                <IntakeCard
                  key={row.lead.id}
                  row={row}
                  variant={group}
                  stages={stages}
                  members={members}
                  now={now}
                  pending={pendingLeadId === row.lead.id}
                  error={errors[row.lead.id] || undefined}
                  time={time}
                  onMoveStage={onMoveStage}
                  onAssign={onAssign}
                />
              ))}

              {column.rows.length === 0 && (
                <p
                  style={{
                    margin: 0,
                    padding: 11,
                    border: "1px dashed var(--line)",
                    borderRadius: 10,
                    fontSize: 11.5,
                    lineHeight: 1.45,
                    color: "var(--mute)",
                  }}
                >
                  Nothing here
                </p>
              )}

              <span style={{ flex: 1 }} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
