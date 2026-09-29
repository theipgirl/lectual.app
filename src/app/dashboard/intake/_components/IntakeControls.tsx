"use client";

import { useEffect, useRef, useState } from "react";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { REFERRAL_SOURCES, type Temperature } from "@/lib/intake";
import type { ReplyState } from "@/lib/intake/reply";
import {
  UNASSIGNED_OWNER,
  type IntakeFilters,
  type IntakeGroup,
  type IntakeView,
} from "@/lib/intake/rows";
import { memberLabel, stageCodeFor, stageLabelFor } from "@/lib/intake/views";
import Popover, { PopoverItem } from "./Popover";
import { BoardIcon, SearchIcon, TableIcon } from "./icons";
import {
  CHIP_COUNT,
  SEGMENT_WRAP,
  filterChip,
  groupPill,
  segmentButton,
} from "./styles";

/** Off-screen but in the accessibility tree — no utility class exists for this
 * in intake.css, and one declaration is cheaper than a stylesheet edit. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/** How long "Save this view" says "Copied" before going back to itself. */
const COPIED_MS = 1500;

/**
 * `?reply=` has no chip of its own — §11's control row is Stage · Owner · Source
 * · Temperature, and Phase 1's Reply filter was dropped with the old filter bar.
 * The param is still parsed and still filters, though, so a link the firm
 * bookmarked off the old page (`/dashboard/intake?reply=awaiting`, which the
 * redirect forwards intact) silently narrows the list. Rather than let that
 * happen with nothing on screen to explain it, the chip below appears ONLY
 * when the filter is active, says what it is doing, and clears it.
 */
const REPLY_LABEL: Record<ReplyState, string> = {
  replied: "Waiting on us",
  awaiting: "Waiting on them",
  unknown: "No reply state",
};

const TEMP_OPTIONS: Array<{ value: Temperature; label: string }> = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 24, background: "var(--line)" }} />;
}

/**
 * The control row (canvas 10a/10b/10c): view toggle, group-by, search, four
 * filter chips, and "Save this view".
 *
 * Holds no filter state of its own — the workspace owns it and mirrors it into
 * the URL, which is the whole point: every arrangement of this row is a link
 * someone can bookmark or paste into Slack, and "Save this view" is nothing
 * more than copying that link.
 */
