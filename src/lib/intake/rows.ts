import type { Lead, Stage } from "@/lib/pipeline";
// Type-only import: @/lib/members/directory is `import "server-only"`, but a
// `import type` is erased at compile time, so nothing from it reaches the
// client bundle this module is part of.
import type { MemberIdentity } from "@/lib/members/directory";
import { deriveTemperature, lastTouchAt, type Temperature, type TemperatureResult } from "./temperature";
import { replyState, type ReplyState } from "./reply";
import { REFERRAL_SOURCES } from "./referral-source";

/**
 * Pure view-model for /intake (blueprint §7, re-homed by §11): row building,
 * filters, sorting, the URL state and the KPI counts. No getScopedClient, no
 * next/* imports — this is imported by the client components in
 * src/app/(intake)/intake/_components, and it is the whole reason the page's
 * logic is testable without a database (tests/intake/rows.test.ts).
 *
 * The ARRANGEMENT of these rows — the two boards, the next-step line, the
 * top-bar counts — lives next door in views.ts.
 *
 * Deliberately NOT re-exported from src/lib/intake/index.ts: that barrel is a
 * sibling's and covers the four §4 domain modules only. Import this module by
 * path.
 *
 * Every function takes `now` where it needs the clock, so nothing here reads
 * Date.now() and every assertion in the tests is deterministic — same rule
 * temperature.ts follows.
 */

const DEFAULT_AGING_THRESHOLD_DAYS = 7;

export type IntakeRow = {
  lead: Lead;
  /** The lead's stage row, or null when the stage is missing from the list. */
  stage: Stage | null;
  temperature: TemperatureResult;
  reply: ReplyState;
  /** greatest(last_activity_at, last_outbound_at, last_inbound_at), or null. */
  lastTouchAt: string | null;
  daysInStage: number;
  /** Resolved from the member directory; null when unassigned or unresolvable. */
  owner: MemberIdentity | null;
  /** Latest timeline note text for this lead, already trimmed. Null = none loaded. */
  latestNote: string | null;
  /** Past this stage's aging threshold — the "Stale" KPI. */
  stale: boolean;
};

/** Special `owner` filter value meaning "nobody is on the hook for this one". */
export const UNASSIGNED_OWNER = "unassigned";

export type IntakeFilters = {
  /** Canonical referral buckets (§4.2). Empty = no source filter. */
  source: string[];
  temp: Temperature | null;
  /** A member user id, or UNASSIGNED_OWNER. */
  owner: string | null;
  /** A crm_stage id. */
  stage: string | null;
  reply: ReplyState | null;
  /** Free text over name / business / email / mark / referral detail / note. */
  q: string;
};

export const EMPTY_INTAKE_FILTERS: IntakeFilters = {
  source: [],
  temp: null,
  owner: null,
  stage: null,
  reply: null,
  q: "",
};

/** The shape Next hands a page as `searchParams` (already awaited). */
export type IntakeSearchParams = Record<string, string | string[] | undefined>;

const TEMPERATURES: readonly Temperature[] = ["hot", "warm", "cold"];
const REPLY_STATES: readonly ReplyState[] = ["replied", "awaiting", "unknown"];

function firstValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return (raw[0] ?? "").trim();
  return (raw ?? "").trim();
}

/**
 * Multi-value params accept BOTH repeats (`?source=UGW&source=Event`) and a
 * comma list (`?source=UGW,Event`) — a bookmarked Monday view gets typed and
 * pasted by hand, and both spellings are the obvious thing to try.
 */
function allValues(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return parts
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * URL → filters. Unrecognised values are dropped rather than passed through:
 * `?temp=lukewarm` must render the unfiltered view, never an empty table that
 * looks like "nobody is in intake".
 */
export function parseIntakeFilters(params: IntakeSearchParams): IntakeFilters {
  const known = new Set<string>(REFERRAL_SOURCES);
  const source = allValues(params.source).filter((value) => known.has(value));

  const temp = firstValue(params.temp) as Temperature;
  const reply = firstValue(params.reply) as ReplyState;
  const owner = firstValue(params.owner);
  const stage = firstValue(params.stage);

  return {
    source,
    temp: TEMPERATURES.includes(temp) ? temp : null,
    owner: owner === "" ? null : owner,
    stage: stage === "" ? null : stage,
    reply: REPLY_STATES.includes(reply) ? reply : null,
    q: firstValue(params.q),
  };
}

/**
 * Filters → query string (no leading "?"), for the client's history push.
 * Empty filters produce "", which is what makes "clear all" land on a clean
 * /intake URL instead of a trail of empty params.
 */
export function filtersToQueryString(filters: IntakeFilters): string {
  const params = new URLSearchParams();
  for (const source of filters.source) params.append("source", source);
  if (filters.temp) params.set("temp", filters.temp);
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.reply) params.set("reply", filters.reply);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  return params.toString();
}

/**
 * Which arrangement is on screen (blueprint §11). Three views, one list: the
 * table is the list, the two boards are questions asked of it, and all three
 * read the same rows through the same filters.
 */
export type IntakeView = "table" | "board";

