"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MemberIdentity } from "@/lib/members/directory";
import type { Temperature } from "@/lib/intake";
import type { IntakeRow, SortDir, SortKey } from "@/lib/intake/rows";
import { nextStepFor, stageCodeFor, stageLabelFor, touchStampFor } from "@/lib/intake/views";
import type { IntakeTime } from "@/lib/time";
import TimeChip from "@/components/intake/TimeChip";
import OwnerCell from "./OwnerCell";
import TemperatureCell from "./TemperatureCell";
import {
  NEXT,
  NEXT_HOT,
  PANEL,
  STAGE_PILL,
  STAGE_WARN,
  TOUCH_IN,
  TOUCH_OUT,
} from "./styles";

/** The canvas's column widths, verbatim. The checkbox column is omitted (§11). */
const GRID = "2.1fr 1.15fr .8fr .95fr 64px 1.15fr 1.5fr";

/** Below this the columns would be unreadable, so the table scrolls instead. */
const MIN_TABLE_WIDTH = 880;

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "lead", label: "Lead" },
  { key: "stage", label: "Stage" },
  { key: "temp", label: "Temp" },
  { key: "source", label: "Source" },
  { key: "owner", label: "Owner" },
  { key: "lastTouch", label: "Last touch" },
  { key: "notes", label: "Next step" },
];

