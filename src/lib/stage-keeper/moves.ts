import { civilDay, evidenceTooltip, monthDay } from "./format";
import { SIGNAL_LABEL, isSignalId, type MoveEvidence, type SignalId } from "./signals";

/**
 * The Stage Keeper's footprint on a lead's timeline, read back. Pure.
 *
 * Everything is a row of `crm_activity` (append-only): a move is a `stage_changed` row whose
 * payload names `agent:stage-keeper`; a suggestion is an `ai_insight` row with source
 * `stage-keeper`; a person's decision on one is a later `ai_insight` row with source
 * `stage-keeper-review`. The board chip, the "Agent moves" filter, the Agents-page count,
 * the timeline's Undo button and the reconcile screen all read through here, so they cannot
 * disagree about what the agent did.
 */

export const AGENT_ACTOR = "agent:stage-keeper";
export const SUGGESTION_SOURCE = "stage-keeper";
export const REVIEW_SOURCE = "stage-keeper-review";
export const SUGGESTION_KIND = "stage_suggestion";
/** The window the board chip and the 7 days filter look back over. */
export const AGENT_MOVE_DAYS = 7;
/** Where "N leads moved today" on the Agents page leads. */
export const AGENT_MOVES_TODAY_HREF = "/dashboard/intake/?view=board&agent=today";

const DAY_MS = 86_400_000;

export type ActivityRow = {
  id: string;
  lead_id?: string | null;
  type: string;
  actor_type?: string | null;
  created_at: string;
  payload: unknown;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseEvidence(raw: unknown): MoveEvidence | null {
  const e = obj(raw);
  if (e.kind === "mail" && typeof e.type === "string") {
    return {
      kind: "mail",
      type: e.type,
      direction: e.direction === "inbound" ? "inbound" : "outbound",
      at: str(e.at),
      subject: str(e.subject),
    };
  }
  if (e.kind === "calendar" && typeof e.starts_at === "string") return { kind: "calendar", title: str(e.title), starts_at: e.starts_at };
  if (e.kind === "payment") return { kind: "payment", at: str(e.at) };
  if (e.kind === "meeting" && typeof e.starts_at === "string") {
    return { kind: "meeting", provider: str(e.provider) ?? "meeting", title: str(e.title), starts_at: e.starts_at };
  }
  if (e.kind === "proposal" && typeof e.status === "string") {
    return { kind: "proposal", version: typeof e.version === "number" && Number.isFinite(e.version) ? e.version : null, status: e.status, at: str(e.at) };
  }
  if (e.kind === "queue" && typeof e.type === "string") return { kind: "queue", type: e.type, at: str(e.at) };
  return null;
}

const time = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};

// ── moves ────────────────────────────────────────────────────────────────────

export type AgentMove = {
  activityId: string;
  leadId: string | null;
  /** When the agent moved the lead (the row's own time). */
  at: string;
  fromStageId: string | null;
  toStageId: string | null;
  fromStage: string | null;
  toStage: string | null;
  signalKey: string | null;
  signal: SignalId | null;
  evidence: MoveEvidence | null;
  previousStageEnteredAt: string | null;
};

/** A `stage_changed` row written by the Stage Keeper. */
export function isAgentMoveRow(row: Pick<ActivityRow, "type" | "payload">): boolean {
  return row.type === "stage_changed" && obj(row.payload).actor === AGENT_ACTOR;
}

export function parseAgentMove(row: ActivityRow): AgentMove | null {
  if (!isAgentMoveRow(row)) return null;
  const p = obj(row.payload);
  return {
    activityId: row.id,
    leadId: row.lead_id ?? null,
    at: row.created_at,
    fromStageId: str(p.from_stage_id),
    toStageId: str(p.to_stage_id),
    fromStage: str(p.from_stage),
    toStage: str(p.to_stage),
    signalKey: str(p.signal_key),
    signal: isSignalId(p.signal) ? p.signal : null,
    evidence: parseEvidence(p.evidence),
    previousStageEnteredAt: str(p.previous_stage_entered_at),
  };
}

