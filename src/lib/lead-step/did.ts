import { PREP_SOURCE } from "@/lib/agents/consult-prep/constants";
import { PREP_SEND_SOURCE } from "@/lib/consult-prep/keys";
import { FOLLOW_UP_SOURCE } from "@/lib/agents/morning-brief/constants";
import { CONSULT_PROPOSAL_SOURCE } from "@/lib/consult-proposal/source";
import { AGENT_ACTOR, REVIEW_SOURCE, SUGGESTION_SOURCE, isAgentMoveRow, parseAgentMove, parseSuggestion, undoStateFor, type ActivityRow, type UndoState } from "@/lib/stage-keeper/moves";
import {
  LEAD_STEP_DID_CREATED,
  LEAD_STEP_DID_DRAFT,
  LEAD_STEP_DID_FILED_IN,
  LEAD_STEP_DID_FILED_OUT,
  LEAD_STEP_DID_FIRST_READ,
  LEAD_STEP_DID_FOLLOW_UP,
  LEAD_STEP_DID_FROM_EMAILS,
  LEAD_STEP_DID_POST_CONSULT,
  LEAD_STEP_DID_PREP_BRIEF,
  LEAD_STEP_DID_PREP_EMAIL,
  LEAD_STEP_DID_PROPOSAL,
  LEAD_STEP_DID_SEQUENCE_STOPPED,
  leadStepDidSuggested,
  leadStepMoved,
} from "@/lib/ui/words";
import type { Read } from "./facts";

/**
 * "What Lectual did": the work the assistants and the system did on this lead, read from the timeline rows the lead
 * page already loads (the keeper and its merged leads, newest first). Pure.
 *
 * A row is Lectual's when its actor is not a person (`ai`, `system`, `automation`), or it is the Stage Keeper's move.
 * A person's own rows (notes, moves, approvals, a person's "Create proposal") are not listed here; the timeline has them.
 * A person's decision on a suggestion (`stage-keeper-review`) is the person's, so it is left out too.
 *
 * UNDO only where an undo already exists: the Stage Keeper's move (`undoAgentMoveAction`, its own rule
 * `undoStateFor`), on the lead's OWN rows (a merged lead's rows are history), only when the move recorded the stage it
 * came from (Undo puts the lead back there), for a role that may move stages and not for Lectual staff viewing as the
 * firm (the view model checks those two). Every other row has no Undo. No new undo write is invented.
 *
 * No database and no server-only import (tests/lead-step/hygiene.test.ts walks the import graph).
 */

export type DidUndo = { kind: "stage-move"; activityId: string; state: UndoState };

export type DidRow = {
  id: string;
  at: string;
  text: string;
  /** What produced it, for an icon or a tone; never drawn as text. */
  source: "stage-move" | "draft" | "insight" | "mail" | "created" | "sequence";
  /** Present only for a Stage Keeper move; `state` says whether Undo can be offered now. */
  undo: DidUndo | null;
};

/** `truncated`: the timeline read hit its row cap, so older work is not listed (said on the page, never hidden). */
export type DidList = { status: "ok"; rows: DidRow[]; truncated: boolean } | { status: "unavailable" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const NOT_A_PERSON = new Set(["ai", "system", "automation"]);

function draftText(payload: Record<string, unknown>): string {
  const source = payload.source;
  // Consult prep's markers: the client email draft, or the brief (`brief`, and `heads_up` from before the automatic prep).
  if (source === PREP_SOURCE) {
    switch (payload.kind) {
      case "client_prep":
        return LEAD_STEP_DID_PREP_EMAIL;
      case "brief":
      case "heads_up":
      default:
        return LEAD_STEP_DID_PREP_BRIEF;
    }
  }
  if (source === FOLLOW_UP_SOURCE) return LEAD_STEP_DID_FOLLOW_UP;
  if (source === CONSULT_PROPOSAL_SOURCE) return LEAD_STEP_DID_PROPOSAL;
  if (source === "post-consult") return LEAD_STEP_DID_POST_CONSULT;
  return LEAD_STEP_DID_DRAFT;
}

/** One line for a row, or null when the row is a person's (or isn't one this list shows). */
export function didLine(row: ActivityRow): Omit<DidRow, "undo"> | null {
  const p = obj(row.payload);
  if (isAgentMoveRow(row)) {
    const move = parseAgentMove(row);
    return { id: row.id, at: row.created_at, text: leadStepMoved(move?.toStage ?? null), source: "stage-move" };
  }
  if (!row.actor_type || !NOT_A_PERSON.has(row.actor_type)) return null;
  switch (row.type) {
    case "queue_drafted":
      return { id: row.id, at: row.created_at, text: draftText(p), source: "draft" };
    case "ai_insight": {
      if (p.source === REVIEW_SOURCE) return null;
      if (p.source === SUGGESTION_SOURCE) {
        const s = parseSuggestion({ id: row.id, type: row.type, created_at: row.created_at, payload: row.payload });
        return { id: row.id, at: row.created_at, text: leadStepDidSuggested(s?.toStage ?? null), source: "insight" };
      }
      if (p.source === "intake-triage") return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_FIRST_READ, source: "insight" };
      if (p.source === "email-intel") return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_FROM_EMAILS, source: "insight" };
      // Consult prep's send records (booked, 24h, 1h) are bookkeeping for the prep card, not a line in "What Lectual did".
      if (p.source === PREP_SEND_SOURCE) return null;
      return null;
    }
    case "email_received":
      return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_FILED_IN, source: "mail" };
    case "email_sent":
      return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_FILED_OUT, source: "mail" };
    case "lead_created":
      return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_CREATED, source: "created" };
    case "drip_stopped":
      return { id: row.id, at: row.created_at, text: LEAD_STEP_DID_SEQUENCE_STOPPED, source: "sequence" };
    default:
      return null;
  }
}

/**
 * The list, newest first. `leadId` is the keeper: only its own rows can be undone. `currentStageId` is where the
 * lead is now (an Undo is offered only while it is still where the assistant put it).
 */
export function readDid(activity: Read<{ rows: ActivityRow[]; truncated: boolean }>, leadId: string, currentStageId: string | null): DidList {
  if (activity.status !== "ok") {
    // Not-set-up does not happen for the timeline; anything but a read that worked is "couldn't load", never "nothing yet".
    return { status: "unavailable" };
  }
  const all = activity.value.rows;
  const own = all.filter((r) => !r.lead_id || r.lead_id === leadId);
  const rows: DidRow[] = [];
  for (const row of all) {
    const line = didLine(row);
    if (!line) continue;
    const isOwn = !row.lead_id || row.lead_id === leadId;
    const undo: DidUndo | null =
      line.source === "stage-move" && isOwn && obj(row.payload).actor === AGENT_ACTOR && parseAgentMove(row)?.fromStageId
        ? { kind: "stage-move", activityId: row.id, state: undoStateFor(own, row.id, currentStageId) }
        : null;
    rows.push({ ...line, undo });
  }
  rows.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.id.localeCompare(b.id));
  return { status: "ok", rows, truncated: activity.value.truncated };
}
