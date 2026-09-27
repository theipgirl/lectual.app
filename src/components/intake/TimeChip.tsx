"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MemberIdentity } from "@/lib/members/directory";
import {
  elapsedSeconds,
  formatClock,
  formatDuration,
  type LeadTimeSummary,
  type RunningSummary,
} from "@/lib/time";
import { memberLabel } from "@/lib/intake/views";
import Popover from "@/app/dashboard/intake/_components/Popover";
import {
  addManualTimeAction,
  startTimerAction,
  stopTimerAction,
} from "@/app/dashboard/intake/time-actions";
import TimeEntryDialog, { type TimeEntrySubmit } from "./TimeEntryDialog";

/**
 * The ⏱ on an intake table row and on both board cards (blueprint §13.1).
 *
 * It shows THIS WEEK'S total for the lead, turns into a live clock while the
 * signed-in person has a timer running on it, and carries the three writes —
 * Start, Stop (with a one-line note) and "+ time" — behind the same Popover
 * every other menu on this page uses, so it closes the same way and the
 * keyboard path in and out is the one people already know.
 *
 * The clock ticks in the browser, but it is only ever a RENDERING of
 * `running.startedAt`, which came from the server: a reload, a second tab or a
 * sleeping laptop all resume from the stored timestamp, and the duration that
 * is finally recorded is computed server-side on Stop. Nothing here decides
 * how long anything took.
 *
 * Three states, never two (AGENTS.md): a number, "0m" when nobody has logged
 * anything this week, and an em dash when the time read FAILED — `summary`
 * undefined with `unavailable` set. "0m" over a broken read would tell a firm
 * nobody has touched a lead all week when somebody has.
 *
 * Time here is INTERNAL EFFORT. It is never a client invoice, never sent
 * anywhere, and never reaches a client.
 */

const CHIP_BASE: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains-mono), monospace",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  borderRadius: 5,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--mute)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flex: "0 0 auto",
  lineHeight: 1.5,
};

/** Running is the one state the chip colours — it is the row that is costing time now. */
const CHIP_RUNNING: React.CSSProperties = {
  borderColor: "var(--ox)",
  background: "var(--oxbg)",
  color: "var(--ox)",
};

const MENU_ITEM: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  textAlign: "left",
  width: "100%",
  fontSize: 12.5,
  fontFamily: "inherit",
  padding: "6px 8px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  cursor: "pointer",
};

type DialogMode = "stop" | "manual" | null;

