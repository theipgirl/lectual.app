/**
 * A small CSV reader for the intake sheet export ("Save as CSV" from Excel or Google Sheets).
 *
 * Pure and dependency-free: no spreadsheet library is installed in this app, and an XLSX reader
 * is not added for one screen. It handles what a sheet export really contains: quoted cells with
 * commas, doubled quotes and line breaks inside them (the Description log is one multi-line
 * cell), a leading byte-order mark, CRLF or LF, and rows of different lengths.
 *
 * It refuses an unterminated quote instead of guessing where the cell ends: swallowing the rest
 * of the file into one cell would silently drop every lead below it.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Parses CSV text into a grid of cells (header row first). A final line break adds no row. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // True once the current row has any content or separator, so a trailing newline adds no row.
  let rowStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      rowStarted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      rowStarted = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      rowStarted = false;
    } else {
      cell += ch;
      rowStarted = true;
    }
  }

  if (inQuotes) {
    throw new CsvError("A quoted cell is never closed, so the rest of the file cannot be read reliably.");
  }
  if (rowStarted || cell !== "") {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
