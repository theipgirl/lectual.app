"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { REFERRAL_SOURCES } from "@/lib/intake";
import type { ReplyState } from "@/lib/intake/reply";
import { UNASSIGNED_OWNER, type AgentMoveFilter, type IntakeFilters, type IntakeGroup, type IntakeView, type TempFilter } from "@/lib/intake/rows";
import { memberLabel, stageLabelFor } from "@/lib/intake/views";
import type { SetChip } from "@/lib/intake/sets";
import type { LeadSet } from "@/lib/intake/working";
import type { ChipCounts } from "@/lib/intake/leads-view";
import Popover, { PopoverItem } from "./Popover";
import { chipClass } from "@/components/list-page/Chips";
import { LEADS_DUPLICATES, LEADS_DUPLICATES_TITLE, LEADS_ALL_OPEN_MATCHES, LEADS_ANY_STAGE, LEADS_STAGE_FILTER, LEADS_SUGGESTIONS, LEADS_SUGGESTIONS_TITLE, MOVED_AUTOMATICALLY, NOT_RATED, TEMPERATURE_TOOLTIP } from "@/lib/ui/words";
import { COPIED_MS, copyViewLabel, viewUrl } from "@/lib/intake/copy-view";

/** `?reply=` has no chip of its own; the chip below appears ONLY while the filter is active, says what it does, and clears it. */
const REPLY_LABEL: Record<ReplyState, string> = { replied: "Waiting on us", awaiting: "Waiting on them", unknown: "No reply state" };

const TEMP_OPTIONS: Array<{ value: TempFilter; label: string }> = [
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
  { value: "none", label: NOT_RATED },
];
const AGENT_OPTIONS: Array<{ value: AgentMoveFilter; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
];

/**
 * The control rows. Row one: the sets (Working · Event contacts · Not started · All open · Nurture · Lost), each with its
 * count; a chip with nothing in it is not drawn. Chips for the sets already in the browser switch in place; Lost (its own
 * read) and every chip while viewing Lost are plain links. Row two: Stage, Owner, Source and Temperature menus, then the
 * chips that count something inside the chosen set (Moved automatically, Needs a stage decision, Needs attorney,
 * Suggestions), each drawn only while its count is above zero (or it is on), and Copy link.
 */
