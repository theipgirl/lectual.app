import type { ReviewRow } from "@/lib/review/buckets";
import { shortDate } from "@/lib/review/format";
import { isTrademarkRow } from "@/lib/review/sheet";
import type { FactCell } from "@/lib/review/sheet-cells";
import {
  CUSTOM_KINDS,
  CUSTOM_SECTIONS,
  customColumnId,
  fieldFits,
  fieldsForSection,
  isFieldId,
  type CustomColumnField,
  type CustomKind,
  type CustomSection,
  type SheetSectionId,
} from "@/lib/review/sheet-columns";
import { formatCents } from "@/lib/quotes/money";
import type { Role } from "@/lib/auth/roles";
import { canSeeBilling } from "@/lib/billing/can-see";
import { BLANK, COL_COULDNT_LOAD, CUSTOM_FROM_LEAD, CUSTOM_FROM_MERGED, CUSTOM_NO_LONGER_ON_TEAM } from "@/lib/ui/words";
import { centsToInput, parseValueInput } from "./input";
import { cutCodePoints, optionsShapeOk, sqlLabelOk } from "./text";

/**
 * A firm's own List columns (lectual 0115, proposed): the rules of the READ side. Pure: rows from the two tables in, cells out.
 * No database, no React, no server import. What a field may hold mirrors the proposal's CHECKs, so a row the database would
 * refuse is dropped here rather than drawn. Three states are kept apart everywhere: a value, "—" (the read worked and nothing is
 * recorded) and "Couldn't load" (something the cell needs could not be read).
 */

export { fieldFits, fieldsForSection, customColumnId };
export type { CustomKind, CustomSection };

/** One live field (archived ones are never read). `options` is the choice list, empty for every other kind. */
export type CustomField = CustomColumnField & { options: string[] };

/** One stored value: exactly one record and exactly one typed column. */
export type CustomValue = {
  id: string;
  fieldId: string;
  leadId: string | null;
  matterId: string | null;
  text: string | null;
  date: string | null;
  cents: number | null;
  choice: string | null;
  userId: string | null;
  updatedAt: string;
};

export type CustomData = {
  fields: CustomField[];
  values: CustomValue[];
  /** child lead id -> the lead it was merged into (lectual 0107), for the leads merged into the ones read. */
  mergedInto: Record<string, string>;
  /** matter id -> its lead id, for the matters read. */
  leadOfMatter: Record<string, string>;
};

/** What the List and the card get: the data, "not switched on" (the tables aren't there yet), or "couldn't load". */
export type CustomColumnsState = ({ status: "ok" } & CustomData) | { status: "not-set-up" } | { status: "unavailable" };

/** What the section note needs of a state (CO3, CO4): the status and the live fields' labels and sections. Null when not read. */
export function noteStateOf(state: CustomColumnsState | null | undefined): { status: CustomColumnsState["status"]; fields?: { label: string; section: CustomSection }[] } | null {
  if (!state) return null;
  return state.status === "ok" ? { status: "ok", fields: state.fields.map((f) => ({ label: f.label, section: f.section })) } : { status: state.status };
}

/** The row facts the rules need; `ReviewRow` itself is not changed. */
export type CustomRow = Pick<ReviewRow, "kind" | "id" | "matterType">;

export type ValueHit = { state: "none" } | { state: "value"; value: CustomValue; fromLead?: true; fromMerged?: true };

export type CustomMember = { userId: string; name: string };

export const LABEL_MAX = 60;
export const POSITION_MAX = 1000;
export const OPTIONS_MAX = 30;
export const OPTION_MAX = 40;
export const TEXT_MAX = 500;

/**
 * Who may type a custom value: 0115's value insert / update / delete policy list, equal to `MATTER_WRITE_ROLES` and `CAN_WRITE_LEAD`
 * (a test pins all four). viewer and social_media read only.
 */
export const CUSTOM_VALUE_WRITE_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"];
export const canWriteCustomValue = (role: string | null | undefined): boolean => !!role && (CUSTOM_VALUE_WRITE_ROLES as readonly string[]).includes(role);

