import { fieldsForSection, type CustomColumnField } from "@/lib/review/sheet-columns";
import { applyLayout } from "@/lib/views/layout/apply";
import { cfKey } from "@/lib/views/layout/validate";
import { splitHiddenColumns, stageColumnKey } from "@/lib/views/layout/stage-columns";
import type { Layout, LayoutDefault, ViewKey } from "@/lib/views/layout/types";
import type { BoardModel } from "@/lib/intake/board-columns";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";
import { stageLabelFor } from "@/lib/intake/views";
import { intakeStages } from "@/lib/intake/scope";
import type { Stage } from "@/lib/pipeline/stages";
import { LEADS_ASSISTANT_COLUMN, LEADS_CONTACT_COLUMN, NEXT_STEP, OWNER_COLUMN } from "@/lib/ui/words";

/**
 * The Leads page as two views, a List and a Board, each with the firm's own saved layout (editable views, build step 6). Pure: no React,
 * no server import, no database.
 *
 *   List   the shared `ViewTable` over these columns: order, names, widths and hidden ones from `leads_list`, the owner's column menu
 *   Board  the stage board's columns are the stages: `leads_board` decides ONE thing, which stage columns are hidden
 *
 * A layout never changes what a rule reads: every column has a fixed key (a rename is a label), and the Owner and Assistant activity columns
 * keep Item L's own rule (drawn only while somebody in view has an owner or something to show), whatever the layout says.
 */
export const LEADS_VIEW_KEYS = { list: "leads_list", board: "leads_board" } as const satisfies Record<string, ViewKey>;
export const isLeadsListView = (view: unknown): view is "leads_list" => view === LEADS_VIEW_KEYS.list;
export const isLeadsBoardView = (view: unknown): view is "leads_board" => view === LEADS_VIEW_KEYS.board;

/** The built-in columns, in default order. `lead` is the link to the record: first, never hidden. Keys are fixed (they are Item L's own column keys). */
export const LEADS_LIST_BUILTIN: readonly LayoutDefault[] = [
  { key: "lead", label: "Lead", pinned: true },
  { key: "stage", label: "Stage" },
  { key: "temp", label: "Temperature" },
  { key: "source", label: "Source" },
  { key: "owner", label: OWNER_COLUMN },
  { key: "assistant", label: LEADS_ASSISTANT_COLUMN },
  { key: "touch", label: LEADS_CONTACT_COLUMN },
  { key: "next", label: NEXT_STEP },
];

export type LeadListColumn = LayoutDefault & { /** The firm's own column: its kind. */ kind?: string };

/**
 * The columns a viewer may have for the Leads List: the built-ins and the firm's own columns of the Trademarks section (a lead is a
 * trademark lead, as on the Weekly review). `canSeeMoney` is the caller's re-resolved rule (a real owner): a Money column is never in
 * anyone else's list, so a saved layout can't add it.
 */
export function leadsListColumns(fields: readonly CustomColumnField[], canSeeMoney: boolean): LeadListColumn[] {
  const own = fieldsForSection(fields, "trademarks")
    .filter((f) => canSeeMoney || f.kind !== "money")
    .map((f): LeadListColumn => ({ key: cfKey(f.id), label: f.label, kind: f.kind }));
  return [...LEADS_LIST_BUILTIN, ...own];
}

/** What Item L's rule says is drawn: Owner only while somebody in view has an owner, Assistant activity only while somebody has something. */
export type LeadsConditionalColumns = { owner: boolean; assistant: boolean };

/**
 * The columns to DRAW: the firm's saved order, labels, widths and hidden ones left out, then Item L's own rule for the two conditional
 * columns. No saved layout: the standard columns exactly as before.
 */
export function drawnLeadColumns(columns: readonly LeadListColumn[], saved: Layout | null | undefined, shown: LeadsConditionalColumns) {
  return applyLayout(columns, saved).filter((c) => (c.key === "owner" ? shown.owner : c.key === "assistant" ? shown.assistant : true));
}

/** Every stage column an owner may have on the stage board, as the layout write sees them: one per intake stage, in pipeline order. */
export function leadsBoardBase(stages: readonly Stage[]): LayoutDefault[] {
  return inPipelineOrder(intakeStages([...stages])).map((s): LayoutDefault => ({ key: stageColumnKey(s.id), label: stageLabelFor(s) }));
}

export type HiddenStageColumn = { key: string; stageId: string; label: string; leads: number };

/**
 * The stage board with the firm's hidden columns taken out. Stage columns only (the owner board's columns are people and no layout
 * touches them). A hidden column's leads are COUNTED, never silently gone; the empty stages named in the "N empty stages" row are
 * hidden the same way. If the layout would hide every stage column (or every one that is drawn), none is hidden. Pure, and the model is returned unchanged when
 * nothing is hidden. `renderedIds` follows what is drawn, so a bulk move can never name a card that isn't on screen.
 */
export function hideStageColumns(model: BoardModel, saved: Layout | null | undefined, pinned: readonly string[] = []): { model: BoardModel; hidden: HiddenStageColumn[] } {
  if (!saved || !saved.some((c) => c.hidden)) return { model, hidden: [] };
  const slots: { key: string; stageId: string; label: string; leads: number }[] = [];
  for (const c of model.columns) if (c.drop.kind === "stage") slots.push({ key: stageColumnKey(c.drop.stageId), stageId: c.drop.stageId, label: c.label, leads: c.count });
  for (const e of model.empty) slots.push({ key: stageColumnKey(e.stageId), stageId: e.stageId, label: e.label, leads: 0 });
  // A hidden column that holds a card moved this session stays drawn (marked), so the card never vanishes under the person who moved it.
  const held = new Set(model.columns.filter((c) => c.drop.kind === "stage" && c.shown.some((r) => pinned.includes(r.lead.id))).map((c) => (c.drop as { stageId: string }).stageId));
  const { hidden: wanted } = splitHiddenColumns(slots, saved);
  const hidden = wanted.filter((h) => !held.has(h.stageId));
  const kept = wanted.filter((h) => held.has(h.stageId));
  if (hidden.length === 0 && kept.length === 0) return { model, hidden: [] };
  const keptIds = new Set(kept.map((h) => h.stageId));
  const gone = new Set(hidden.map((h) => h.stageId));
  const marked = model.columns.map((c) => (c.drop.kind === "stage" && keptIds.has(c.drop.stageId) ? { ...c, hiddenByLayout: true as const } : c));
  const columns = marked.filter((c) => !(c.drop.kind === "stage" && gone.has(c.drop.stageId)));
  // A board is never left with no column to draw because of a layout.
  if (columns.length === 0) return { model, hidden: [] };
  if (hidden.length === 0) return { model: { ...model, columns }, hidden: [] };
  return {
    model: { columns, empty: model.empty.filter((e) => !gone.has(e.stageId)), renderedIds: columns.flatMap((c) => c.shown.map((r) => r.lead.id)) },
    hidden: hidden.map((h) => ({ key: h.key, stageId: h.stageId, label: h.label, leads: h.leads })),
  };
}