/**
 * Per lead, the agent move that is STILL the lead's latest stage change within the window. A
 * later stage change by anyone else (a person's move, an Undo, a quote acceptance) removes it,
 * and so does a later agent move that replaced it (the newer one is kept instead).
 */
export function currentAgentMoves(rows: readonly ActivityRow[], now: Date, windowDays: number = AGENT_MOVE_DAYS): Map<string, AgentMove> {
  const floor = now.getTime() - windowDays * DAY_MS;
  const latest = new Map<string, ActivityRow>();
  for (const row of rows) {
    if (row.type !== "stage_changed" || !row.lead_id) continue;
    const seen = latest.get(row.lead_id);
    if (!seen || time(row.created_at) > time(seen.created_at)) latest.set(row.lead_id, row);
  }
  const out = new Map<string, AgentMove>();
  for (const [leadId, row] of latest) {
    const move = parseAgentMove(row);
    if (move && time(move.at) >= floor) out.set(leadId, move);
  }
  return out;
}

/** The fact's own date, when its evidence carries one: a mail, proposal or approval date, or the day a held meeting began. */
export function evidenceOwnDate(evidence: MoveEvidence | null): string | null {
  if (!evidence) return null;
  if (evidence.kind === "calendar") return null;
  if (evidence.kind === "meeting") return evidence.starts_at;
  return evidence.at;
}

/** The date the chip shows: the evidence's own date, else the day the agent placed the lead. */
function chipDate(move: AgentMove, timeZone: string): string | null {
  const own = evidenceOwnDate(move.evidence);
  if (own) return monthDay(own, timeZone) ?? monthDay(move.at, timeZone);
  return monthDay(move.at, timeZone);
}

/** What the board and the table draw. Plain JSON, safe to hand to a client component. */
export type AgentMoveChip = {
  activityId: string;
  /** "Moved by agent · LOE sent Oct 20" */
  text: string;
  /** The board card's reason line: "Moved automatically · consult held Oct 23". */
  why: string;
  /** The evidence, as a sentence. */
  tooltip: string;
  movedAt: string;
  /** Moved on today's date in the firm's zone. */
  today: boolean;
};

/** "Consult held" -> "consult held"; "LOE sent" keeps its capitals. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export function chipFor(move: AgentMove, now: Date, timeZone: string): AgentMoveChip {
  const label = move.signal ? SIGNAL_LABEL[move.signal] : "Stage moved";
  const date = chipDate(move, timeZone);
  return {
    activityId: move.activityId,
    text: `Moved by agent · ${label}${date ? ` ${date}` : ""}`,
    why: `Moved automatically · ${lowerFirst(label)}${date ? ` ${date}` : ""}`,
    tooltip: evidenceTooltip(move.evidence, timeZone),
    movedAt: move.at,
    today: civilDay(move.at, timeZone) === civilDay(now.toISOString(), timeZone),
  };
}

export function chipsByLead(moves: ReadonlyMap<string, AgentMove>, now: Date, timeZone: string): Record<string, AgentMoveChip> {
  const out: Record<string, AgentMoveChip> = {};
  for (const [leadId, move] of moves) out[leadId] = chipFor(move, now, timeZone);
  return out;
}

/** The count behind "N leads moved today". The same set the Today filter keeps. */
export function movedTodayCount(chips: Readonly<Record<string, AgentMoveChip>>): number {
  return Object.values(chips).filter((c) => c.today).length;
}

// ── undo ─────────────────────────────────────────────────────────────────────

export type UndoState = "available" | "undone" | "moved-since" | "not-applicable";

/**
 * Whether a person can still undo this agent move: the lead must still be in the stage the
 * agent moved it to, nothing may have changed its stage since, and the move must not already
 * have been undone. `rows` are the lead's timeline rows (any order).
 */
