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
 * says the viewer may see it, `notes` unless the Notes cell is present) and, for the per-person chooser, what is DRAWN
 * (`applyColumnPrefs`, which can only hide or reorder what `columnsFor` allowed). It never decides access to a record.
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
const isBuiltinColumnId = (x: unknown): x is BuiltinColumnId => typeof x === "string" && (COLUMN_IDS as readonly string[]).includes(x);

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
 * step), and the chooser hides or moves it like any other column.
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
  /** A firm's own column: its kind (the chooser names it). Absent on the spreadsheet's columns. */
  kind?: CustomKind;
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
 * nobody else's chooser lists it and a stored pref naming it is dropped by `parseColumnPrefs`.
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

/* ── The per-person chooser: pure rules over `{ order, hidden }` ── */

export type SectionPrefs = { order: ColumnId[]; hidden: ColumnId[] };
export type StoredPrefs = { v: 1; trademarks: SectionPrefs; contracts: SectionPrefs };

export const COLUMN_PREFS_VERSION = 1;
/** More ids than any section has (17 of the spreadsheet's plus at most 40 of the firm's): a longer stored list is cut, not trusted. */
const MAX_STORED_IDS = 64;

const isColumnId = (x: unknown): x is ColumnId => isBuiltinColumnId(x) || isCustomColumnId(x);

/**
 * Cleans one section's stored `{ order, hidden }` against the columns `columnsFor` allowed. Unknown ids, ids not allowed (a stored
 * money id for a non-owner, a `cf:` id of a field that is archived, of the other section or not given), duplicates and an over-long list are dropped; allowed ids missing from the stored order come back at
 * their default position (after the nearest earlier default column that is present); the pinned column is first and never hidden.
 */
export function parseColumnPrefs(raw: unknown, allowed: readonly ColumnId[]): SectionPrefs {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { order?: unknown; hidden?: unknown }) : {};
  const ok = new Set<ColumnId>(allowed);
  const list = (v: unknown): ColumnId[] => (Array.isArray(v) ? v.slice(0, MAX_STORED_IDS).filter(isColumnId).filter((id) => ok.has(id)) : []);
  const order: ColumnId[] = [];
  for (const id of list(obj.order)) if (!order.includes(id)) order.push(id);
  allowed.forEach((id, i) => {
    if (order.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(allowed[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
  });
  const pinned = order.filter(isPinnedColumn);
  const withPinnedFirst = [...pinned, ...order.filter((id) => !pinned.includes(id))];
  const hidden: ColumnId[] = [];
  for (const id of list(obj.hidden)) if (!hidden.includes(id) && !pinned.includes(id)) hidden.push(id);
  return { order: withPinnedFirst, hidden };
}

export function defaultSectionPrefs(allowed: readonly ColumnId[]): SectionPrefs {
  return { order: [...allowed], hidden: [] };
}

export function defaultStoredPrefs(allowed: Record<SheetSectionId, readonly ColumnId[]>): StoredPrefs {
  return { v: 1, trademarks: defaultSectionPrefs(allowed.trademarks), contracts: defaultSectionPrefs(allowed.contracts) };
}

/** The raw stored string (or nothing) as a whole document: malformed JSON, a non-object or another version is "nothing stored". */
export function parseStoredDocument(raw: string | null | undefined): { trademarks: unknown; contracts: unknown } | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if ((data as { v?: unknown }).v !== COLUMN_PREFS_VERSION) return null;
  return { trademarks: (data as { trademarks?: unknown }).trademarks, contracts: (data as { contracts?: unknown }).contracts };
}

/** The columns to DRAW: `allowed` (from `columnsFor`) reordered and thinned by the person's prefs. Nothing outside `allowed` can appear. */
export function applyColumnPrefs(allowed: readonly SheetColumn[], prefs: unknown | null): SheetColumn[] {
  if (!prefs) return [...allowed];
  const clean = parseColumnPrefs(prefs, allowed.map((c) => c.id));
  const byId = new Map(allowed.map((c) => [c.id, c]));
  return clean.order.filter((id) => !clean.hidden.includes(id)).map((id) => byId.get(id)!);
}

export type PrefsAction =
  | { type: "toggle"; id: ColumnId }
  | { type: "move"; id: ColumnId; dir: -1 | 1 }
  | { type: "reset" };

/** The chooser's edits, over a section's prefs already cleaned against `allowed`. The pinned column can't be hidden or moved. */
export function prefsReducer(prefs: SectionPrefs, action: PrefsAction, allowed: readonly ColumnId[]): SectionPrefs {
  if (action.type === "reset") return defaultSectionPrefs(allowed);
  const cur = parseColumnPrefs(prefs, allowed);
  if (!allowed.includes(action.id) || isPinnedColumn(action.id)) return cur;
  if (action.type === "toggle") {
    return { ...cur, hidden: cur.hidden.includes(action.id) ? cur.hidden.filter((x) => x !== action.id) : [...cur.hidden, action.id] };
  }
  const at = cur.order.indexOf(action.id);
  const to = at + action.dir;
  // The pinned column holds the first place, so nothing moves above index 1.
  if (at < 0 || to < 1 || to >= cur.order.length) return cur;
  const order = [...cur.order];
  [order[at], order[to]] = [order[to], order[at]];
  return { ...cur, order };
}
