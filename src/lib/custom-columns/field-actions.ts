import { canSeeSetup } from "@/lib/setup/roles";
import { builtinHeaders, isFieldId, labelKey, type CustomKind, type CustomSection, type SheetSectionId } from "@/lib/review/sheet-columns";
import {
  COLUMNS_NO_PERMISSION,
  CUSTOM_BAD_KIND,
  CUSTOM_COLUMN_ARCHIVED,
  CUSTOM_COLUMNS_NOT_READY,
  CUSTOM_FIELD_CHANGED,
  CUSTOM_FIELD_GONE,
  CUSTOM_LIMIT,
  CUSTOM_MOVE_FAILED,
  CUSTOM_ORDER_CHANGED,
  CUSTOM_SAVE_FAILED,
  CUSTOM_SAVE_FAILED_READ,
  labelIsBuiltin,
  labelTaken,
  optionInUse,
} from "@/lib/ui/words";
import { customColumnsError, isMissingTable } from "./errors";
import { parseChoicesInput, parseKindInput, parseLabelInput, parseSectionInput } from "./input";
import { optionsShapeOk, sqlLabelOk } from "./text";

/**
 * The logic behind Settings -> Columns (`actions.ts` holds the thin `"use server"` wrappers). Dependencies are injected, so every rule is
 * tested without a database. Rules, in order: the role (re-resolved on EVERY call), the shape of what was posted, the field as read now,
 * the parse, the built-in clash, the clash with another column, the 40-column limit, choices still in use, then ONE write of ONE row by
 * id (Move: two single-row writes, plus one compensating write if the second fails). Never an upsert. Nothing the browser sends is
 * trusted: the org comes from the session, kind and section never change after create, and the rendered `updated_at` only refuses.
 */

export type ActionState = { error?: string; saved?: boolean };

/** The field as `readField` returns it (named columns). */
export type FieldRow = { id: string; section: string; kind: string; label: string; options: unknown; position: number; archived: boolean; updated_at: string };
/** One live field, in the order the database returned (position, label, id). */
export type LiveField = { id: string; section: string; label: string; kind: string; options: unknown; position: number };

export type FieldInsert = { org_id: string; section: CustomSection; label: string; kind: CustomKind; options: string[]; position: number };
export type FieldPatch = { label: string } | { options: string[] } | { archived: boolean } | { archived: boolean; position: number } | { position: number };
export type FieldGuard = { updated_at: string } | { archived: boolean } | { position: number };

/** Each read or write throws the database's error object; the logic decides the words. */
export type FieldDeps = {
  role: () => Promise<string | null>;
  orgId: () => Promise<string>;
  readField: (id: string) => Promise<FieldRow | null>;
  readLiveFields: () => Promise<LiveField[]>;
  readOptionUse: (fieldId: string, options: string[]) => Promise<Record<string, number>>;
  insertField: (row: FieldInsert) => Promise<void>;
  /** The number of rows the guarded update affected (0 = the guard no longer held). */
  updateField: (id: string, patch: FieldPatch, guards: FieldGuard) => Promise<number>;
  revalidate: () => void;
};

export type CreateInput = { label: unknown; section: unknown; kind: unknown; choices: unknown };
export type UpdateInput = { op: unknown; id: unknown; label?: unknown; choices?: unknown; dir?: unknown; updatedAt?: unknown };

export const MAX_LIVE = 40;
export const POSITION_MAX = 1000;
export const FIELD_OPS = ["rename", "options", "move", "archive", "restore"] as const;
export type FieldOp = (typeof FIELD_OPS)[number];

const refuse = (error: string): ActionState => ({ error });
const SAVED: ActionState = { saved: true };

/** The highest live position + 1 when that is at most 1000, else the lowest integer 0..1000 no live field uses. */
export function nextPosition(live: readonly Pick<LiveField, "position">[]): number {
  const used = new Set(live.map((f) => f.position));
  const top = live.length === 0 ? 0 : Math.max(...live.map((f) => f.position)) + 1;
  if (top <= POSITION_MAX) return top;
  for (let p = 0; p <= POSITION_MAX; p++) if (!used.has(p)) return p;
  return POSITION_MAX;
}

/** The List sections a column of this section appears in. */
function sectionsOf(section: string): SheetSectionId[] {
  return section === "both" ? ["trademarks", "contracts"] : section === "contracts" ? ["contracts"] : ["trademarks"];
}

/** Rule 5: the label is one of the List's own headers in a section the column would appear in. */
export function isBuiltinLabel(label: string, section: string): boolean {
  const key = labelKey(label);
  return sectionsOf(section).some((s) => builtinHeaders(s).some((h) => labelKey(h) === key));
}

/** Rule 6 (0115's rule): another live field with the same label, where the sections are equal or either is `both`. */
export function clashesWith(label: string, section: string, live: readonly LiveField[], selfId: string | null): boolean {
  const key = labelKey(label);
  return live.some((f) => f.id !== selfId && labelKey(f.label) === key && (f.section === section || f.section === "both" || section === "both"));
}