export default function TimeChip({
  leadId,
  leadName,
  summary,
  unavailable = false,
  running,
  members,
  compact = false,
}: {
  leadId: string;
  leadName: string;
  /** This week's roll-up for this lead. Undefined = nothing logged (or unreadable). */
  summary: LeadTimeSummary | undefined;
  /** The time read failed — show an em dash rather than a confident zero. */
  unavailable?: boolean;
  /** The signed-in person's open timer, wherever in the firm it is running. */
  running: RunningSummary | null;
  members: MemberIdentity[];
  /** Board cards are tighter than table rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [tick, setTick] = useState(() => Date.now());

  const runningHere = running?.leadId === leadId ? running : null;
  const runningElsewhere = running && !runningHere ? running : null;

  // One interval, only while this chip is the one counting. A page of 25 rows
  // therefore runs one timer, not 25.
  useEffect(() => {
    if (!runningHere) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningHere]);

  const liveSeconds = runningHere
    ? elapsedSeconds(
        { started_at: runningHere.startedAt, ended_at: null, seconds: 0 },
        new Date(tick),
      )
    : 0;

  const weekSeconds = summary?.seconds ?? 0;
  const face = unavailable
    ? "—"
    : runningHere
      ? formatClock(liveSeconds)
      : formatDuration(weekSeconds);

  // A uuid on a hover tells nobody anything, and the directory can legitimately
  // be missing a person (an offboarded teammate's entries are real history).
  const nameFor = (userId: string) => {
    const member = members.find((candidate) => candidate.userId === userId);
    return member ? memberLabel(member) : "Someone in the firm";
  };

  // The hover, and the same sentence a screen reader gets from aria-label:
  // who logged what this week, because a total nobody can explain is a total
  // nobody trusts.
  const breakdown = (summary?.byUser ?? []).map(
    (total) =>
      `${nameFor(total.userId)} ${formatDuration(total.seconds)}${total.running ? " (running)" : ""}` +
      (total.lastNote ? ` — ${total.lastNote}` : ""),
  );
  const base = unavailable
    ? "Couldn't read time entries — this is a broken read, not an empty week."
    : breakdown.length > 0
      ? `This week: ${formatDuration(weekSeconds)}\n${breakdown.join("\n")}`
      : "No time logged on this lead this week";
  // Why Start is unavailable belongs on the hover too, not only inside the
  // menu — one running timer per person is the rule people bump into most.
  const title = runningElsewhere
    ? `${base}\nA timer is already running on ${runningElsewhere.leadName ?? "another lead"} — stop it first.`
    : base;

  function run(act: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await act();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      // The page is force-dynamic, so a refresh re-reads the entries and the
      // running timer from the server — which is what makes the chip survive a
      // reload rather than depending on optimistic state.
      router.refresh();
    });
  }

  function onDialogSubmit(input: TimeEntrySubmit) {
    if (dialog === "stop") {
      if (!runningHere) return;
      run(() => stopTimerAction(runningHere.entryId, input.note, leadId));
      return;
    }
    run(() => addManualTimeAction(leadId, input.seconds ?? 0, input.note, input.atIso));
  }

  return (
    // The chip sits inside a table row (and a draggable card) whose own click
    // navigates to the lead. Swallowing the click here is what keeps opening
    // the menu from also opening the record.
    <span
      role="presentation"
      onClick={(event) => event.stopPropagation()}
      style={{ display: "inline-flex", minWidth: 0, flex: "0 0 auto" }}
    >
      <Popover
        label={`Time on ${leadName}. ${title.replace(/\n/g, ". ")}`}
        align="right"
        width={230}
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            title={title}
            disabled={pending}
            onClick={onClick}
            style={{
              ...CHIP_BASE,
              ...(runningHere ? CHIP_RUNNING : null),
              fontSize: compact ? 10 : 11,
              padding: compact ? "2px 5px" : "3px 6px",
              cursor: pending ? "progress" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            <span aria-hidden>⏱</span>
            {face}
          </button>
        )}
      >
        {(close) => (
          <>
            <span className="intake-eyebrow" style={{ padding: "4px 8px" }}>
              {unavailable
                ? "Time unavailable"
                : `This week · ${formatDuration(weekSeconds)}`}
            </span>

            {runningHere ? (
              <button
                type="button"
                role="menuitem"
                style={{ ...MENU_ITEM, color: "var(--ox)" }}
                onClick={() => {
                  close();
                  setDialog("stop");
                }}
              >
                Stop timer · {formatClock(liveSeconds)}
              </button>
            ) : runningElsewhere ? (
              // Disabled rather than hidden, and it says WHY plus where: one
              // running timer per person is a database fact (0056's partial
              // unique index), so a Start that silently did nothing would be
              // the worse lie.
              <span
                style={{
                  display: "block",
                  padding: "6px 8px",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: "var(--mute)",
                }}
              >
                A timer is already running on{" "}
                {runningElsewhere.leadId ? (
                  <Link
                    href={`/dashboard/leads/${runningElsewhere.leadId}`}
                    style={{ color: "var(--ox)" }}
                  >
                    {runningElsewhere.leadName ?? "another lead"}
                  </Link>
                ) : (
                  "another record"
                )}
                . Stop it first.
              </span>
            ) : (
              <button
                type="button"
                role="menuitem"
                style={MENU_ITEM}
                onClick={() => {
                  close();
                  run(() => startTimerAction(leadId));
                }}
              >
                Start timer
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              style={MENU_ITEM}
              onClick={() => {
                close();
                setDialog("manual");
              }}
            >
              + time
            </button>

            {breakdown.length > 0 && (
              <>
                <span className="intake-eyebrow" style={{ padding: "8px 8px 4px" }}>
                  Who logged it
                </span>
                {breakdown.map((line) => (
                  <span
                    key={line}
                    style={{
                      padding: "3px 8px",
                      fontSize: 11.5,
                      lineHeight: 1.4,
                      color: "var(--ink2)",
                    }}
                  >
                    {line}
                  </span>
                ))}
              </>
            )}

            <span
              style={{ padding: "6px 8px 2px", fontSize: 10.5, lineHeight: 1.4, color: "var(--mute)" }}
            >
              Internal effort only — never a client invoice.
            </span>
          </>
        )}
      </Popover>

      {error && (
        <span
          role="status"
          style={{
            marginLeft: 6,
            fontSize: 11,
            color: "var(--crit)",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={error}
        >
          {error}
        </span>
      )}

      {dialog && (
        <TimeEntryDialog
          mode={dialog}
          leadName={leadName}
          pending={pending}
          error={error}
          onCancel={() => {
            setDialog(null);
            setError(null);
          }}
          onSubmit={onDialogSubmit}
        />
      )}
    </span>
  );
}
