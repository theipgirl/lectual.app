import { compareStageOrder } from "@/lib/pipeline/stage-order";
import type { OwnerState } from "@/lib/views/layout/owner";
import {
  STAGE_BAD_CATEGORY,
  STAGE_BAD_OPEN,
  STAGE_BAD_WAITING_ON,
  STAGE_CHANGE_FAILED,
  STAGE_DELETED_SEQUENCES_NOTE,
  STAGE_GONE,
  STAGE_NAME_EMPTY,
  STAGE_OWNER_ONLY,
  STAGE_PLACE_GONE,
  stageNameTooLong,
} from "@/lib/ui/words";
import { isStageLockError, stageErrorSentence } from "./errors";

/**
 * Stage management from a Board's header (spec-editable-views.md 3b): rename, move beside a visible neighbour, add beside one, change
 * a lead stage's category or a matter stage's open/closed (only while empty), and delete with a move. Every change is ONE call to a
 * lectual 0119 SECURITY DEFINER function through the caller's SCOPED client; the database holds every rule (owner membership row,
 * renumbering, last open / last won, roles, "records changed since the dialog opened"). This file only:
 *   - re-asks the caller's owner MEMBERSHIP ROW first (never the role claim) and refuses everyone else before any read;
 *   - turns "beside this column, on this side" into the function's 0-based position, from the firm's stage list it READS ITSELF
 *     (the browser never sends a position);
 *   - passes the delete dialog's record ids through unchanged (`p_expected_ids`: the database refuses when they changed);
 *   - retries ONCE on a deadlock or lock error, then answers a fixed sentence; maps every refusal to a fixed sentence (errors.ts);
 *   - after a lead-stage delete, runs for the moved leads the SAME sequence-stop a person's move into that destination runs
 *     (`stopSequences`, today: only into a won stage). It does NOT run `stage_changed` automation rules: nobody chose a new stage
 *     for these leads (0119's recommendation). Their timeline rows carry `stage_deleted: true`, which the Working rule skips.
 * Pure over injected dependencies, so it is tested without a database.
 */

export type StageKind = "lead" | "matter";

export type ManagedStage = {
  id: string;
  name: string;
  order_index: number | null;
  category?: string | null;
  is_open?: boolean | null;
  /** A matter stage's docket phase; absent when the database has no `phase` column. */
  phase?: string | null;
};

export type StageResult = { ok: true; note?: string } | { ok: false; error: string };

export type StageDeps = {
  owner: () => Promise<OwnerState>;
  /** The firm's stages of this kind, through the scoped client. null = couldn't be read. */
  readStages: (kind: StageKind) => Promise<ManagedStage[] | null>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  /** A person's move into `destination` stops sequences only when it is a won stage; true when that finished (or wasn't needed). */
  stopSequences: (leadIds: string[], destination: ManagedStage) => Promise<boolean>;
  revalidate: (kind: StageKind) => void;
};

const LEAD_CATEGORIES = ["open", "won", "lost", "nurture"] as const;
const WAITING_ON = ["firm", "client", "uspto", "court"] as const;
const PHASES = ["pipeline", "pre_filing", "post_filing", "maintenance", "inactive"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX: Record<StageKind, number> = { lead: 80, matter: 200 };

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isSide = (v: unknown): v is "left" | "right" => v === "left" || v === "right";
const fail = (error: string): StageResult => ({ ok: false, error });

/** The firm's stages in the one order the functions use (order_index, then name, then id; a matter stage's name is its label). */
export function orderedIds(stages: readonly ManagedStage[]): string[] {
  return [...stages].sort(compareStageOrder).map((s) => s.id);
}

/**
 * The 0-based place for `crm_*_move` / `crm_*_add`: beside `neighbour` on `side`, in the list the function builds (without the stage
 * being moved; the whole list for an add). null when the neighbour (or the moved stage) is not in the list.
 */
export function placeBeside(ordered: readonly string[], neighbour: string, side: "left" | "right", moving: string | null = null): number | null {
  if (moving !== null && !ordered.includes(moving)) return null;
  const list = moving === null ? ordered : ordered.filter((id) => id !== moving);
  const at = list.indexOf(neighbour);
  if (at < 0) return null;
  return side === "left" ? at : at + 1;
}

function cleanName(value: unknown, kind: StageKind): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { ok: false, error: STAGE_NAME_EMPTY };
  if (name.length > NAME_MAX[kind]) return { ok: false, error: stageNameTooLong(NAME_MAX[kind]) };
  return { ok: true, name };
}