export default function IntakeControls({
  filters,
  view,
  group,
  stages,
  members,
  setChips,
  counts,
  currentHref,
  setHref,
  lostView,
  showOwnerFilter,
  onSet,
  onFilters,
  onGroup,
  allOpenMatches = null,
}: {
  filters: IntakeFilters;
  view: IntakeView;
  group: IntakeGroup;
  /** The stages the Stage menu lists (those of the chosen set). */
  stages: Stage[];
  members: MemberIdentity[];
  setChips: SetChip[];
  counts: ChipCounts;
  currentHref: string;
  /** Where a set chip goes when it must navigate; null = switch in place. */
  setHref: (set: LeadSet) => string;
  /** Viewing the Lost set: every chip navigates (the rows on screen are lost leads). */
  lostView: boolean;
  /** Some lead in view has an owner (else the Owner filter has nothing to choose). */
  showOwnerFilter: boolean;
  onSet: (set: LeadSet) => void;
  onFilters: (next: IntakeFilters) => void;
  onGroup: (next: IntakeGroup) => void;
  /** While searching inside a set: how many matches All open has, when that is more than this set shows. */
  allOpenMatches?: number | null;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const selectedStage = stages.find((stage) => stage.id === filters.stage) ?? null;
  const selectedOwner =
    filters.owner === UNASSIGNED_OWNER ? "Unassigned" : (members.find((m) => m.userId === filters.owner)?.displayName ?? (filters.owner ? "Owner" : null));

  async function saveView() {
    const url = viewUrl(currentHref, typeof window === "undefined" ? null : window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const agentCount = counts.agent ? (filters.agent === "today" ? counts.agent.today : counts.agent.week) : 0;

  return (
    <>
      <nav className="ix-sets" aria-label="Which leads">
        {setChips.map((chip) => {
          const body = (
            <>
              {chip.label}
              {chip.count !== null && <span className="lp-chip-count">{chip.count}</span>}
            </>
          );
          const inPlace = !lostView && chip.set !== "lost";
          return inPlace ? (
            <button key={chip.set} type="button" className={chipClass(chip.active)} aria-pressed={chip.active} data-set={chip.set} onClick={() => onSet(chip.set)}>
              {body}
            </button>
          ) : (
            <Link key={chip.set} href={setHref(chip.set)} className={chipClass(chip.active)} aria-current={chip.active ? "page" : undefined} data-set={chip.set}>
              {body}
            </Link>
          );
        })}
      </nav>

      <div className="ix-filters">
        {view === "board" && (
          <div className="lp-chips" role="group" aria-label="Group by">
            <span className="lp-legend">Group by</span>
            <button type="button" className={chipClass(group === "stage")} aria-pressed={group === "stage"} onClick={() => onGroup("stage")}>
              By stage
            </button>
            <button type="button" className={chipClass(group === "owner")} aria-pressed={group === "owner"} onClick={() => onGroup("owner")}>
              By owner
            </button>
          </div>
        )}

        <Popover
          label="Filter by stage"
          trigger={({ onClick, ref, ...aria }) => (
            <button {...aria} ref={ref} type="button" onClick={onClick} className={chipClass(selectedStage !== null)}>
              {selectedStage ? stageLabelFor(selectedStage) : LEADS_STAGE_FILTER}
            </button>
          )}
        >
          {(close) => (
            <>
              <PopoverItem muted checked={filters.stage === null} onSelect={() => { close(); onFilters({ ...filters, stage: null }); }}>
                {LEADS_ANY_STAGE}
              </PopoverItem>
              {stages.map((stage) => (
                <PopoverItem key={stage.id} checked={filters.stage === stage.id} onSelect={() => { close(); onFilters({ ...filters, stage: stage.id }); }}>
                  {stageLabelFor(stage)}
                </PopoverItem>
              ))}
            </>
          )}
        </Popover>

        {(showOwnerFilter || filters.owner !== null) && (
        <Popover
          label="Filter by owner"
          width={210}
          trigger={({ onClick, ref, ...aria }) => (
            <button {...aria} ref={ref} type="button" onClick={onClick} className={chipClass(filters.owner !== null)}>
              {selectedOwner ?? "Owner"}
            </button>
          )}
        >
          {(close) => (
            <>
              <PopoverItem muted checked={filters.owner === null} onSelect={() => { close(); onFilters({ ...filters, owner: null }); }}>
                Anyone
              </PopoverItem>
              <PopoverItem checked={filters.owner === UNASSIGNED_OWNER} onSelect={() => { close(); onFilters({ ...filters, owner: UNASSIGNED_OWNER }); }}>
                Unassigned
              </PopoverItem>
              {members.map((member) => (
                <PopoverItem key={member.userId} checked={filters.owner === member.userId} onSelect={() => { close(); onFilters({ ...filters, owner: member.userId }); }}>
                  {memberLabel(member)}
                </PopoverItem>
              ))}
            </>
          )}
        </Popover>
        )}

        <Popover
          label="Filter by referral source"
          trigger={({ onClick, ref, ...aria }) => (
            <button {...aria} ref={ref} type="button" onClick={onClick} className={chipClass(filters.source.length > 0)}>
              {filters.source.length === 0 ? "Source" : filters.source.length === 1 ? filters.source[0] : `${filters.source.length} sources`}
            </button>
          )}
        >
          {(close) => (
            <>
              <PopoverItem muted checked={filters.source.length === 0} onSelect={() => { close(); onFilters({ ...filters, source: [] }); }}>
                Any source
              </PopoverItem>
              {REFERRAL_SOURCES.map((source) => (
                <PopoverItem
                  key={source}
                  checked={filters.source.includes(source)}
                  onSelect={() => onFilters({ ...filters, source: filters.source.includes(source) ? filters.source.filter((v) => v !== source) : [...filters.source, source] })}
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
            <button {...aria} ref={ref} type="button" onClick={onClick} className={chipClass(filters.temp !== null)} title={TEMPERATURE_TOOLTIP}>
              {filters.temp ? (TEMP_OPTIONS.find((o) => o.value === filters.temp)?.label ?? "Temperature") : "Temperature"}
            </button>
          )}
        >
          {(close) => (
            <>
              <PopoverItem muted checked={filters.temp === null} onSelect={() => { close(); onFilters({ ...filters, temp: null }); }}>
                Any temperature
              </PopoverItem>
              {TEMP_OPTIONS.map((option) => (
                <PopoverItem key={option.value} checked={filters.temp === option.value} onSelect={() => { close(); onFilters({ ...filters, temp: option.value }); }}>
                  {option.label}
                </PopoverItem>
              ))}
            </>
          )}
        </Popover>

        {counts.agent !== null && (agentCount > 0 || filters.agent) && (
          <Popover
            label="Filter by automatic moves"
            width={170}
            trigger={({ onClick, ref, ...aria }) => (
              <button {...aria} ref={ref} type="button" onClick={onClick} className={chipClass(Boolean(filters.agent))} title="Show only leads that were moved automatically, and that nobody has moved since.">
                {filters.agent ? `${MOVED_AUTOMATICALLY} · ${AGENT_OPTIONS.find((o) => o.value === filters.agent)?.label ?? ""}` : MOVED_AUTOMATICALLY}
                <span className="lp-chip-count">{agentCount}</span>
              </button>
            )}
          >
            {(close) => (
              <>
                <PopoverItem muted checked={!filters.agent} onSelect={() => { close(); onFilters({ ...filters, agent: null }); }}>
                  Any lead
                </PopoverItem>
                {AGENT_OPTIONS.map((option) => (
                  <PopoverItem key={option.value} checked={filters.agent === option.value} onSelect={() => { close(); onFilters({ ...filters, agent: option.value }); }}>
                    {option.label}
                    {" · "}
                    {counts.agent ? (option.value === "today" ? counts.agent.today : counts.agent.week) : 0}
                  </PopoverItem>
                ))}
              </>
            )}
          </Popover>
        )}

        {counts.decision !== null && (counts.decision > 0 || filters.decision) && (
          <button type="button" className={chipClass(Boolean(filters.decision))} aria-pressed={Boolean(filters.decision)} title="Show only leads imported from Lawmatics whose stage nobody has chosen yet." onClick={() => onFilters({ ...filters, decision: filters.decision ? undefined : true })}>
            Needs a stage decision
            <span className="lp-chip-count">{counts.decision}</span>
          </button>
        )}

        {counts.needsAttorney !== null && (counts.needsAttorney > 0 || filters.needsRebecca) && (
          <button type="button" className={chipClass(filters.needsRebecca)} aria-pressed={filters.needsRebecca} title="Show only leads with a draft waiting for an attorney's review in the approval queue." onClick={() => onFilters({ ...filters, needsRebecca: !filters.needsRebecca })}>
            Needs attorney
            <span className="lp-chip-count">{counts.needsAttorney}</span>
          </button>
        )}

        {(counts.suggestions > 0 || filters.suggest) && (
          <button type="button" className={chipClass(Boolean(filters.suggest))} aria-pressed={Boolean(filters.suggest)} title={LEADS_SUGGESTIONS_TITLE} onClick={() => onFilters({ ...filters, suggest: filters.suggest ? undefined : true })}>
            {LEADS_SUGGESTIONS}
            <span className="lp-chip-count">{counts.suggestions}</span>
          </button>
        )}

        {(counts.duplicates > 0 || filters.dup) && (
          <button type="button" className={chipClass(Boolean(filters.dup))} aria-pressed={Boolean(filters.dup)} title={LEADS_DUPLICATES_TITLE} onClick={() => onFilters({ ...filters, dup: filters.dup ? undefined : true })}>
            {LEADS_DUPLICATES}
            <span className="lp-chip-count">{counts.duplicates}</span>
          </button>
        )}

        {allOpenMatches !== null && allOpenMatches > 0 && (
          <button type="button" className="lp-link-button" data-all-open-matches onClick={() => onSet("open")}>
            {LEADS_ALL_OPEN_MATCHES(allOpenMatches)}
          </button>
        )}

        {filters.reply !== null && (
          <button type="button" className={chipClass(true)} aria-label={`Clear the “${REPLY_LABEL[filters.reply]}” filter`} onClick={() => onFilters({ ...filters, reply: null })}>
            {REPLY_LABEL[filters.reply]}
            <span aria-hidden>×</span>
          </button>
        )}

        <button type="button" onClick={saveView} className="lp-link-button lp-chips-end">
          {copyViewLabel(copied)}
        </button>
      </div>
    </>
  );
}
