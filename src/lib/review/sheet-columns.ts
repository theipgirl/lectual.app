import {
  COL_CLIENT_NAME,
  COL_CONTRACT_TYPE,
  COL_CONTRACT_TYPE_TITLE,
  COL_GOV_FEE,
  COL_GOV_FEE_DUE,
  COL_LEGAL_FEE,
  COL_LEGAL_FEE_DUE,
  COL_NEXT_TITLE,
  COL_NOTES,
  COL_OA_DUE,
  COL_OWNER_TITLE,
  COL_PRACTICE_AREA,
  COL_SERIAL,
  COL_SOURCE,
  COL_START,
  COL_START_TITLE,
  COL_STATUS,
  COL_TRADEMARK_NAME,
  COL_TRADEMARK_OWNER,
  COL_WAITING,
  CUSTOM_KIND_CHOICE,
  CUSTOM_KIND_DATE,
  CUSTOM_KIND_MONEY,
  CUSTOM_KIND_PERSON,
  CUSTOM_KIND_TEXT,
  LAST_CONTACT,
  NEXT_STEP,
  NT_COMPLETION_DATE,
  NT_OFFICE_ACTION_FEE,
  NT_OPINION_LETTER_DUE,
  NT_PRIORITY,
  OWNER_COLUMN,
} from "@/lib/ui/words";

/**
 * The List's columns, one registry for both tables (the read-only `SheetView` and the owner's editable Sheet). Pure: no React,
 * no server import, no database. It decides which columns EXIST for a viewer (`columnsFor`: money is dropped unless the page
 * says the viewer may see it, `notes` unless the Notes cell is present). The firm's layout then orders and hides them
 * (`applyReviewLayout`); there is no per-person choice. It never decides access to a record.
 *
 * Internal id note: the owner Sheet's editor id for the Owner column stays `court` in `sheet-edit.ts` (its tests and the
 * `data-rse-cell="<row>|court"` hooks are pinned to it); here the column is `owner`, and `EDIT_ID` maps the two.
 */

export const SHEET_SECTIONS = ["trademarks", "contracts"] as const;
export type SheetSectionId = (typeof SHEET_SECTIONS)[number];

export const COLUMN_IDS = ["client", "mark", "serial", "status", "source", "notes", "owner", "start", "legalFee", "legalFeeDue", "govFee", "govFeeDue", "oaDue", "practiceArea", "next", "waiting", "contact"] as const;
/** The spreadsheet's own columns (Sprint 1). */
export type BuiltinColumnId = (typeof COLUMN_IDS)[number];
/** A firm's own column (lectual 0115, proposed): `cf:` and the field's id. */
export type CustomColumnId = `cf:${string}`;
export type ColumnId = BuiltinColumnId | CustomColumnId;

/* ── Firm-defined custom columns: the part of a field the registry needs (the full rules live in `@/lib/custom-columns/rules`) ── */

export const CUSTOM_KINDS = ["text", "date", "money", "choice", "person"] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];
export const CUSTOM_SECTIONS = ["trademarks", "contracts", "both"] as const;
export type CustomSection = (typeof CUSTOM_SECTIONS)[number];
/** What `columnsFor` needs of a live field. */
export type CustomColumnField = { id: string; section: CustomSection; label: string; kind: CustomKind; position: number };

