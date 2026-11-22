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
export type ColumnId = (typeof COLUMN_IDS)[number];

/**
 * Whether the Notes cell (another session's work) is present on this branch. It is not: no Notes header or cell is drawn.
 * When that work is merged it flips this and places its cell at the `notes` slot; nothing else here changes.
 */
export const NOTES_PRESENT = false;

/** Default orders, the spreadsheet's. */
export const SHEET_SECTION_COLUMNS: Record<SheetSectionId, readonly ColumnId[]> = {
  trademarks: ["client", "mark", "serial", "status", "source", "notes", "owner", "start", "legalFee", "legalFeeDue", "govFee", "govFeeDue", "oaDue", "next", "waiting", "contact"],
  contracts: ["client", "practiceArea", "mark", "status", "next", "notes", "owner", "start", "legalFee", "legalFeeDue", "waiting", "contact"],
};

export const MONEY_COLUMNS: readonly ColumnId[] = ["legalFee", "legalFeeDue", "govFee", "govFeeDue"];
/** The four a person types in the owner Sheet. */
export const EDITABLE_COLUMN_IDS: readonly ColumnId[] = ["status", "next", "owner", "source"];
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
};

type Meta = { header: string | Record<SheetSectionId, string>; title?: string | Partial<Record<SheetSectionId, string>> };

const META: Record<ColumnId, Meta> = {
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

export function sheetColumn(id: ColumnId, section: SheetSectionId): SheetColumn {
  const meta = META[id];
  const header = typeof meta.header === "string" ? meta.header : meta.header[section];
  const title = typeof meta.title === "string" ? meta.title : meta.title?.[section];
  return { id, header, ...(title ? { title } : {}), money: MONEY_COLUMNS.includes(id), pinned: id === "client", editable: EDITABLE_COLUMN_IDS.includes(id) };
}

/**
 * The columns this viewer may have, in default order. `canSeeMoney` comes from the page's re-resolved role
 * (`canSeeBilling`), never from a browser value; `hasNotes` is whether the Notes cell exists.
 */
export function columnsFor(section: SheetSectionId, opts: { canSeeMoney: boolean; hasNotes: boolean }): SheetColumn[] {
  return SHEET_SECTION_COLUMNS[section]
    .filter((id) => (opts.canSeeMoney || !MONEY_COLUMNS.includes(id)) && (opts.hasNotes || id !== "notes"))
    .map((id) => sheetColumn(id, section));
}

/** The "No home" spreadsheet columns, named once in the note above each section. */
export const NOT_TRACKED: Record<SheetSectionId, readonly string[]> = {
  trademarks: [NT_PRIORITY, NT_OPINION_LETTER_DUE, NT_COMPLETION_DATE, NT_OFFICE_ACTION_FEE],
  contracts: [NT_PRIORITY, NT_COMPLETION_DATE],
};

/* ── The per-person chooser: pure rules over `{ order, hidden }` ── */

export type SectionPrefs = { order: ColumnId[]; hidden: ColumnId[] };
export type StoredPrefs = { v: 1; trademarks: SectionPrefs; contracts: SectionPrefs };

export const COLUMN_PREFS_VERSION = 1;
/** More ids than any section has: a longer stored list is cut, not trusted. */
const MAX_STORED_IDS = 64;

const isColumnId = (x: unknown): x is ColumnId => typeof x === "string" && (COLUMN_IDS as readonly string[]).includes(x);

/**
 * Cleans one section's stored `{ order, hidden }` against the columns `columnsFor` allowed. Unknown ids, ids not allowed (a stored
 * money id for a non-owner), duplicates and an over-long list are dropped; allowed ids missing from the stored order come back at
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
  const pinned = order.filter((id) => sheetColumn(id, "trademarks").pinned);
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
  if (!allowed.includes(action.id) || sheetColumn(action.id, "trademarks").pinned) return cur;
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