const FN = {
  lead: { add: "crm_stage_add", rename: "crm_stage_rename", move: "crm_stage_move", type: "crm_stage_set_category", delete: "crm_stage_delete" },
  matter: { add: "crm_matter_stage_add", rename: "crm_matter_stage_rename", move: "crm_matter_stage_move", type: "crm_matter_stage_set_open", delete: "crm_matter_stage_delete" },
} as const;

/** One call, retried once on a deadlock / lock error. */
async function call(deps: StageDeps, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
  let out: { data: unknown; error: unknown };
  try {
    out = await deps.rpc(fn, args);
  } catch (e) {
    out = { data: null, error: e };
  }
  if (!out.error || !isStageLockError(out.error)) return out;
  try {
    return await deps.rpc(fn, args);
  } catch (e) {
    return { data: null, error: e };
  }
}

type DeleteResult = { destination?: unknown; moved_ids?: unknown };

/** Run one stage operation. `kind` and `input` come from the browser and are checked here; nothing else is trusted. */
export async function changeStage(deps: StageDeps, kindIn: unknown, input: unknown): Promise<StageResult> {
  // The owner row first, before any read or write. Unreadable is no.
  let owner: OwnerState;
  try {
    owner = await deps.owner();
  } catch {
    owner = "unreadable";
  }
  if (owner !== "owner") return fail(STAGE_OWNER_ONLY);

  const kind: StageKind | null = kindIn === "lead" || kindIn === "matter" ? kindIn : null;
  if (!kind || !input || typeof input !== "object") return fail(STAGE_CHANGE_FAILED);
  const op = input as Record<string, unknown>;
  const fns = FN[kind];

  let result: { data: unknown; error: unknown };
  let stages: ManagedStage[] | null = null;
  const needStages = async (): Promise<ManagedStage[] | null> => {
    if (stages === null) {
      try {
        stages = await deps.readStages(kind);
      } catch {
        stages = null;
      }
    }
    return stages;
  };

  switch (op.op) {
    case "rename": {
      if (!isUuid(op.stageId)) return fail(STAGE_GONE);
      const name = cleanName(op.name, kind);
      if (!name.ok) return fail(name.error);
      result = await call(deps, fns.rename, kind === "lead" ? { p_stage: op.stageId, p_name: name.name } : { p_stage: op.stageId, p_label: name.name });
      break;
    }
    case "move": {
      if (!isUuid(op.stageId) || !isUuid(op.beside) || !isSide(op.side) || op.stageId === op.beside) return fail(STAGE_PLACE_GONE);
      const list = await needStages();
      if (!list) return fail(STAGE_CHANGE_FAILED);
      const position = placeBeside(orderedIds(list), op.beside, op.side, op.stageId);
      if (position === null) return fail(STAGE_PLACE_GONE);
      result = await call(deps, fns.move, { p_stage: op.stageId, p_position: position });
      break;
    }
    case "add": {
      if (!isUuid(op.beside) || !isSide(op.side)) return fail(STAGE_PLACE_GONE);
      const name = cleanName(op.name, kind);
      if (!name.ok) return fail(name.error);
      const list = await needStages();
      if (!list) return fail(STAGE_CHANGE_FAILED);
      const position = placeBeside(orderedIds(list), op.beside, op.side);
      if (position === null) return fail(STAGE_PLACE_GONE);
      if (kind === "lead") {
        const category = op.category ?? "open";
        if (!(LEAD_CATEGORIES as readonly unknown[]).includes(category)) return fail(STAGE_BAD_CATEGORY);
        result = await call(deps, fns.add, { p_name: name.name, p_position: position, p_category: category });
      } else {
        if (typeof op.isOpen !== "boolean") return fail(STAGE_BAD_OPEN);
        const waitingOn = op.waitingOn ?? "firm";
        if (!(WAITING_ON as readonly unknown[]).includes(waitingOn)) return fail(STAGE_BAD_WAITING_ON);
        // A new matter stage takes its neighbour's docket phase, so it lands in the same group; none when the database has no phase.
        const phase = list.find((s) => s.id === op.beside)?.phase;
        const args: Record<string, unknown> = { p_label: name.name, p_position: position, p_is_open: op.isOpen, p_waiting_on: waitingOn };
        if (typeof phase === "string" && (PHASES as readonly string[]).includes(phase)) args.p_phase = phase;
        result = await call(deps, fns.add, args);
      }
      break;
    }
    case "category": {
      if (kind !== "lead") return fail(STAGE_CHANGE_FAILED);
      if (!isUuid(op.stageId)) return fail(STAGE_GONE);
      if (!(LEAD_CATEGORIES as readonly unknown[]).includes(op.category)) return fail(STAGE_BAD_CATEGORY);
      result = await call(deps, fns.type, { p_stage: op.stageId, p_category: op.category, p_confirm_no_won: op.confirmNoWon === true });
      break;
    }
    case "open": {
      if (kind !== "matter") return fail(STAGE_CHANGE_FAILED);
      if (!isUuid(op.stageId)) return fail(STAGE_GONE);
      if (typeof op.isOpen !== "boolean") return fail(STAGE_BAD_OPEN);
      result = await call(deps, fns.type, { p_stage: op.stageId, p_is_open: op.isOpen });
      break;
    }
    case "delete": {
      if (!isUuid(op.stageId)) return fail(STAGE_GONE);
      // The ids the dialog showed, passed through as they came: the database compares them with who is in the stage now.
      const ids = Array.isArray(op.expectedIds) ? op.expectedIds : null;
      if (!ids || ids.length > 5000 || !ids.every(isUuid)) return fail(stageErrorSentence({ message: "stage_delete_bad_ids:" }, kind));
      const destination = op.destination === null || op.destination === undefined || op.destination === "" ? null : op.destination;
      if (destination !== null && !isUuid(destination)) return fail(stageErrorSentence({ message: "stage_delete_bad_destination:" }, kind));
      const roleTo = op.roleTo === null || op.roleTo === undefined || op.roleTo === "" ? null : op.roleTo;
      if (roleTo !== null && !isUuid(roleTo)) return fail(stageErrorSentence({ message: "stage_delete_bad_destination:" }, kind));
      // Read before the delete: after it, the destination's category is what decides the sequence stop.
      const before = kind === "lead" && ids.length > 0 ? await needStages() : null;
      const args: Record<string, unknown> = { p_stage: op.stageId, p_destination: destination, p_expected_ids: ids, p_role_to: roleTo };
      if (kind === "lead") args.p_confirm_no_won = op.confirmNoWon === true;
      else args.p_confirm_open_change = op.confirmOpenChange === true;
      result = await call(deps, fns.delete, args);
      if (result.error) return fail(stageErrorSentence(result.error, kind));
      deps.revalidate(kind);
      if (kind === "lead") {
        const data = (result.data ?? {}) as DeleteResult;
        const moved = Array.isArray(data.moved_ids) ? data.moved_ids.filter(isUuid) : [];
        const destId = typeof data.destination === "string" ? data.destination : null;
        const dest = destId ? (before ?? []).find((s) => s.id === destId) : undefined;
        if (moved.length > 0) {
          // The destination couldn't be identified: say so rather than guess whether sequences should have stopped.
          if (!dest) return { ok: true, note: STAGE_DELETED_SEQUENCES_NOTE };
          let stopped = false;
          try {
            stopped = await deps.stopSequences(moved, dest);
          } catch {
            stopped = false;
          }
          if (!stopped) return { ok: true, note: STAGE_DELETED_SEQUENCES_NOTE };
        }
      }
      return { ok: true };
    }
    default:
      return fail(STAGE_CHANGE_FAILED);
  }

  if (result.error) return fail(stageErrorSentence(result.error, kind));
  deps.revalidate(kind);
  return { ok: true };
}
