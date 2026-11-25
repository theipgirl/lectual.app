import { isTrademarkRow } from "@/lib/review/sheet";
import { customColumnId, fieldFits, type CustomColumnField, type SheetSectionId } from "@/lib/review/sheet-columns";
import { applyLayout } from "@/lib/views/layout/apply";
import { cfKey } from "@/lib/views/layout/validate";
import type { Layout, LayoutDefault, ViewKey } from "@/lib/views/layout/types";
import { OWNER_COLUMN } from "@/lib/ui/words";

/**
 * The docket as two views, each a List and a Board over the SAME pages (editable views, build step 5). Pure: no React, no server import.
 *
 *   Trademarks  the Matters page with no `kind`        TM, CR and PATENT (and a matter with no type: it reads as TM)
 *   Contracts   the same page with `?kind=contracts`   every other matter type
 *
 * The split is the Weekly review's own type rule (`isTrademarkRow`, `src/lib/review/sheet.ts`), so the two pages can never disagree about
 * which matter is a contract. Every existing Matters address keeps meaning what it did: no `kind` is Trademarks.
 */
export const MATTER_KINDS = ["trademarks", "contracts"] as const;
export type MatterKind = (typeof MATTER_KINDS)[number];
export const DEFAULT_MATTER_KIND: MatterKind = "trademarks";

/** `?kind=`: `contracts` is Contracts; anything else (missing, repeated, unknown) is Trademarks, as every old link was. */
export function parseMatterKind(raw: string | string[] | undefined | null): MatterKind {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === "string" && first.trim() === "contracts" ? "contracts" : DEFAULT_MATTER_KIND;
}

export function matterKindOf(matter: { type?: string | null }): MatterKind {
  return isTrademarkRow({ kind: "matter", matterType: matter.type ?? null }) ? "trademarks" : "contracts";
}

export function filterByMatterKind<M extends { type?: string | null }>(matters: readonly M[], kind: MatterKind): M[] {
  return matters.filter((m) => matterKindOf(m) === kind);
}

/** The firm's saved layout of each view (lectual 0119 `crm_view_layout`). */
export const MATTER_VIEW_KEYS = {
  trademarks: { list: "matters_list", board: "matters_board" },
  contracts: { list: "contracts_list", board: "contracts_board" },
} as const satisfies Record<MatterKind, { list: ViewKey; board: ViewKey }>;

export const MATTER_LIST_VIEWS: readonly ViewKey[] = [MATTER_VIEW_KEYS.trademarks.list, MATTER_VIEW_KEYS.contracts.list];
export const MATTER_BOARD_VIEWS: readonly ViewKey[] = [MATTER_VIEW_KEYS.trademarks.board, MATTER_VIEW_KEYS.contracts.board];

export const isMatterListView = (view: unknown): view is "matters_list" | "contracts_list" => view === "matters_list" || view === "contracts_list";
export const isMatterBoardView = (view: unknown): view is "matters_board" | "contracts_board" => view === "matters_board" || view === "contracts_board";

/** The firm-column section a Matters List's columns belong to (a firm column made on Contracts is a Contracts column). */
export const sectionOfMatterView = (view: "matters_list" | "contracts_list"): SheetSectionId => (view === "matters_list" ? "trademarks" : "contracts");

/* ── The List's columns ── */

export type MatterListColumn = LayoutDefault & { /** The firm's own column: its kind. */ kind?: string };

/** The built-in columns, in default order. `matter` is the link to the record: first, never hidden. Keys are fixed; a rename is a label only. */
export const MATTER_LIST_BUILTIN: readonly LayoutDefault[] = [
  { key: "matter", label: "Matter", pinned: true },
  { key: "type", label: "Type" },
  { key: "stage", label: "Stage" },
  { key: "in_stage", label: "In stage" },
  { key: "owner", label: OWNER_COLUMN },
  { key: "next_step", label: "Next step" },
  { key: "notes", label: "Notes" },
];

/**
 * The columns a viewer may have for a List: the built-ins and the firm's own columns that fit the kind's section. `canSeeMoney` is the
 * caller's re-resolved rule (a real owner): a Money column is never in anyone else's list, so a saved layout can't add it.
 */
export function matterListColumns(fields: readonly CustomColumnField[], kind: MatterKind, canSeeMoney: boolean): MatterListColumn[] {
  const own = fields
    .filter((f) => fieldFits(f, kind) && (canSeeMoney || f.kind !== "money"))
    .map((f): MatterListColumn => ({ key: cfKey(f.id), label: f.label, kind: f.kind }));
  return [...MATTER_LIST_BUILTIN, ...own];
}

/** The columns to draw: the firm's saved order, labels, widths and hidden ones left out. No saved layout: the columns as they are. */
export function drawnMatterColumns(columns: readonly MatterListColumn[], saved: Layout | null | undefined) {
  return applyLayout(columns, saved);
}

export const isFirmColumnKey = (key: string): boolean => key.startsWith("cf:");
export const fieldIdOfKey = (key: string): string => key.slice(3);
export { customColumnId };

/* ── The Board's columns ── */

/** The leading column for matters with no stage, and the trailing one that folds every closed stage. Not stages: no stage menu. */
export const UNSTAGED_COLUMN_KEY = "not_on_docket";
export const CLOSED_COLUMN_KEY = "closed";

/** A stage column's key in a layout: `st_` and the stage id without its dashes (35 characters, inside the 40 a layout key may have). */
export function stageColumnKey(stageId: string): string {
  return `st_${stageId.replace(/-/g, "").toLowerCase()}`;
}

/** Every column an owner may have on a Board, as the layout write sees them: the two fixed ones and one per OPEN stage, in stage order. */
export function matterBoardBase(stages: readonly { id: string; label: string; is_open: boolean }[], unstagedLabel: string, closedLabel: string): LayoutDefault[] {
  return [
    { key: UNSTAGED_COLUMN_KEY, label: unstagedLabel },
    ...stages.filter((s) => s.is_open).map((s): LayoutDefault => ({ key: stageColumnKey(s.id), label: s.label })),
    { key: CLOSED_COLUMN_KEY, label: closedLabel },
  ];
}

/**
 * A Board layout decides ONE thing here: which columns are hidden. The ORDER and the NAMES of stage columns are the stages' own (the
 * owner's stage menu moves and renames the stage itself, for everyone and for every rule), so the saved layout's order and labels are
 * deliberately not applied: two orderings of one pipeline would disagree the day a stage is moved. A column the layout doesn't name is
 * shown. If the layout would hide every column, none is hidden (a Board is never empty because of a layout).
 */
export function splitHiddenColumns<T extends { key: string }>(columns: readonly T[], saved: Layout | null | undefined): { shown: T[]; hidden: T[] } {
  const hiddenKeys = new Set((saved ?? []).filter((c) => c.hidden).map((c) => c.key));
  const hidden = columns.filter((c) => hiddenKeys.has(c.key));
  if (hidden.length === columns.length) return { shown: [...columns], hidden: [] };
  return { shown: columns.filter((c) => !hiddenKeys.has(c.key)), hidden };
}
