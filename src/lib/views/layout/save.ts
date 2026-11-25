import {
  LAYOUT_BAD_WIDTH,
  LAYOUT_CANT_MOVE,
  LAYOUT_CHANGED,
  LAYOUT_COLUMN_GONE,
  LAYOUT_COLUMN_PINNED,
  LAYOUT_COLUMN_TAKEN,
  LAYOUT_LAST_COLUMN,
  LAYOUT_NAME_CHARACTERS,
  LAYOUT_NAME_EMPTY,
  LAYOUT_NAME_TOO_LONG,
  LAYOUT_NOT_READY,
  LAYOUT_OWNER_ONLY,
  LAYOUT_READ_FAILED,
  LAYOUT_SAVE_FAILED,
  LAYOUT_STAGE_BOARD_HIDE_ONLY,
  LAYOUT_TOO_MANY,
} from "@/lib/ui/words";
import { isStageBoardView } from "./stage-columns";
import { layoutOf, resolveLayout } from "./apply";
import { insertColumn, moveColumn, moveColumnBeside, moveColumnTo, renameColumn, setHidden, setWidth, type Next, type NextRefusal } from "./next";
import { isOwner, type OwnerState } from "./owner";
import type { LayoutRead } from "./state";
import type { Layout, LayoutDefault, ViewKey } from "./types";
import { isLayoutKey, isViewKey, parseLayout } from "./validate";

/**
 * Changing a view's layout: the logic behind the owner's column menu (`actions.ts` holds the thin `"use server"` wrappers). Pure over
 * injected dependencies, so every rule is tested without a database.
 *
 * The browser sends an OPERATION (rename, hide, move, width, insert) and the `rev` it drew from, never a layout. The server re-resolves
 * the caller as an owner MEMBERSHIP ROW (Lectual staff acting in a firm are refused), re-reads the saved layout, builds the next layout
 * from it with the step-2 helpers (`next.ts`) over the columns this viewer has (`base`), validates it (`parseLayout`) and writes:
 * an insert when there is no row yet (a 23505 means another owner got there first: re-read and try once more), else an update fenced on
 * `rev` (0 rows = "Someone else changed this view"). Never an upsert: its conflict update would name columns with no UPDATE grant.
 * Every answer is a fixed sentence; no database text is ever returned.
 */

export type LayoutOp =
  | { op: "rename"; key: string; label: string }
  | { op: "hide"; key: string }
  | { op: "show"; key: string }
  | { op: "move"; key: string; dir: "left" | "right" }
  | { op: "moveTo"; key: string; index: number }
  | { op: "moveBeside"; key: string; relativeTo: string; side: "left" | "right" }
  | { op: "width"; key: string; px: number | null }
  | { op: "insert"; key: string; label?: string | null; relativeTo: string; side: "left" | "right" };

export type LayoutResult = { ok: true; /** The rev the view is at now. */ rev: number } | { ok: false; error: string };

/** What the columns of a view are for this viewer, in default order; a `pinned` one holds the first places and never hides. */
export type LayoutBase = { defaults: readonly LayoutDefault[] };

/** The database's answer to a write: only the error's `code` is ever read. */
export type WriteAnswer = { error: unknown | null; /** The rev after an update; null when the fence matched no row. */ rev?: number | null };

export type SaveDeps = {
  /** The caller's own membership row. Asked on EVERY call, before anything else. */
  owner: () => Promise<OwnerState>;
  /** The firm's active org id, for the insert (the policy's own check backs it up). */
  orgId: () => Promise<string | null>;
  /** The saved layout and its rev, three-state (`readViewLayout`). */
  read: (view: ViewKey) => Promise<LayoutRead>;
  /** The columns this viewer may have for the view; null when they could not be worked out. */
  base: (view: ViewKey) => Promise<LayoutBase | null>;
  insert: (view: ViewKey, orgId: string, columns: Layout) => Promise<WriteAnswer>;
  /** The update, fenced on the rev the caller read. */
  update: (view: ViewKey, columns: Layout, rev: number) => Promise<WriteAnswer>;
  revalidate: () => void;
};

const MISSING = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);
const codeOf = (e: unknown): string | null => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : null);
const fail = (error: string): LayoutResult => ({ ok: false, error });