const ellipsis: React.CSSProperties = {
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/**
 * The intake list as a table (canvas 10a) — the default view, because 25 leads
 * with dates in them is a table.
 *
 * Every value on a row is derived: stage and source are columns, temperature
 * and reply state come from the pure helpers, and "Next step" is the latest
 * note or a statement of the reply state (views.ts). Nothing here is invented
 * and nothing reads as advice.
 */
export default function IntakeTable({
  rows,
  totalCount,
  members,
  sortKey,
  sortDir,
  now,
  pendingLeadId,
  errors,
  time,
  onSort,
  onSetTemperature,
  onAssign,
}: {
  rows: IntakeRow[];
  /** Rows before filtering — the footer's "of M". */
  totalCount: number;
  members: MemberIdentity[];
  sortKey: SortKey;
  sortDir: SortDir;
  now: Date;
  pendingLeadId: string | null;
  errors: Record<string, string>;
  /** This week's time per lead, or null when that read failed (§13.1). */
  time: IntakeTime | null;
  onSort: (key: SortKey) => void;
  onSetTemperature: (leadId: string, level: Temperature | null) => void;
  onAssign: (leadId: string, userId: string | null) => void;
}) {
  const router = useRouter();

  return (
    <div style={PANEL}>
      <div className="intake-scroll" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ minWidth: MIN_TABLE_WIDTH, display: "flex", flexDirection: "column", flex: 1 }}>
          {/* No role="row": there is no table/grid role around it, and a lone
              row role is worse for a screen reader than none. It is a strip of
              sort buttons, each of which says what it sorts. */}
          <div
            className="intake-eyebrow"
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 12,
              padding: "11px 18px",
              borderBottom: "1px solid var(--line)",
              background: "var(--surface2)",
              alignItems: "center",
              position: "sticky",
              top: 0,
              zIndex: 2,
            }}
          >
            {COLUMNS.map((column) => {
              const active = sortKey === column.key;
              return (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => onSort(column.key)}
                  aria-label={`Sort by ${column.label}`}
                  style={{
                    font: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    color: active ? "var(--ox)" : "var(--mute)",
                    cursor: "pointer",
                    ...ellipsis,
                  }}
                >
                  {column.label}
                  {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              );
            })}
          </div>

          {rows.map((row) => {
            const lead = row.lead;
            const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
            const step = nextStepFor(row, now);
            const touch = touchStampFor(row);
            const error = errors[lead.id];
            const pending = pendingLeadId === lead.id;

            return (
              <div key={lead.id}>
                <div
                  onClick={(event) => {
                    // A menu, a link or a field inside the row is its own
                    // target — only bare row surface navigates.
                    if ((event.target as HTMLElement).closest("button, a, input, select")) return;
                    router.push(`/dashboard/leads/${lead.id}`);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID,
                    gap: 12,
                    padding: "0 18px",
                    alignItems: "center",
                    height: "var(--rowh)",
                    borderBottom: "1px solid var(--line)",
                    fontSize: 13,
                    cursor: "pointer",
                    opacity: pending ? 0.55 : 1,
                    // Waiting on us is the one thing the canvas colours a whole
                    // row for; everything else stays ink.
                    color: touch.waitingOnUs ? "var(--burg)" : "var(--ink)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      style={{ ...ellipsis, display: "block", color: "inherit" }}
                    >
                      {name}
                    </Link>
                    <div
                      className="intake-mono"
                      style={{ ...ellipsis, fontSize: 11, color: "var(--mute)", marginTop: 2 }}
                    >
                      {lead.mark_text?.trim() || lead.business_name?.trim() || "—"}
                    </div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <span
                      style={{
                        ...(row.stage ? STAGE_PILL : STAGE_WARN),
                        display: "inline-block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={row.stage?.name ?? "This lead's stage no longer exists"}
                    >
                      {stageCodeFor(row.stage)} · {stageLabelFor(row.stage)}
                    </span>
                  </div>

                  <TemperatureCell
                    leadName={name}
                    temperature={row.temperature}
                    pending={pending}
                    onSet={(level) => onSetTemperature(lead.id, level)}
                  />

                  <div
                    style={{ ...ellipsis, fontSize: 12.5, color: "var(--ink2)" }}
                    title={lead.referral_detail?.trim() || undefined}
                  >
                    {lead.referral_source?.trim() || "—"}
                  </div>

                  <OwnerCell
                    leadName={name}
                    owner={row.owner}
                    assignedTo={lead.assigned_to}
                    members={members}
                    pending={pending}
                    onAssign={(userId) => onAssign(lead.id, userId)}
                  />

                  <div style={touch.waitingOnUs ? TOUCH_IN : TOUCH_OUT}>{touch.text}</div>

                  {/* §13.1 — the ⏱ rides at the end of the last cell rather
                      than in a column of its own, so GRID and the table's
                      minimum width are untouched and the chip can never push
                      the row past its container. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{ ...(step.urgent ? NEXT_HOT : NEXT), ...ellipsis, flex: 1 }}
                      title={step.text}
                    >
                      {step.text}
                    </span>
                    <TimeChip
                      leadId={lead.id}
                      leadName={name}
                      summary={time?.byLeadId[lead.id]}
                      unavailable={time === null}
                      running={time?.running ?? null}
                      members={members}
                    />
                  </div>
                </div>

                {error && (
                  // The refusal sits under the row it belongs to, not in a
                  // toast: by the time a toast is read the row it was about is
                  // ten rows up.
                  <div
                    role="status"
                    style={{
                      padding: "6px 18px",
                      fontSize: 11.5,
                      color: "var(--crit)",
                      background: "var(--critbg)",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
            // Only reachable when the read SUCCEEDED — a failed read never gets
            // this far (see the page's three-state branch).
            <p
              style={{
                margin: "18px",
                border: "1px dashed var(--line)",
                borderRadius: 10,
                padding: 26,
                textAlign: "center",
                color: "var(--mute)",
                fontSize: 12.5,
              }}
            >
              {totalCount === 0
                ? "Nobody is in intake right now. New leads land here as soon as they enter a pre-conversion stage."
                : "No lead matches these filters."}
            </p>
          )}

          <div style={{ flex: 1 }} />
        </div>
      </div>

      <div
        style={{
          padding: "11px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          borderTop: "1px solid var(--line)",
        }}
      >
        <span className="intake-mono" style={{ fontSize: 11, color: "var(--mute)" }}>
          Showing {rows.length} of {totalCount}
        </span>
        <span style={{ flex: 1 }} />
        <span className="intake-mono" style={{ fontSize: 11, color: "var(--mute)" }}>
          ← waiting on us · → waiting on them
        </span>
      </div>
    </div>
  );
}