export const CUSTOM_KIND_WORDS: Record<CustomKind, string> = {
  text: CUSTOM_KIND_TEXT,
  date: CUSTOM_KIND_DATE,
  money: CUSTOM_KIND_MONEY,
  choice: CUSTOM_KIND_CHOICE,
  person: CUSTOM_KIND_PERSON,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFieldId = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
export const customColumnId = (fieldId: string): CustomColumnId => `cf:${fieldId}`;
export const isCustomColumnId = (x: unknown): x is CustomColumnId => typeof x === "string" && x.startsWith("cf:") && isFieldId(x.slice(3));

/** Whether a field belongs to a List section: a `both` field is in each. */
export function fieldFits(field: Pick<CustomColumnField, "section">, section: SheetSectionId): boolean {
  return field.section === "both" || field.section === section;
}

/** A section's live fields in their order: `position`, then label, then id (so two fields never swap between renders). */
export function fieldsForSection<F extends CustomColumnField>(fields: readonly F[], section: SheetSectionId): F[] {
  return fields
    .filter((f) => fieldFits(f, section))
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A custom field as a List column: never pinned; the header is the firm's label, the hover text its kind. A Money field is a money column
 * (owner-only, Taylor Nov 23: `columnsFor` drops it for everyone else). It CAN be typed (Sprint 3); whether a given person may type in a
 * given row is `cellEditable`'s call (role, section), never this flag's.
 */
export function customColumn(field: CustomColumnField): SheetColumn {
  return { id: customColumnId(field.id), header: field.label, title: CUSTOM_KIND_WORDS[field.kind], money: field.kind === "money", pinned: false, editable: true, kind: field.kind };
}

/**
 * A label as the clash rules compare it: every run of whitespace (a tab and a non-breaking space included) becomes one space, the
 * ends lose their spaces, lower case. " Status " and "status" are the same name. Used by the built-in clash, the column clash and CO3.
 */
export function labelKey(label: string): string {
  return label.replace(/\s+/g, " ").replace(/^ +| +$/g, "").toLowerCase();
}

/**
 * Whether the Notes cell (the other session's work: `NotesCell`, `sheet-notes.ts`) is present on this branch. It is, since the merge of
 * `claude/gracious-darwin-rceoyv` at 488dd3d: both tables draw it at the `notes` slot (Trademarks after Source, Contracts after Next
 * step), and the firm's layout hides or moves it like any other column.
 */
export const NOTES_PRESENT = true;

/** Default orders, the spreadsheet's. */
export const SHEET_SECTION_COLUMNS: Record<SheetSectionId, readonly BuiltinColumnId[]> = {
  trademarks: ["client", "mark", "serial", "status", "source", "notes", "owner", "start", "legalFee", "legalFeeDue", "govFee", "govFeeDue", "oaDue", "next", "waiting", "contact"],
  contracts: ["client", "practiceArea", "mark", "status", "next", "notes", "owner", "start", "legalFee", "legalFeeDue", "waiting", "contact"],
};

export const MONEY_COLUMNS: readonly BuiltinColumnId[] = ["legalFee", "legalFeeDue", "govFee", "govFeeDue"];
/** The four a person types in the owner Sheet. */
export const EDITABLE_COLUMN_IDS: readonly BuiltinColumnId[] = ["status", "next", "owner", "source"];
/** Only these are worked out by Lectual from the record, read only. */
export const FACT_COLUMN_IDS = ["serial", "start", "practiceArea", "oaDue", "legalFee", "legalFeeDue", "govFee", "govFeeDue"] as const;
export type FactColumnId = (typeof FACT_COLUMN_IDS)[number];

export type SheetColumn = {
  id: ColumnId;
  /** The header word, from `words.ts`. */
  header: string;
  /** The header's hover text, from `words.ts`, when the word needs one. */
  title?: string;
  money: boolean;
  /** Never hideable, never moved: the link to the record. */
  pinned: boolean;
  /** Typed in the owner Sheet (its editors); every other column is read only. */
  editable: boolean;
  /** A firm's own column: its kind (a header's hover text names it). Absent on the spreadsheet's columns. */
  kind?: CustomKind;
  /** The firm's saved width in pixels (its layout, `applyReviewLayout`). Absent = the table's default. */
  width?: number | null;
};

type Meta = { header: string | Record<SheetSectionId, string>; title?: string | Partial<Record<SheetSectionId, string>> };

const META: Record<BuiltinColumnId, Meta> = {
  client: { header: { trademarks: COL_TRADEMARK_OWNER, contracts: COL_CLIENT_NAME } },
  mark: { header: { trademarks: COL_TRADEMARK_NAME, contracts: COL_CONTRACT_TYPE }, title: { contracts: COL_CONTRACT_TYPE_TITLE } },
  serial: { header: COL_SERIAL },
  status: { header: COL_STATUS },
  source: { header: COL_SOURCE },
  notes: { header: COL_NOTES },
  owner: { header: OWNER_COLUMN, title: COL_OWNER_TITLE },
  start: { header: COL_START, title: COL_START_TITLE },
  legalFee: { header: COL_LEGAL_FEE },
  legalFeeDue: { header: COL_LEGAL_FEE_DUE },
  govFee: { header: COL_GOV_FEE },
  govFeeDue: { header: COL_GOV_FEE_DUE },
  oaDue: { header: COL_OA_DUE },
  practiceArea: { header: COL_PRACTICE_AREA },
  next: { header: NEXT_STEP, title: COL_NEXT_TITLE },
  waiting: { header: COL_WAITING },
  contact: { header: LAST_CONTACT },
};

/** The pinned column: the link to the record, first and never hidden. */
export const isPinnedColumn = (id: ColumnId): boolean => id === "client";

export function sheetColumn(id: BuiltinColumnId, section: SheetSectionId): SheetColumn {
  const meta = META[id];
  const header = typeof meta.header === "string" ? meta.header : meta.header[section];
  const title = typeof meta.title === "string" ? meta.title : meta.title?.[section];
  return { id, header, ...(title ? { title } : {}), money: MONEY_COLUMNS.includes(id), pinned: isPinnedColumn(id), editable: EDITABLE_COLUMN_IDS.includes(id) };
}

/**
 * The columns this viewer may have, in default order. `canSeeMoney` comes from the page's re-resolved role
 * (`canSeeBilling`), never from a browser value; `hasNotes` is whether the Notes cell exists. `customFields` are the firm's live
 * fields (read through the scoped client): that section's come after the spreadsheet columns, in position order. A custom Money
 * column is a REAL owner's only (Taylor, Nov 23): dropped unless `canSeeCustomMoney` is exactly true (`canSeeCustomMoney(role,
 * actingAsStaff)`; Lectual staff inside a firm never get it, while `canSeeMoney` keeps the built-in fee columns as they were), so
 * nobody else is given it.
 */
export function columnsFor(section: SheetSectionId, opts: { canSeeMoney: boolean; canSeeCustomMoney?: boolean; hasNotes: boolean; customFields?: readonly CustomColumnField[] }): SheetColumn[] {
  const builtin = SHEET_SECTION_COLUMNS[section]
    .filter((id) => (opts.canSeeMoney || !MONEY_COLUMNS.includes(id)) && (opts.hasNotes || id !== "notes"))
    .map((id) => sheetColumn(id, section));
  return [...builtin, ...fieldsForSection(opts.customFields ?? [], section).filter((f) => opts.canSeeCustomMoney === true || f.kind !== "money").map(customColumn)];
}

/** The "No home" spreadsheet columns, named once in the note above each section. */
export const NOT_TRACKED: Record<SheetSectionId, readonly string[]> = {
  trademarks: [NT_PRIORITY, NT_OPINION_LETTER_DUE, NT_COMPLETION_DATE, NT_OFFICE_ACTION_FEE],
  contracts: [NT_PRIORITY, NT_COMPLETION_DATE],
};

/**
 * Every header the registry has for a section, whoever is looking (the money and Notes headers included): a custom column may not
 * take one of these names, so it never sits next to a column with the same header.
 */
export function builtinHeaders(section: SheetSectionId): string[] {
  return SHEET_SECTION_COLUMNS[section].map((id) => sheetColumn(id, section).header);
}

/** The part of a custom-columns state the "Not tracked" rule needs (the full type lives in `@/lib/custom-columns/rules`). */
export type CustomStateLike = { status: string; fields?: readonly Pick<CustomColumnField, "label" | "section">[] } | null | undefined;

/**
 * CO3: the "Not tracked in Lectual yet" names for a section, without the ones the firm has added as a LIVE custom column that shows in
 * that section (same `labelKey`). When the custom state is not `ok` (not read, not switched on, couldn't load), nothing is dropped.
 */
export function notTrackedFor(section: SheetSectionId, state: CustomStateLike): string[] {
  const names = NOT_TRACKED[section];
  if (!state || state.status !== "ok" || !state.fields) return [...names];
  const taken = new Set(state.fields.filter((f) => fieldFits(f, section)).map((f) => labelKey(f.label)));
  return names.filter((n) => !taken.has(labelKey(n)));
}