export default function IntakeControls({
  filters,
  view,
  group,
  stages,
  members,
  visibleCount,
  currentHref,
  onFilters,
  onView,
  onGroup,
}: {
  filters: IntakeFilters;
  view: IntakeView;
  group: IntakeGroup;
  /** Intake stages only, in order — the chip's "Stage 1–6" summary reads from these. */
  stages: Stage[];
  members: MemberIdentity[];
  /** Rows after filtering, for the Stage chip's count. */
  visibleCount: number;
  /** The link "Save this view" copies. */
  currentHref: string;
  onFilters: (next: IntakeFilters) => void;
  onView: (next: IntakeView) => void;
  onGroup: (next: IntakeGroup) => void;
}) {
  // The search box is local so typing stays instant; the workspace debounces
  // the URL push and the filter itself. Re-synced when the filters change from
  // somewhere else (a cleared chip, a back button).
  const [query, setQuery] = useState(filters.q);
  const lastPushed = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== lastPushed.current) {
      lastPushed.current = filters.q;
      setQuery(filters.q);
    }
  }, [filters.q]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  function commitQuery(value: string) {
    setQuery(value);
    lastPushed.current = value;
    onFilters({ ...filters, q: value });
  }

  const selectedStage = stages.find((stage) => stage.id === filters.stage) ?? null;
  const codes = stages.map(stageCodeFor);
  const stageSummary =
    codes.length === 0
      ? "Stage"
      : codes.length === 1
        ? `Stage ${codes[0]}`
        : `Stage ${codes[0]}–${codes[codes.length - 1]}`;

  const selectedOwner =
    filters.owner === UNASSIGNED_OWNER
      ? "Unassigned"
      : (members.find((member) => member.userId === filters.owner)?.displayName ??
        (filters.owner ? "Owner" : null));

  async function saveView() {
    const url =
      typeof window === "undefined" ? currentHref : new URL(currentHref, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard permission can be refused (an insecure origin, a locked-down
      // browser). Saying "Copied" then would be a lie, so the button stays put
      // and the address bar already holds the same URL.
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={SEGMENT_WRAP} role="group" aria-label="How to arrange the list">
        <button
          type="button"
          style={segmentButton(view === "table")}
          aria-pressed={view === "table"}
          onClick={() => onView("table")}
        >
          <TableIcon />
          Table
        </button>
        <button
          type="button"
          style={segmentButton(view === "board")}
          aria-pressed={view === "board"}
          onClick={() => onView("board")}
        >
          <BoardIcon />
          Board
        </button>
      </div>

      {view === "board" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} role="group" aria-label="Group by">
          <span className="intake-eyebrow">Group by</span>
          <button
            type="button"
            style={groupPill(group === "stage")}
            aria-pressed={group === "stage"}
            onClick={() => onGroup("stage")}
          >
            Stage
          </button>
          <button
            type="button"
            style={groupPill(group === "owner")}
            aria-pressed={group === "owner"}
            onClick={() => onGroup("owner")}
          >
            Owner
          </button>
        </div>
      )}

      <Divider />

      <label
        style={{
          ...filterChip(false),
          color: "var(--mute)",
          minWidth: 190,
          cursor: "text",
        }}
      >
        <SearchIcon />
        {/* The placeholder is the visible label, so the accessible name is
            carried here rather than by an aria-label a screen reader would
            read on top of it. */}
        <span style={VISUALLY_HIDDEN}>Search leads</span>
        <input
          type="search"
          value={query}
          placeholder="Name, mark, or note"
          onChange={(event) => commitQuery(event.target.value)}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            font: "inherit",
            fontSize: 12.5,
            color: "var(--ink)",
            minWidth: 0,
            width: "100%",
          }}
        />
      </label>

      <Popover
        label="Filter by stage"
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} style={filterChip(true)}>
            {selectedStage ? `${stageCodeFor(selectedStage)} · ${stageLabelFor(selectedStage)}` : stageSummary}
            <span style={CHIP_COUNT}>{visibleCount}</span>
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              muted
              checked={filters.stage === null}
              onSelect={() => {
                close();
                onFilters({ ...filters, stage: null });
              }}
            >
              Every intake stage
            </PopoverItem>
            {stages.map((stage) => (
              <PopoverItem
                key={stage.id}
                checked={filters.stage === stage.id}
                onSelect={() => {
                  close();
                  onFilters({ ...filters, stage: stage.id });
                }}
              >
                {stageCodeFor(stage)} · {stageLabelFor(stage)}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      <Popover
        label="Filter by owner"
        width={210}
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            onClick={onClick}
            style={filterChip(filters.owner !== null)}
          >
            {selectedOwner ?? "Owner"}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              muted
              checked={filters.owner === null}
              onSelect={() => {
                close();
                onFilters({ ...filters, owner: null });
              }}
            >
              Anyone
            </PopoverItem>
            <PopoverItem
              checked={filters.owner === UNASSIGNED_OWNER}
              onSelect={() => {
                close();
                onFilters({ ...filters, owner: UNASSIGNED_OWNER });
              }}
            >
              Unassigned
            </PopoverItem>
            {members.map((member) => (
              <PopoverItem
                key={member.userId}
                checked={filters.owner === member.userId}
                onSelect={() => {
                  close();
                  onFilters({ ...filters, owner: member.userId });
                }}
              >
                {memberLabel(member)}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      <Popover
        label="Filter by referral source"
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            onClick={onClick}
            style={filterChip(filters.source.length > 0)}
          >
            {filters.source.length === 0
              ? "Source"
              : filters.source.length === 1
                ? filters.source[0]
                : `${filters.source.length} sources`}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              muted
              checked={filters.source.length === 0}
              onSelect={() => {
                close();
                onFilters({ ...filters, source: [] });
              }}
            >
              Any source
            </PopoverItem>
            {/* Multi-select, and the only chip that is: the Monday question is
                "UGW or Melanin Money", not one campaign at a time. The menu
                stays open so a second one can be added in the same gesture. */}
            {REFERRAL_SOURCES.map((source) => (
              <PopoverItem
                key={source}
                checked={filters.source.includes(source)}
                onSelect={() =>
                  onFilters({
                    ...filters,
                    source: filters.source.includes(source)
                      ? filters.source.filter((value) => value !== source)
                      : [...filters.source, source],
                  })
                }
              >
                {source}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      <Popover
        label="Filter by temperature"
        width={165}
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            onClick={onClick}
            style={filterChip(filters.temp !== null)}
          >
            {filters.temp
              ? filters.temp[0].toUpperCase() + filters.temp.slice(1)
              : "Temperature"}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              muted
              checked={filters.temp === null}
              onSelect={() => {
                close();
                onFilters({ ...filters, temp: null });
              }}
            >
              Any temperature
            </PopoverItem>
            {TEMP_OPTIONS.map((option) => (
              <PopoverItem
                key={option.value}
                checked={filters.temp === option.value}
                onSelect={() => {
                  close();
                  onFilters({ ...filters, temp: option.value });
                }}
              >
                {option.label}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>

      {filters.reply !== null && (
        <button
          type="button"
          style={filterChip(true)}
          aria-label={`Clear the “${REPLY_LABEL[filters.reply]}” filter`}
          onClick={() => onFilters({ ...filters, reply: null })}
        >
          {REPLY_LABEL[filters.reply]}
          <span aria-hidden>×</span>
        </button>
      )}

      <span style={{ flex: 1 }} />

      <button
        type="button"
        onClick={saveView}
        className="intake-mono"
        style={{
          border: "none",
          background: "transparent",
          padding: 0,
          fontSize: 11.5,
          color: "var(--burg)",
          cursor: "pointer",
        }}
      >
        {copied ? "Copied" : "Save this view"}
      </button>
    </div>
  );
}