const REFUSALS: Record<NextRefusal, string> = {
  "unknown-column": LAYOUT_COLUMN_GONE,
  pinned: LAYOUT_COLUMN_PINNED,
  "last-column": LAYOUT_LAST_COLUMN,
  "too-many": LAYOUT_TOO_MANY,
  "bad-key": LAYOUT_SAVE_FAILED,
  "key-taken": LAYOUT_COLUMN_TAKEN,
  "empty-label": LAYOUT_NAME_EMPTY,
  "label-too-long": LAYOUT_NAME_TOO_LONG,
  "label-characters": LAYOUT_NAME_CHARACTERS,
  "nothing-to-move": LAYOUT_CANT_MOVE,
  "bad-width": LAYOUT_BAD_WIDTH,
};
export const refusalSentence = (reason: NextRefusal): string => REFUSALS[reason];

/** The words for a refused write, by the database's error code. Never any part of its message. */
export function writeFailure(error: unknown): string {
  const code = codeOf(error);
  if (code && MISSING.has(code)) return LAYOUT_NOT_READY;
  if (code === "42501") return LAYOUT_OWNER_ONLY;
  if (code === "40P01" || code === "55P03") return LAYOUT_CHANGED;
  // 23503 (a column the firm doesn't have) and every other refusal: the layout wasn't saved.
  return LAYOUT_SAVE_FAILED;
}

/** The posted operation, or null when it is not exactly one of the known shapes. Keys are checked for shape only. */
export function parseOp(raw: unknown): LayoutOp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const key = o.key;
  if (!isLayoutKey(key)) return null;
  switch (o.op) {
    case "rename":
      return typeof o.label === "string" && o.label.length <= 400 ? { op: "rename", key, label: o.label } : null;
    case "hide":
    case "show":
      return { op: o.op, key };
    case "move":
      return o.dir === "left" || o.dir === "right" ? { op: "move", key, dir: o.dir } : null;
    case "moveTo":
      return typeof o.index === "number" && Number.isInteger(o.index) ? { op: "moveTo", key, index: o.index } : null;
    case "moveBeside":
      return isLayoutKey(o.relativeTo) && (o.side === "left" || o.side === "right") ? { op: "moveBeside", key, relativeTo: o.relativeTo, side: o.side } : null;
    case "width":
      return o.px === null || (typeof o.px === "number" && Number.isFinite(o.px)) ? { op: "width", key, px: o.px } : null;
    case "insert": {
      if (!isLayoutKey(o.relativeTo) || (o.side !== "left" && o.side !== "right")) return null;
      if (o.label !== undefined && o.label !== null && (typeof o.label !== "string" || o.label.length > 400)) return null;
      return { op: "insert", key, ...(o.label !== undefined ? { label: o.label as string | null } : {}), relativeTo: o.relativeTo, side: o.side };
    }
    default:
      return null;
  }
}

/** `rev` as the browser saw it: null (no saved row) or a positive whole number. Anything else is refused. */
export function parseRev(raw: unknown): { ok: true; rev: number | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, rev: null };
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? { ok: true, rev: raw } : { ok: false };
}

/** The next layout for an operation over the CURRENT one (every column the viewer has, in order). Pure. */
export function applyOp(current: Layout, op: LayoutOp, base: LayoutBase): Next {
  const pinned = base.defaults.filter((d) => d.pinned).map((d) => d.key);
  const builtin = (key: string) => base.defaults.find((d) => d.key === key)?.label;
  switch (op.op) {
    case "rename":
      return renameColumn(current, op.key, op.label, builtin(op.key));
    case "hide":
      return setHidden(current, op.key, true, pinned);
    case "show":
      return setHidden(current, op.key, false, pinned);
    case "move":
      return moveColumn(current, op.key, op.dir === "left" ? -1 : 1, pinned);
    case "moveTo":
      return moveColumnTo(current, op.key, op.index, pinned);
    case "moveBeside":
      return moveColumnBeside(current, op.key, op.relativeTo, op.side, pinned);
    case "width":
      return setWidth(current, op.key, op.px);
    case "insert": {
      // A new firm column already exists by now, so the viewer's columns hold it (appended at the end): lift it out, then place it.
      // A key the viewer doesn't have (another firm's field, a Money column for a non-owner, a made-up one) is never placed.
      if (!base.defaults.some((d) => d.key === op.key)) return { ok: false, reason: "unknown-column" };
      return insertColumn(current.filter((c) => c.key !== op.key), { key: op.key, label: op.label ?? null }, op.relativeTo, op.side, pinned);
    }
  }
}