/** Rule 1: the admin tier (`SETUP_ROLES`, 0115's field policy list). A throw from `role()` is no role. */
async function admitted(deps: FieldDeps): Promise<boolean> {
  try {
    return canSeeSetup(await deps.role());
  } catch {
    return false;
  }
}

/** A live list, or the refusal to answer: not switched on, or "couldn't check" (never "no clash", never 0). */
async function liveOrRefusal(deps: FieldDeps): Promise<LiveField[] | ActionState> {
  try {
    return await deps.readLiveFields();
  } catch (e) {
    return refuse(isMissingTable(e) ? CUSTOM_COLUMNS_NOT_READY : CUSTOM_SAVE_FAILED_READ);
  }
}

async function write(deps: FieldDeps, run: () => Promise<number | void>): Promise<ActionState> {
  try {
    const rows = await run();
    if (rows === 0) return refuse(CUSTOM_FIELD_CHANGED);
  } catch (e) {
    return refuse(customColumnsError(e, "field"));
  }
  deps.revalidate();
  return SAVED;
}

export async function createField(deps: FieldDeps, input: CreateInput): Promise<ActionState> {
  if (!(await admitted(deps))) return refuse(COLUMNS_NO_PERMISSION);
  let orgId: string;
  try {
    orgId = await deps.orgId();
  } catch {
    return refuse(CUSTOM_SAVE_FAILED);
  }
  // Rule 4 before any read (R20): an invalid label answers its own sentence even before the tables exist.
  const label = parseLabelInput(input.label);
  if (!label.ok) return refuse(label.error);
  const section = parseSectionInput(input.section);
  if (!section.ok) return refuse(section.error);
  const kind = parseKindInput(input.kind);
  if (!kind.ok) return refuse(kind.error);
  let options: string[] = [];
  if (kind.value === "choice") {
    const parsed = parseChoicesInput(input.choices);
    if (!parsed.ok) return refuse(parsed.error);
    options = parsed.value;
  }
  if (isBuiltinLabel(label.value, section.value)) return refuse(labelIsBuiltin(label.value));
  const live = await liveOrRefusal(deps);
  if (!Array.isArray(live)) return live;
  if (clashesWith(label.value, section.value, live, null)) return refuse(labelTaken(label.value));
  if (live.length >= MAX_LIVE) return refuse(CUSTOM_LIMIT);
  const row: FieldInsert = { org_id: orgId, section: section.value, label: label.value, kind: kind.value, options, position: nextPosition(live) };
  return write(deps, () => deps.insertField(row));
}

/** Rule 3's read of the field; a refusal, or the row (CO1-valid, with its stamps). */
async function readFieldOrRefusal(deps: FieldDeps, id: string): Promise<FieldRow | ActionState> {
  let row: FieldRow | null;
  try {
    row = await deps.readField(id);
  } catch (e) {
    return refuse(isMissingTable(e) ? CUSTOM_COLUMNS_NOT_READY : customColumnsError(e, "field"));
  }
  if (!row) return refuse(CUSTOM_FIELD_GONE);
  const ok =
    row.id === id &&
    sqlLabelOk(row.label) &&
    ["trademarks", "contracts", "both"].includes(row.section) &&
    ["text", "date", "money", "choice", "person"].includes(row.kind) &&
    optionsShapeOk(row.kind, row.options) &&
    Number.isInteger(row.position) &&
    typeof row.archived === "boolean" &&
    typeof row.updated_at === "string" &&
    row.updated_at !== "";
  return ok ? row : refuse(CUSTOM_SAVE_FAILED_READ);
}

const isRefusal = (x: unknown): x is ActionState => !!x && typeof x === "object" && !Array.isArray(x) && ("error" in x || "saved" in x);