/**
 * Who may see or type a value in a firm's own MONEY column: exactly who sees the built-in fee columns, `canSeeBilling` (the owner, nothing
 * else; unknown or unreadable = no). Taylor, Nov 23. The read (`loadCustomColumns`) never selects an amount for anyone else, the write
 * (`setCustomValue`) refuses, and 0115's value policies hide and refuse money rows for every other role.
 */
export const canSeeCustomMoney = (role: unknown): boolean => canSeeBilling(role);

/** The live fields this viewer may have: Money fields only when `canSeeMoney`. */
export function visibleFields<F extends { kind: CustomKind }>(fields: readonly F[], canSeeMoney: boolean): F[] {
  return canSeeMoney ? [...fields] : fields.filter((f) => f.kind !== "money");
}

/**
 * A custom state with every Money field and every amount removed, for a viewer who may not see money. The loader already never selects
 * one for them; this is the page's second fence (a state handed over from elsewhere is cleaned the same way). Values of a removed field,
 * and any value holding an amount, are dropped.
 */
export function withoutMoney(state: CustomColumnsState): CustomColumnsState {
  if (state.status !== "ok") return state;
  const fields = visibleFields(state.fields, false);
  const ids = new Set(fields.map((f) => f.id));
  return { ...state, fields, values: state.values.filter((v) => ids.has(v.fieldId) && v.cents === null) };
}

const isKind = (x: unknown): x is CustomKind => typeof x === "string" && (CUSTOM_KINDS as readonly string[]).includes(x);
const isSection = (x: unknown): x is CustomSection => typeof x === "string" && (CUSTOM_SECTIONS as readonly string[]).includes(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CO1: the shape `crm_custom_field_options_valid` accepts (`text.ts`), without re-judging "distinct ignoring case": the database did that
 * with `lower()`, and a field it stored is drawn.
 */
export function optionsValid(kind: CustomKind, options: unknown): options is string[] {
  return optionsShapeOk(kind, options);
}

/** A field row as read, or null when anything is off (it is then not drawn at all, never drawn half). */
export function parseField(raw: unknown): CustomField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isFieldId(r.id) || !isSection(r.section) || !isKind(r.kind)) return null;
  const label = r.label;
  // CO1: exactly the label CHECKs (1..60 code points, `label = btrim(label)`): a tab or a non-breaking space at the end is the database's to allow.
  if (!sqlLabelOk(label)) return null;
  const position = r.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position > POSITION_MAX) return null;
  if (!optionsValid(r.kind, r.options)) return null;
  return { id: r.id, section: r.section, label, kind: r.kind, position, options: [...r.options] };
}

const str = (x: unknown): x is string => typeof x === "string";

/** A value row as read, or null: malformed, both records or none, no typed value or two, or a field that isn't one of `fieldIds`. */
export function parseValue(raw: unknown, fieldIds: ReadonlySet<string>): CustomValue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || !str(r.field_id) || !fieldIds.has(r.field_id) || !str(r.updated_at)) return null;
  const leadId = str(r.lead_id) ? r.lead_id : null;
  const matterId = str(r.matter_id) ? r.matter_id : null;
  if ((leadId === null) === (matterId === null)) return null;
  const text = str(r.value_text) ? r.value_text : null;
  const date = str(r.value_date) && DATE.test(r.value_date) ? r.value_date : null;
  const cents = typeof r.value_cents === "number" && Number.isSafeInteger(r.value_cents) && r.value_cents >= 0 ? r.value_cents : null;
  const choice = str(r.value_choice) ? r.value_choice : null;
  const userId = str(r.value_user_id) ? r.value_user_id : null;
  const sent = [r.value_text, r.value_date, r.value_cents, r.value_choice, r.value_user_id].filter((v) => v !== null && v !== undefined).length;
  const kept = [text, date, cents, choice, userId].filter((v) => v !== null).length;
  if (sent !== 1 || kept !== 1) return null;
  return { id: r.id, fieldId: r.field_id, leadId, matterId, text, date, cents, choice, userId, updatedAt: r.updated_at };
}

/* ── Which value a row shows ── */

type Index = { byLead: Map<string, CustomValue>; byMatter: Map<string, CustomValue>; children: Map<string, string[]> };
const indexes = new WeakMap<CustomData, Index>();

