import type { StageRef } from "@/lib/lawmatics/stage-map";
import { CsvError, parseCsv } from "./sheet-csv";
import { MAX_SHEET_BYTES } from "./sheet-limits";
import { recordsFromSheetRows } from "./sheet-records";
import {
  parseIntakeSheet,
  sheetKeyFor,
  type IntakeRowRefusal,
} from "./sheet-import";

/**
 * Reading the uploaded intake sheet (CSV text) into per-row readings the reconciliation screen can
 * match to leads. Pure: no I/O, no framework imports.
 *
 * The parse itself is the port of lectual's `parseIntakeSheet` (./sheet-import). This file adds the
 * three things that screen needs and the importer does not:
 *
 *  - file checks with plain sentences (CSV only; XLSX is refused, see SHEET_MESSAGES.excel);
 *  - a reading for rows the importer REFUSES but which still say something about a lead: a client
 *    status code (7 and above) means the person is a client, and a status the firm's pipeline does
 *    not name is "unmapped". The importer drops both without a key; here each is kept with the
 *    owner and mark it can be matched on;
 *  - match keys under every intake status code, because `sheetKeyFor` includes the status code and
 *    a row that moved on the sheet therefore has a new key (see `intakeCodeKeys`).
 */

export { MAX_SHEET_BYTES };

export const SHEET_MESSAGES = {
  noFile: "Choose the intake sheet as a CSV file first.",
  excel:
    "That looks like an Excel workbook. Save the sheet as CSV (in Excel or Google Sheets: File, then Save as or Download, then CSV) and upload that file.",
  notCsv: "Only a CSV file can be read here. Save the sheet as CSV and upload that file.",
  tooBig: "That file is larger than 5 MB. Export only the intake sheet as CSV and try again.",
  empty: "That file is empty. Check that you exported the right sheet.",
  unterminated:
    "A quoted cell in that file is never closed, so the file cannot be read reliably. Save the sheet as CSV again and retry.",
  noStatus:
    'That sheet has no "Status" column, so there is nothing to read stages from. Check that you exported the intake sheet.',
  noRows: "That sheet has a Status column but no rows of leads under it.",
} as const;

export type SheetFileCheck = { ok: true } | { ok: false; error: string };

/** Extension and size, before the file is opened. Order matters: each refusal has its own sentence. */
export function checkSheetFile(name: string | null | undefined, size: number): SheetFileCheck {
  const lower = (name ?? "").trim().toLowerCase();
  if (!lower) return { ok: false, error: SHEET_MESSAGES.noFile };
  if (/\.(xlsx|xlsm|xlsb|xls)$/.test(lower)) return { ok: false, error: SHEET_MESSAGES.excel };
  if (!lower.endsWith(".csv")) return { ok: false, error: SHEET_MESSAGES.notCsv };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: SHEET_MESSAGES.empty };
  if (size > MAX_SHEET_BYTES) return { ok: false, error: SHEET_MESSAGES.tooBig };
  return { ok: true };
}

/** What a sheet row says about the person it names. */
export type SheetReading =
  | {
      kind: "ok";
      stageId: string;
      stageName: string;
      /** The sheet's own Status text, e.g. "3. Consultation Scheduled". */
      wording: string;
      /** The newest dated log entry that is not in the future, or null. */
      date: string | null;
    }
  | { kind: "client"; wording: string }
  | { kind: "unmapped"; wording: string };

export type SheetEntry = {
  /** 1-based worksheet row (the header is row 1). */
  row: number;
  ownerName: string;
  markText: string | null;
  /** The importer's own key for this row (its own status code); null for a row the importer refused. */
  exactKey: string | null;
  /** The key this owner and mark would have under each intake status code 0 to 6. */
  anyCodeKeys: string[];
  reading: SheetReading;
};

export type SheetRead = {
  entries: SheetEntry[];
  refused: IntakeRowRefusal[];
  blankRows: number;
  rowsRead: number;
  /** Rows the importer would keep as intake leads (after merging repeated rows). */
  intakeRows: number;
};

export type SheetReadResult = { ok: true; read: SheetRead } | { ok: false; error: string };