export async function updateField(deps: FieldDeps, input: UpdateInput): Promise<ActionState> {
  if (!(await admitted(deps))) return refuse(COLUMNS_NO_PERMISSION);
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!isFieldId(id)) return refuse(CUSTOM_FIELD_GONE);
  const op = typeof input.op === "string" && (FIELD_OPS as readonly string[]).includes(input.op) ? (input.op as FieldOp) : null;
  if (!op) return refuse(CUSTOM_SAVE_FAILED);
  const dir = input.dir === "up" || input.dir === "down" ? input.dir : null;
  if (op === "move" && !dir) return refuse(CUSTOM_SAVE_FAILED);

  const read = await readFieldOrRefusal(deps, id);
  if (isRefusal(read)) return read;
  if (op === "options" && read.kind !== "choice") return refuse(CUSTOM_BAD_KIND);
  if ((op === "rename" || op === "options" || op === "move") && read.archived) return refuse(CUSTOM_COLUMN_ARCHIVED);
  if ((op === "restore" && !read.archived) || (op === "archive" && read.archived)) return refuse(CUSTOM_FIELD_CHANGED);
  // R5: the rendered stamp must be the one just read (a tab opened before another admin's change would undo it). Only ever compared.
  if (op === "rename" || op === "options") {
    if (typeof input.updatedAt !== "string" || input.updatedAt !== read.updated_at) return refuse(CUSTOM_FIELD_CHANGED);
  }

  switch (op) {
    case "rename": {
      const label = parseLabelInput(input.label);
      if (!label.ok) return refuse(label.error);
      if (isBuiltinLabel(label.value, read.section)) return refuse(labelIsBuiltin(label.value));
      const live = await liveOrRefusal(deps);
      if (!Array.isArray(live)) return live;
      if (clashesWith(label.value, read.section, live, read.id)) return refuse(labelTaken(label.value));
      return write(deps, () => deps.updateField(id, { label: label.value }, { updated_at: read.updated_at }));
    }
    case "options": {
      const current = read.options as string[];
      const parsed = parseChoicesInput(input.choices, current);
      if (!parsed.ok) return refuse(parsed.error);
      // Compared exactly, as the trigger's `?` compares.
      const removed = current.filter((o) => !parsed.value.includes(o));
      if (removed.length > 0) {
        let use: Record<string, number>;
        try {
          use = await deps.readOptionUse(id, removed);
        } catch {
          return refuse(CUSTOM_SAVE_FAILED_READ);
        }
        const inUse = removed.filter((o) => (use[o] ?? 0) > 0);
        if (inUse.length > 0) return refuse(inUse.map((o) => optionInUse(o, use[o])).join(" "));
      }
      return write(deps, () => deps.updateField(id, { options: parsed.value }, { updated_at: read.updated_at }));
    }
    case "archive":
      return write(deps, () => deps.updateField(id, { archived: true }, { archived: false }));
    case "restore": {
      if (isBuiltinLabel(read.label, read.section)) return refuse(labelIsBuiltin(read.label));
      const live = await liveOrRefusal(deps);
      if (!Array.isArray(live)) return live;
      if (clashesWith(read.label, read.section, live, read.id)) return refuse(labelTaken(read.label));
      if (live.length >= MAX_LIVE) return refuse(CUSTOM_LIMIT);
      return write(deps, () => deps.updateField(id, { archived: false, position: nextPosition(live) }, { archived: true }));
    }
    case "move":
      return move(deps, read, dir!);
  }
}

/**
 * Rule 10. The neighbour is the adjacent row of the live list AS RETURNED (position, label, id): never re-sorted here. Different
 * positions swap in two guarded single-row requests; a failed second write gets ONE compensating write, and whatever it answers, the
 * answer is `CUSTOM_MOVE_FAILED`. Equal positions move only the field, when the slot is free, in range and no third field shares the
 * tie. `revalidate` runs once whenever any write landed, so the page never draws an order the database no longer has.
 */
async function move(deps: FieldDeps, read: FieldRow, dir: "up" | "down"): Promise<ActionState> {
  const live = await liveOrRefusal(deps);
  if (!Array.isArray(live)) return live;
  const at = live.findIndex((f) => f.id === read.id);
  if (at < 0) return refuse(CUSTOM_ORDER_CHANGED);
  const moved = live[at];
  const neighbour = live[dir === "up" ? at - 1 : at + 1];
  if (!neighbour) return refuse(CUSTOM_ORDER_CHANGED);

  if (moved.position === neighbour.position) {
    const p = moved.position;
    const target = dir === "up" ? p - 1 : p + 1;
    const inRange = target >= 0 && target <= POSITION_MAX;
    const taken = live.some((f) => f.position === target);
    const thirdTie = live.some((f) => f.position === p && f.id !== moved.id && f.id !== neighbour.id);
    if (!inRange || taken || thirdTie) return refuse(CUSTOM_MOVE_FAILED);
    let rows: number;
    try {
      rows = await deps.updateField(moved.id, { position: target }, { position: p });
    } catch (e) {
      return refuse(customColumnsError(e, "field"));
    }
    if (rows === 0) return refuse(CUSTOM_ORDER_CHANGED);
    deps.revalidate();
    return SAVED;
  }

  // Write 1: the moved field takes the neighbour's position, only if it still holds its own.
  let first: number;
  try {
    first = await deps.updateField(moved.id, { position: neighbour.position }, { position: moved.position });
  } catch (e) {
    return refuse(customColumnsError(e, "field"));
  }
  if (first === 0) return refuse(CUSTOM_ORDER_CHANGED);

  // Write 2: the neighbour takes the moved field's old position, only if it still holds its own.
  let second = 0;
  try {
    second = await deps.updateField(neighbour.id, { position: moved.position }, { position: neighbour.position });
  } catch {
    second = 0;
  }
  if (second > 0) {
    deps.revalidate();
    return SAVED;
  }
  // One compensating write, guarded on the moved field's NEW position. Its answer is not trusted either way.
  try {
    await deps.updateField(moved.id, { position: moved.position }, { position: neighbour.position });
  } catch {
    // The order may now hold a tie; a further Move (or archive and restore) repairs it. Nothing more is written here.
  }
  deps.revalidate();
  return refuse(CUSTOM_MOVE_FAILED);
}