/** Everything the viewer has, in the firm's order, as a layout: what an operation changes. */
export function currentLayout(base: LayoutBase, saved: Layout | null): Layout {
  return layoutOf(resolveLayout(base.defaults, saved));
}

/**
 * One layout change. `view`, `rawOp` and `rawRev` are all the browser posted; nothing else of it is read.
 * Order: owner row, shape, the saved layout as read now (it must be at the rev the browser drew), the next layout, then the write.
 */
export async function changeLayout(deps: SaveDeps, view: unknown, rawOp: unknown, rawRev: unknown): Promise<LayoutResult> {
  let who: OwnerState;
  try {
    who = await deps.owner();
  } catch {
    who = "unreadable";
  }
  if (!isOwner(who)) return fail(LAYOUT_OWNER_ONLY);
  if (!isViewKey(view)) return fail(LAYOUT_SAVE_FAILED);
  const op = parseOp(rawOp);
  const seen = parseRev(rawRev);
  if (!op || !seen.ok) return fail(LAYOUT_SAVE_FAILED);
  // A stage board's columns are stages: the layout only hides or shows them (order and names are the stages', changed from the stage menu).
  if (isStageBoardView(view) && op.op !== "hide" && op.op !== "show") return fail(LAYOUT_STAGE_BOARD_HIDE_ONLY);

  const first = await attempt(deps, view, op, seen.rev, false);
  if (first.kind === "race") {
    // Another owner created the row between our read and our insert: take their row and try once more, from what they saved.
    const second = await attempt(deps, view, op, undefined, true);
    return second.result;
  }
  return first.result;
}

type Attempt = { kind: "done" | "race"; result: LayoutResult };

/** `seen`: the rev the browser drew from (null = no row), or undefined to take whatever is saved now (the one retry). */
async function attempt(deps: SaveDeps, view: ViewKey, op: LayoutOp, seen: number | null | undefined, retry: boolean): Promise<Attempt> {
  const done = (result: LayoutResult): Attempt => ({ kind: "done", result });
  let read: LayoutRead;
  try {
    read = await deps.read(view);
  } catch {
    read = { status: "unavailable" };
  }
  if (read.status === "not-set-up") return done(fail(LAYOUT_NOT_READY));
  if (read.status !== "ok") return done(fail(LAYOUT_READ_FAILED));
  // The view must still be at the rev the browser drew it from (the retry takes the row that is there now).
  if (seen !== undefined && read.rev !== seen) return done(fail(LAYOUT_CHANGED));

  let base: LayoutBase | null;
  try {
    base = await deps.base(view);
  } catch {
    base = null;
  }
  if (!base) return done(fail(LAYOUT_READ_FAILED));

  const next = applyOp(currentLayout(base, read.layout), op, base);
  if (!next.ok) return done(fail(refusalSentence(next.reason)));
  // The database's CHECKs are the same rules; checking here means a refusal is a sentence, not a failed write.
  const columns = parseLayout(next.layout);
  if (!columns) return done(fail(LAYOUT_SAVE_FAILED));

  if (read.rev === null) {
    let orgId: string | null = null;
    try {
      orgId = await deps.orgId();
    } catch {
      orgId = null;
    }
    if (!orgId) return done(fail(LAYOUT_SAVE_FAILED));
    let answer: WriteAnswer;
    try {
      answer = await deps.insert(view, orgId, columns);
    } catch (e) {
      answer = { error: e };
    }
    if (answer.error) {
      if (codeOf(answer.error) === "23505") return { kind: retry ? "done" : "race", result: fail(LAYOUT_CHANGED) };
      return done(fail(writeFailure(answer.error)));
    }
    deps.revalidate();
    return done({ ok: true, rev: 1 });
  }

  let answer: WriteAnswer;
  try {
    answer = await deps.update(view, columns, read.rev);
  } catch (e) {
    answer = { error: e };
  }
  if (answer.error) return done(fail(writeFailure(answer.error)));
  if (answer.rev === null || answer.rev === undefined) return done(fail(LAYOUT_CHANGED));
  deps.revalidate();
  return done({ ok: true, rev: answer.rev });
}