const INTAKE_CODES = ["0", "1", "2", "3", "4", "5", "6"] as const;
const CLIENT_REFUSAL = "client, not intake — use import-tracker";

/**
 * `sheetKeyFor` hashes owner, mark AND status code, so a person who moved from code 1 to code 3 on
 * the sheet has a different key from the one stored on their lead. These are the keys that owner and
 * mark would have had under any intake code, so a moved row still finds its lead.
 */
export function intakeCodeKeys(ownerName: string, markText: string | null): string[] {
  return INTAKE_CODES.map((stageCode) => sheetKeyFor({ ownerName, markText, stageCode }));
}

function cellText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** The same owner and mark columns, in the same order, that the ported parser reads. */
function ownerAndMark(record: Record<string, unknown>): { owner: string | null; mark: string | null } {
  return {
    owner: cellText(record, "0", "Trademark Owner", "", "Owner", "Client"),
    mark: cellText(record, "Trademark Name", "Mark"),
  };
}

/** Header cells are matched as written, except that stray spaces around "Status" are forgiven. */
function tidyHeader(header: readonly string[]): string[] {
  return header.map((cell) => (cell.trim() === "Status" ? "Status" : cell));
}

export type SheetRecords = { ok: true; records: Array<Record<string, unknown>> } | { ok: false; error: string };

/**
 * Turns CSV text into the parse layer's rows and checks the file's shape. Needs no database: every
 * refusal that is about the FILE (empty, unclosed quote, no Status column, no rows) comes from here,
 * before anything else is read.
 */
export function parseSheetRecords(text: string): SheetRecords {
  if (!text.trim()) return { ok: false, error: SHEET_MESSAGES.empty };

  let grid: string[][];
  try {
    grid = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) return { ok: false, error: SHEET_MESSAGES.unterminated };
    throw err;
  }
  if (grid.length === 0) return { ok: false, error: SHEET_MESSAGES.empty };

  const header = tidyHeader(grid[0]);
  if (!header.includes("Status")) return { ok: false, error: SHEET_MESSAGES.noStatus };

  const records = recordsFromSheetRows([header, ...grid.slice(1)]);
  if (!records.some((r) => cellText(r, "Status") !== null)) return { ok: false, error: SHEET_MESSAGES.noRows };
  return { ok: true, records };
}

/** Reads the parsed rows against the firm's stages. */
export function readSheetRecords(
  records: ReadonlyArray<Record<string, unknown>>,
  stages: readonly StageRef[],
  now: Date,
): SheetRead {
  const parsed = parseIntakeSheet(records, { now, stages });

  const entries: SheetEntry[] = parsed.rows.map((row) => ({
    row: row.row,
    ownerName: row.ownerName,
    markText: row.markText,
    exactKey: row.sheetKey,
    anyCodeKeys: intakeCodeKeys(row.ownerName, row.markText),
    reading: {
      kind: "ok",
      stageId: row.stageId,
      stageName: row.stageName,
      wording: row.statusText,
      date: row.lastActivityAt,
    },
  }));

  // Refused rows that still name a person: a client code, or a status the pipeline does not name.
  for (const refusal of parsed.refused) {
    const record = records[refusal.row - 2];
    if (!record || !refusal.statusText) continue;
    const { owner, mark } = ownerAndMark(record);
    if (!owner) continue;
    entries.push({
      row: refusal.row,
      ownerName: owner,
      markText: mark,
      exactKey: null,
      anyCodeKeys: intakeCodeKeys(owner, mark),
      reading:
        refusal.reason === CLIENT_REFUSAL
          ? { kind: "client", wording: refusal.statusText }
          : { kind: "unmapped", wording: refusal.statusText },
    });
  }

  return {
    entries,
    refused: parsed.refused,
    blankRows: parsed.blankRows,
    rowsRead: parsed.rowsRead,
    intakeRows: parsed.rows.length,
  };
}

/** Both steps in one call, for callers that already hold the stages. */
export function readSheetText(text: string, stages: readonly StageRef[], now: Date): SheetReadResult {
  const parsed = parseSheetRecords(text);
  if (!parsed.ok) return parsed;
  return { ok: true, read: readSheetRecords(parsed.records, stages, now) };
}
