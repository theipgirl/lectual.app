import { cfKey } from "@/lib/views/layout/validate";
import { customCells, withoutMoney, type CustomColumnsState, type CustomMember } from "@/lib/custom-columns/rules";
import type { CustomColumnField } from "@/lib/review/sheet-columns";
import type { FactCell } from "@/lib/review/sheet-cells";

/**
 * What the Leads List needs of the firm's own columns, from one `CustomColumnsState`. Pure.
 *
 * `fields` are the live fields (never a Money one for a viewer who may not see money: the state is cleaned again here, the page's second
 * fence), `cells` the read-only cell of each lead and column keyed by the layout's own `cf:` key (lowercase, as `cfKey` builds it), and
 * `meta` each column's kind and choices for its header menu. Firm columns are typed on the lead's own card; the List only shows them.
 * `unavailable` is true only for a read that FAILED (said once on the page, never "no firm columns"); "not set up" says nothing.
 */
export type LeadFirmColumns = {
  fields: CustomColumnField[];
  cells: Record<string, Record<string, FactCell>>;
  meta: Record<string, { kind: string; options: readonly string[] }>;
  unavailable: boolean;
};

export function leadFirmColumns(opts: { leadIds: readonly string[]; state: CustomColumnsState | null; canSeeMoney: boolean; members: readonly CustomMember[] | null; today: string }): LeadFirmColumns {
  const none: LeadFirmColumns = { fields: [], cells: {}, meta: {}, unavailable: false };
  if (!opts.state) return none;
  const state = opts.canSeeMoney ? opts.state : withoutMoney(opts.state);
  if (state.status === "unavailable") return { ...none, unavailable: true };
  if (state.status !== "ok") return none;
  const fields = state.fields as unknown as CustomColumnField[];
  const lower = (o: Record<string, FactCell>): Record<string, FactCell> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.startsWith("cf:") ? cfKey(k.slice(3)) : k, v]));
  const raw = customCells(opts.leadIds.map((id) => ({ key: id, kind: "lead" as const, id, matterType: null })), state.fields, state, opts.members, opts.today);
  const cells = Object.fromEntries(Object.entries(raw).map(([id, c]) => [id, lower(c)]));
  const meta = Object.fromEntries(state.fields.map((f) => [cfKey(f.id), { kind: f.kind as string, options: (f.options ?? []) as readonly string[] }]));
  return { fields, cells, meta, unavailable: false };
}
