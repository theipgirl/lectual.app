"use client";

import { useEffect, useState } from "react";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { REFERRAL_SOURCES } from "@/lib/intake";
import type { ReplyState } from "@/lib/intake/reply";
import {
  UNASSIGNED_OWNER,
  type AgentMoveFilter,
  type IntakeFilters,
  type IntakeGroup,
  type IntakeView,
  type TempFilter,
} from "@/lib/intake/rows";
import { memberLabel, stageCodeFor, stageLabelFor } from "@/lib/intake/views";
import Popover, { PopoverItem } from "./Popover";
import { CHIP_COUNT, filterChip, groupPill } from "./styles";

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

/** One Temperature filter over the effective value: a person's lane, else the derived one. */
const TEMP_OPTIONS: Array<{ value: TempFilter; label: string }> = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
  { value: "none", label: "Not routed" },
];

/** The "Agent moves" filter: leads the Stage Keeper placed today (the firm's day) or in the last 7 days. */
const AGENT_OPTIONS: Array<{ value: AgentMoveFilter; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
];

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 24, background: "var(--line)" }} />;
}

/**
 * The control row (canvas 10a/10b/10c): group-by (boards only), the filter
 * chips, and "Save this view". The Table | Board toggle and the search box live
 * in the page header, beside the same two controls on Matters.
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
  needsRebeccaCount,
  agentMoveCounts,
  currentHref,
  onFilters,
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
  /**
   * Leads in this list with a draft waiting on Rebecca. null/undefined = the
   * approval queue wasn't read, so the toggle is not offered at all.
   */
  needsRebeccaCount?: number | null;
  /**
   * How many leads in this list the Stage Keeper moved, by window. null/undefined = the moves
   * couldn't be read (or the board has none to offer), so the filter is not offered at all.
   */
  agentMoveCounts?: { today: number; week: number } | null;
  /** The link "Save this view" copies. */
  currentHref: string;
  onFilters: (next: IntakeFilters) => void;
  onGroup: (next: IntakeGroup) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

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

      {view === "board" && <Divider />}

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
            title="Hot / Warm / Cold match the temperature a person set, or the suggested one where nobody has. Not routed is neither."
          >
            {filters.temp ? (TEMP_OPTIONS.find((option) => option.value === filters.temp)?.label ?? "Temperature") : "Temperature"}
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

      {agentMoveCounts != null && (
        <Popover
          label="Filter by agent moves"
          width={170}
          trigger={({ onClick, ref, ...aria }) => (
            <button
              {...aria}
              ref={ref}
              type="button"
              onClick={onClick}
              style={filterChip(Boolean(filters.agent))}
              title="Show only leads the Stage Keeper moved, and that nobody has moved since."
            >
              {filters.agent
                ? `Agent moves · ${AGENT_OPTIONS.find((option) => option.value === filters.agent)?.label ?? ""}`
                : "Agent moves"}
              <span style={CHIP_COUNT}>{filters.agent === "today" ? agentMoveCounts.today : agentMoveCounts.week}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <PopoverItem
                muted
                checked={!filters.agent}
                onSelect={() => {
                  close();
                  onFilters({ ...filters, agent: null });
                }}
              >
                Any lead
              </PopoverItem>
              {AGENT_OPTIONS.map((option) => (
                <PopoverItem
                  key={option.value}
                  checked={filters.agent === option.value}
                  onSelect={() => {
                    close();
                    onFilters({ ...filters, agent: option.value });
                  }}
                >
                  {option.label}
                  {" · "}
                  {option.value === "today" ? agentMoveCounts.today : agentMoveCounts.week}
                </PopoverItem>
              ))}
            </>
          )}
        </Popover>
      )}

      {needsRebeccaCount != null && (
        <button
          type="button"
          style={filterChip(filters.needsRebecca)}
          aria-pressed={filters.needsRebecca}
          title="Show only leads with a draft waiting for Rebecca's review in the approval queue."
          onClick={() => onFilters({ ...filters, needsRebecca: !filters.needsRebecca })}
        >
          Needs Rebecca
          <span style={CHIP_COUNT}>{needsRebeccaCount}</span>
        </button>
      )}

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