function indexOf(custom: CustomData): Index {
  const hit = indexes.get(custom);
  if (hit) return hit;
  const byLead = new Map<string, CustomValue>();
  const byMatter = new Map<string, CustomValue>();
  for (const v of custom.values) {
    if (v.leadId) byLead.set(`${v.fieldId}|${v.leadId}`, v);
    else if (v.matterId) byMatter.set(`${v.fieldId}|${v.matterId}`, v);
  }
  const children = new Map<string, string[]>();
  for (const [child, keeper] of Object.entries(custom.mergedInto)) children.set(keeper, [...(children.get(keeper) ?? []), child]);
  const built = { byLead, byMatter, children };
  indexes.set(custom, built);
  return built;
}

/** Newest first: `updated_at`, then id (the larger id wins a tie, so the choice never changes between renders). */
function newer(a: CustomValue, b: CustomValue): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.id > b.id;
}

function fromMergedChildren(idx: Index, fieldId: string, leadId: string): CustomValue | null {
  let best: CustomValue | null = null;
  for (const child of idx.children.get(leadId) ?? []) {
    const v = idx.byLead.get(`${fieldId}|${child}`);
    if (v && (!best || newer(v, best))) best = v;
  }
  return best;
}

export function rowSection(row: Pick<ReviewRow, "kind" | "matterType">): SheetSectionId {
  return isTrademarkRow(row) ? "trademarks" : "contracts";
}

/**
 * The value a row shows for a field. A field whose section doesn't fit the row shows nothing (a matter whose type changed keeps a
 * value it no longer shows). A lead: its own value, else the newest on a lead merged into it. A Trademarks matter: its own, else its
 * lead's own, else the newest on a lead merged into its lead (the lead is the live record; a duplicate's value is older history).
 * A Contracts matter: its own only, a `both` field included.
 */
export function valueFor(row: CustomRow, field: Pick<CustomField, "id" | "section">, custom: CustomData): ValueHit {
  const section = rowSection(row);
  if (!fieldFits(field, section)) return { state: "none" };
  const idx = indexOf(custom);
  if (row.kind === "lead") {
    const own = idx.byLead.get(`${field.id}|${row.id}`);
    if (own) return { state: "value", value: own };
    const merged = fromMergedChildren(idx, field.id, row.id);
    return merged ? { state: "value", value: merged, fromMerged: true } : { state: "none" };
  }
  const own = idx.byMatter.get(`${field.id}|${row.id}`);
  if (own) return { state: "value", value: own };
  if (section !== "trademarks") return { state: "none" };
  const leadId = custom.leadOfMatter[row.id];
  if (!leadId) return { state: "none" };
  const lead = idx.byLead.get(`${field.id}|${leadId}`);
  if (lead) return { state: "value", value: lead, fromLead: true };
  const merged = fromMergedChildren(idx, field.id, leadId);
  return merged ? { state: "value", value: merged, fromMerged: true } : { state: "none" };
}

const blank: FactCell = { text: BLANK, tone: "none" };

/**
 * One value as a cell. Money through `formatCents`, a date through `shortDate`, a choice as stored (even one no longer in the options:
 * the data wins), text as plain text cut for display. A person: the directory's name; an id the directory doesn't hold is someone no
 * longer on the team; with the directory unreadable (`members === null`) the cell says it couldn't load, never that they left.
 */
export function formatValue(field: Pick<CustomField, "kind">, value: CustomValue | null, members: readonly CustomMember[] | null, today: string): FactCell {
  if (!value) return blank;
  switch (field.kind) {
    case "text":
      return value.text === null ? blank : { text: cutCodePoints(value.text, TEXT_MAX) === value.text ? value.text : `${cutCodePoints(value.text, TEXT_MAX)}…`, tone: "value" };
    case "date":
      return value.date === null ? blank : { text: shortDate(value.date, today), tone: "value" };
    case "money":
      return value.cents === null ? blank : { text: formatCents(value.cents), tone: "value" };
    case "choice":
      return value.choice === null ? blank : { text: value.choice, tone: "value" };
    case "person": {
      if (value.userId === null) return blank;
      if (members === null) return { text: COL_COULDNT_LOAD, tone: "failed" };
      const name = members.find((m) => m.userId === value.userId)?.name;
      return { text: name ?? CUSTOM_NO_LONGER_ON_TEAM, tone: "value" };
    }
  }
}