/** What a board groups by. Ignored by the table, but kept in the URL so
 * flipping back to Board lands on the grouping you left. */
export type IntakeGroup = "stage" | "owner";

export type IntakeViewState = { view: IntakeView; group: IntakeGroup };

export const DEFAULT_VIEW_STATE: IntakeViewState = { view: "table", group: "stage" };

const VIEWS: readonly IntakeView[] = ["table", "board"];
const GROUPS: readonly IntakeGroup[] = ["stage", "owner"];

/**
 * URL → view state. Same rule as parseIntakeFilters: an unrecognised value
 * falls back to the default rather than rendering nothing, because
 * `?view=kanban` should show the list, not a blank screen.
 */
export function parseIntakeViewState(params: IntakeSearchParams): IntakeViewState {
  const view = firstValue(params.view) as IntakeView;
  const group = firstValue(params.group) as IntakeGroup;
  return {
    view: VIEWS.includes(view) ? view : DEFAULT_VIEW_STATE.view,
    group: GROUPS.includes(group) ? group : DEFAULT_VIEW_STATE.group,
  };
}

/**
 * Filters + view → the query string for the whole surface (no leading "?").
 *
 * The defaults are omitted rather than spelled out, so the unfiltered table is
 * the bare `/intake` — which is what makes "Save this view" produce a link
 * worth pasting instead of a paragraph of defaults.
 */
export function intakeQueryString(filters: IntakeFilters, viewState: IntakeViewState): string {
  const params = new URLSearchParams(filtersToQueryString(filters));
  if (viewState.view !== DEFAULT_VIEW_STATE.view) params.set("view", viewState.view);
  // The group only means anything on a board; carrying it on the table URL
  // would put a param in the saved link that changes nothing a reader can see.
  if (viewState.view === "board" && viewState.group !== DEFAULT_VIEW_STATE.group) {
    params.set("group", viewState.group);
  }
  return params.toString();
}

/** The full path for a view — what "Save this view" copies and the router pushes. */
export function intakeHref(filters: IntakeFilters, viewState: IntakeViewState): string {
  const query = intakeQueryString(filters, viewState);
  return query ? `/dashboard/intake/?${query}` : "/dashboard/intake/";
}

/** URLSearchParams → the record shape parseIntakeFilters reads (client side). */
export function searchParamsToRecord(search: URLSearchParams): IntakeSearchParams {
  const record: IntakeSearchParams = {};
  for (const key of Array.from(new Set(search.keys()))) {
    record[key] = search.getAll(key);
  }
  return record;
}

export type BuildIntakeRowsInput = {
  leads: Lead[];
  stages: Stage[];
  members: MemberIdentity[];
  /** lead id → latest note text. Absent keys render "—"; see the page. */
  latestNoteByLeadId?: Record<string, string>;
  now: Date;
};

function daysBetween(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

/**
 * Leads + stages + members → the rows the table renders.
 *
 * `stale` is computed here rather than reusing isStaleLead() from
 * @/lib/pipeline/board: that helper reads Date.now() internally, and every
 * number on this page has to be derived from the injected `now` so the KPI
 * strip and the row it counts can never disagree.
 */
export function buildIntakeRows(input: BuildIntakeRowsInput): IntakeRow[] {
  const { leads, stages, members, latestNoteByLeadId = {}, now } = input;
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const memberById = new Map(members.map((member) => [member.userId, member]));

  return leads.map((lead) => {
    const stage = stageById.get(lead.current_stage_id) ?? null;
    const daysInStage = daysBetween(lead.stage_entered_at, now) ?? 0;
    const threshold = stage?.aging_threshold_days ?? null;

    return {
      lead,
      stage,
      temperature: deriveTemperature(lead, stages, now),
      reply: replyState(lead),
      lastTouchAt: lastTouchAt(lead),
      daysInStage,
      owner: lead.assigned_to ? (memberById.get(lead.assigned_to) ?? null) : null,
      latestNote: latestNoteByLeadId[lead.id]?.trim() || null,
      stale: threshold != null && daysInStage > threshold,
    };
  });
}

/** Everything the free-text box searches, lower-cased and joined. */
function haystack(row: IntakeRow): string {
  const lead = row.lead;
  return [
    lead.first_name,
    lead.last_name,
    lead.business_name,
    lead.email,
    lead.mark_text,
    lead.referral_source,
    lead.referral_detail,
    lead.nurture_campaign,
    row.stage?.name,
    row.owner?.displayName,
    row.owner?.email,
    row.latestNote,
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ")
    .toLowerCase();
}

/**
 * Applies every active filter. AND across the controls, OR within the
 * multi-select Source — "UGW or Melanin Money, that are hot" is the question
 * the firm actually asks on a Monday.
 */
export function applyFilters(rows: IntakeRow[], filters: IntakeFilters): IntakeRow[] {
  const query = filters.q.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.source.length > 0) {
      // A lead with no referral_source is not silently bucketed as Inbound
      // here: classifyReferralSource owns that decision at import time, and
      // inventing it at read time would make the filter disagree with the
      // Source column the user is looking at.
      if (!row.lead.referral_source || !filters.source.includes(row.lead.referral_source)) {
        return false;
      }
    }
    if (filters.temp && row.temperature.level !== filters.temp) return false;
    if (filters.owner) {
      if (filters.owner === UNASSIGNED_OWNER) {
        if (row.lead.assigned_to) return false;
      } else if (row.lead.assigned_to !== filters.owner) {
        return false;
      }
    }
    if (filters.stage && row.lead.current_stage_id !== filters.stage) return false;
    if (filters.reply && row.reply !== filters.reply) return false;
    if (query && !haystack(row).includes(query)) return false;
    return true;
  });
}