export function undoStateFor(rows: readonly ActivityRow[], moveActivityId: string, currentStageId: string | null): UndoState {
  const row = rows.find((r) => r.id === moveActivityId);
  const move = row ? parseAgentMove(row) : null;
  if (!row || !move) return "not-applicable";
  const undone = rows.some((r) => r.type === "stage_changed" && obj(r.payload).undoes_activity_id === moveActivityId);
  if (undone) return "undone";
  const laterChange = rows.some((r) => r.id !== row.id && r.type === "stage_changed" && time(r.created_at) > time(row.created_at));
  if (laterChange || !currentStageId || currentStageId !== move.toStageId) return "moved-since";
  return "available";
}

// ── suggestions ──────────────────────────────────────────────────────────────

export type SuggestionWhy = "won" | "lost" | "nurture" | "welcome-or-payment" | "current-stage" | "recent-person-move" | "autonomy";

const WHY_VALUES: readonly SuggestionWhy[] = ["won", "lost", "nurture", "welcome-or-payment", "current-stage", "recent-person-move", "autonomy"];

export const WHY_TEXT: Record<SuggestionWhy, string> = {
  won: "This stage opens a matter, so a person decides.",
  lost: "This is a closing stage, so a person decides.",
  nurture: "This is a holding stage, so a person decides.",
  "welcome-or-payment": "A welcome or payment signal never moves a lead on its own.",
  "current-stage": "This lead is in a closing or holding stage, so the Stage Keeper only suggests.",
  "recent-person-move": "A person moved this lead in the last 7 days, so their placement stands.",
  autonomy: "This agent is set to suggest, so it left the move to a person.",
};

export type StageSuggestion = {
  activityId: string;
  leadId: string | null;
  at: string;
  fromStageId: string | null;
  toStageId: string | null;
  fromStage: string | null;
  toStage: string | null;
  why: SuggestionWhy | null;
  evidence: MoveEvidence | null;
  signalKey: string | null;
  signal: SignalId | null;
};

export function isSuggestionRow(row: Pick<ActivityRow, "type" | "payload">): boolean {
  const p = obj(row.payload);
  return row.type === "ai_insight" && p.source === SUGGESTION_SOURCE && p.kind === SUGGESTION_KIND;
}

export function parseSuggestion(row: ActivityRow): StageSuggestion | null {
  if (!isSuggestionRow(row)) return null;
  const p = obj(row.payload);
  return {
    activityId: row.id,
    leadId: row.lead_id ?? null,
    at: row.created_at,
    fromStageId: str(p.from_stage_id),
    toStageId: str(p.to_stage_id),
    fromStage: str(p.from_stage),
    toStage: str(p.to_stage),
    why: typeof p.why === "string" && (WHY_VALUES as readonly string[]).includes(p.why) ? (p.why as SuggestionWhy) : null,
    evidence: parseEvidence(p.evidence),
    signalKey: str(p.signal_key),
    signal: isSignalId(p.signal) ? p.signal : null,
  };
}

/** The ids of suggestions a person has already decided (accepted or dismissed). */
export function decidedSuggestionIds(rows: readonly ActivityRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const p = obj(r.payload);
    if (r.type === "ai_insight" && p.source === REVIEW_SOURCE && typeof p.suggestion_id === "string") out.add(p.suggestion_id);
  }
  return out;
}

/** Suggestions still waiting for a person, newest first. */
export function pendingStageSuggestions(rows: readonly ActivityRow[]): StageSuggestion[] {
  const decided = decidedSuggestionIds(rows);
  return rows
    .map(parseSuggestion)
    .filter((s): s is StageSuggestion => s !== null && s.toStageId !== null && !decided.has(s.activityId))
    .sort((a, b) => time(b.at) - time(a.at));
}

/** Every signal key an earlier move or suggestion (pending, accepted or dismissed) already used. */
export function consumedSignalKeys(rows: readonly ActivityRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const p = obj(r.payload);
    const key = str(p.signal_key);
    if (!key) continue;
    if (!isAgentMoveRow(r) && !isSuggestionRow(r)) continue;
    out.add(key);
    // The other signals the same decision accounted for (a held consult under a sent proposal).
    if (Array.isArray(p.also_signal_keys)) for (const also of p.also_signal_keys) if (typeof also === "string" && also) out.add(also);
  }
  return out;
}