/** The cell a row draws for a field: the value, with a quiet title when it came from the lead or a merged duplicate. */
export function cellFor(row: CustomRow, field: CustomField, custom: CustomData, members: readonly CustomMember[] | null, today: string): FactCell {
  const hit = valueFor(row, field, custom);
  if (hit.state === "none") return blank;
  const cell = formatValue(field, hit.value, members, today);
  const title = hit.fromLead ? CUSTOM_FROM_LEAD : hit.fromMerged ? CUSTOM_FROM_MERGED : undefined;
  return title ? { ...cell, title } : cell;
}

/**
 * Every row's custom cells, keyed by row key then `cf:<field id>`: a plain object, so the owner Sheet's client table can take it as a
 * prop. Only the fields of the row's own section are filled.
 */
export function customCells(
  rows: readonly (CustomRow & { key: string })[],
  fields: readonly CustomField[],
  custom: CustomData,
  members: readonly CustomMember[] | null,
  today: string,
): Record<string, Record<string, FactCell>> {
  const out: Record<string, Record<string, FactCell>> = {};
  for (const r of rows) {
    const cells: Record<string, FactCell> = {};
    for (const f of fieldsForSection(fields, rowSection(r))) cells[customColumnId(f.id)] = cellFor(r, f, custom, members, today);
    out[r.key] = cells;
  }
  return out;
}

/* ── What a row's editor starts from (Sprint 3) ── */

/**
 * The value a row shows when it has NO own value: a lead's merged duplicate's; a Trademarks matter's lead's (or a lead merged into its
 * lead); a Contracts matter, none. Present whether or not the row has an own value, so the editors can say what would still show.
 */
export function inheritedFor(row: CustomRow, field: Pick<CustomField, "id" | "section">, custom: CustomData): { value: CustomValue; from: "lead" | "merged" } | null {
  const section = rowSection(row);
  if (!fieldFits(field, section)) return null;
  const idx = indexOf(custom);
  if (row.kind === "lead") {
    const merged = fromMergedChildren(idx, field.id, row.id);
    return merged ? { value: merged, from: "merged" } : null;
  }
  if (section !== "trademarks") return null;
  const leadId = custom.leadOfMatter[row.id];
  if (!leadId) return null;
  const lead = idx.byLead.get(`${field.id}|${leadId}`);
  if (lead) return { value: lead, from: "lead" };
  const merged = fromMergedChildren(idx, field.id, leadId);
  return merged ? { value: merged, from: "merged" } : null;
}

/** The record's OWN value for a field, or null. */
export function ownValueFor(row: CustomRow, field: Pick<CustomField, "id" | "section">, custom: CustomData): CustomValue | null {
  if (!fieldFits(field, rowSection(row))) return null;
  const idx = indexOf(custom);
  return (row.kind === "lead" ? idx.byLead.get(`${field.id}|${row.id}`) : idx.byMatter.get(`${field.id}|${row.id}`)) ?? null;
}

/** A stored value in the editors' form: text as stored, a date YYYY-MM-DD, money "1250.00", a choice as stored, a person's user id. */
export function editorValue(field: Pick<CustomField, "kind">, value: CustomValue | null): string | null {
  if (!value) return null;
  switch (field.kind) {
    case "text":
      return value.text;
    case "date":
      return value.date;
    case "money":
      return value.cents === null ? null : centsToInput(value.cents);
    case "choice":
      return value.choice;
    case "person":
      return value.userId;
  }
}

export type InheritedCell = { from: "lead" | "merged"; cell: FactCell };
export type CustomEditInput = { own: Record<string, string | null>; inherited: Record<string, InheritedCell> };

function inheritedCell(row: CustomRow, field: CustomField, custom: CustomData, members: readonly CustomMember[] | null, today: string): InheritedCell | null {
  const hit = inheritedFor(row, field, custom);
  if (!hit) return null;
  return { from: hit.from, cell: { ...formatValue(field, hit.value, members, today), title: hit.from === "lead" ? CUSTOM_FROM_LEAD : CUSTOM_FROM_MERGED } };
}