export type SortKey =
  | "lead"
  | "stage"
  | "temp"
  | "source"
  | "owner"
  | "nurture"
  | "reply"
  | "lastTouch"
  | "age"
  | "notes";

export type SortDir = "asc" | "desc";

/**
 * Default sort (§7): temperature descending — hot first — and, inside a
 * temperature band, whoever has been waiting longest. That is the reading
 * order of a Monday triage: the people most likely to sign, oldest first.
 */
export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: "temp", dir: "desc" };

const TEMP_RANK: Record<Temperature, number> = { cold: 0, warm: 1, hot: 2 };
const REPLY_RANK: Record<ReplyState, number> = { unknown: 0, awaiting: 1, replied: 2 };

/** Milliseconds, or null when the stamp is missing/unparseable. */
function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function leadName(row: IntakeRow): string {
  return `${row.lead.first_name} ${row.lead.last_name}`.trim().toLowerCase();
}

/**
 * "Longest awaiting" — the tiebreak under every sort. The oldest touch sorts
 * first, and a lead nobody has ever touched sorts first of all: never-contacted
 * is the longest wait there is, not a missing value to shuffle to the bottom.
 */
function awaitingCompare(a: IntakeRow, b: IntakeRow): number {
  const at = timeOf(a.lastTouchAt);
  const bt = timeOf(b.lastTouchAt);
  if (at === bt) return 0;
  if (at === null) return -1;
  if (bt === null) return 1;
  return at - bt;
}

/** Per-key value extractor: a comparable, or null for "this row has no value". */
function sortValue(row: IntakeRow, key: SortKey): string | number | null {
  switch (key) {
    case "lead":
      return leadName(row) || null;
    case "stage":
      return row.stage?.order_index ?? null;
    case "temp":
      return TEMP_RANK[row.temperature.level];
    case "source":
      return row.lead.referral_source?.toLowerCase() ?? null;
    case "owner":
      return row.owner?.displayName?.toLowerCase() ?? row.owner?.email?.toLowerCase() ?? null;
    case "nurture":
      return timeOf(row.lead.nurture_last_sent_at);
    case "reply":
      return REPLY_RANK[row.reply];
    case "lastTouch":
      return timeOf(row.lastTouchAt);
    case "age":
      return row.daysInStage;
    case "notes":
      return row.latestNote?.toLowerCase() ?? null;
  }
}

/**
 * Sorts a copy of `rows` (never mutates the input).
 *
 * Rows with no value for the active column always sink to the bottom,
 * whichever direction is selected — flipping "Nurture" ascending shouldn't
 * fill the top of the table with a wall of em-dashes.
 */
export function sortRows(rows: IntakeRow[], key: SortKey, dir: SortDir): IntakeRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);

    if (av === null && bv !== null) return 1;
    if (av !== null && bv === null) return -1;

    if (av !== null && bv !== null && av !== bv) {
      const raw = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? raw : -raw;
    }

    const awaiting = awaitingCompare(a, b);
    if (awaiting !== 0) return awaiting;
    return leadName(a).localeCompare(leadName(b));
  });
}

export type IntakeKpis = {
  hot: number;
  warm: number;
  cold: number;
  /** They replied and we haven't answered — "awaiting OUR reply". */
  awaitingUs: number;
  unassigned: number;
  stale: number;
};

/**
 * KPI counts for whatever rows are passed in — the caller passes the FILTERED
 * rows, so the strip always describes the table underneath it (§7).
 *
 * "Awaiting our reply" is `replyState === 'replied'`: the lead spoke last, so
 * the ball is in the firm's court. Not to be confused with the Replied
 * filter's `awaiting`, which is the firm waiting on the lead.
 */
export function computeIntakeKpis(rows: IntakeRow[]): IntakeKpis {
  return {
    hot: rows.filter((row) => row.temperature.level === "hot").length,
    warm: rows.filter((row) => row.temperature.level === "warm").length,
    cold: rows.filter((row) => row.temperature.level === "cold").length,
    awaitingUs: rows.filter((row) => row.reply === "replied").length,
    unassigned: rows.filter((row) => !row.lead.assigned_to).length,
    stale: rows.filter((row) => row.stale).length,
  };
}

/** Aging threshold actually in force for a stage — for the "Stale" tooltip. */
export function agingThresholdOf(stage: Stage | null): number {
  return stage?.aging_threshold_days ?? DEFAULT_AGING_THRESHOLD_DAYS;
}