/** Every row's own values (editor form) and inherited cells, by row key then `cf:<field id>`: plain objects, for the client table. */
export function customEditInputs(
  rows: readonly (CustomRow & { key: string })[],
  fields: readonly CustomField[],
  custom: CustomData,
  members: readonly CustomMember[] | null,
  today: string,
): Record<string, CustomEditInput> {
  const out: Record<string, CustomEditInput> = {};
  for (const r of rows) {
    const own: Record<string, string | null> = {};
    const inherited: Record<string, InheritedCell> = {};
    for (const f of fieldsForSection(fields, rowSection(r))) {
      const id = customColumnId(f.id);
      own[id] = editorValue(f, ownValueFor(r, f, custom));
      const inh = inheritedCell(r, f, custom, members, today);
      if (inh) inherited[id] = inh;
    }
    out[r.key] = { own, inherited };
  }
  return out;
}

/**
 * The cell a just-typed value draws while it saves (and until fresh rows arrive): formatted as the server would format the stored
 * value. A value that doesn't parse draws as typed (the save will be refused and the cell put back).
 */
export function typedCell(field: Pick<CustomField, "kind" | "options">, raw: string, members: readonly CustomMember[] | null, today: string): FactCell {
  const p = parseValueInput(field.kind, raw, field.kind === "choice" ? [...field.options, raw] : field.options);
  if (!p.ok) return { text: raw, tone: "value" };
  if (p.value === null) return blank;
  const v: CustomValue = { id: "", fieldId: "", leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "" };
  if (field.kind === "text") v.text = String(p.value);
  else if (field.kind === "date") v.date = String(p.value);
  else if (field.kind === "money") v.cents = Number(p.value);
  else if (field.kind === "choice") v.choice = String(p.value);
  else v.userId = String(p.value);
  return formatValue(field, v, members, today);
}

/** The opened card's "Firm columns": the record's section's fields in order, each with its cell. */
export function firmColumnsFor(record: CustomRow, custom: CustomData, members: readonly CustomMember[] | null, today: string): { label: string; cell: FactCell }[] {
  return fieldsForSection(custom.fields, rowSection(record)).map((f) => ({ label: f.label, cell: cellFor(record, f, custom, members, today) }));
}

/** What a staff member's card offers for one item: the field, its own value (editor form), what shows without it, and the record to write. */
export type FirmColumnEdit = {
  fieldId: string;
  kind: CustomKind;
  options: string[];
  own: string | null;
  inherited?: { from: "lead" | "merged"; text: string };
  recordKind: "lead" | "matter";
  recordId: string;
};
export type FirmColumnItem = { label: string; cell: FactCell; edit?: FirmColumnEdit };

/** What the card block draws, from a custom state and the record. */
export type FirmColumnsBlock = { status: "ok"; items: FirmColumnItem[] } | { status: "not-set-up" } | { status: "unavailable" };

/**
 * `canWrite` comes from the page's re-resolved role (`canWriteCustomValue`); without it the items carry no `edit` and the card draws the
 * values only. The record is the one the card SHOWS (a merged lead's keeper, the matter for a matter).
 */
export function firmColumnsBlock(state: CustomColumnsState, record: CustomRow, members: readonly CustomMember[] | null, today: string, canWrite = false): FirmColumnsBlock {
  if (state.status !== "ok") return { status: state.status };
  const items = fieldsForSection(state.fields, rowSection(record)).map((f): FirmColumnItem => {
    const item: FirmColumnItem = { label: f.label, cell: cellFor(record, f, state, members, today) };
    if (!canWrite) return item;
    const inh = inheritedFor(record, f, state);
    return {
      ...item,
      edit: {
        fieldId: f.id,
        kind: f.kind,
        options: [...f.options],
        own: editorValue(f, ownValueFor(record, f, state)),
        ...(inh ? { inherited: { from: inh.from, text: formatValue(f, inh.value, members, today).text } } : {}),
        recordKind: record.kind,
        recordId: record.id,
      },
    };
  });
  return { status: "ok", items };
}
