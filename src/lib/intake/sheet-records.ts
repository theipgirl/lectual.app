// Ported from theipgirl/lectual `src/lib/matters/tracker-import-plan.ts` (main @ 0c65dca):
// `recordsFromSheetRows` and its `headerKey` helper only, logic unchanged. The rest of that file
// (the tracker → matter import plan) is not used here.

/**
 * Normalize one header cell to the key the parse layer matches on.
 *
 * The owner column's header is literally the number 0, so numbers stringify
 * ('0'); blank headers become `''`, which is how parseRow's spacer-column rule
 * addresses them.
 */
function headerKey(cell: unknown): string {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" && Number.isFinite(cell)) return String(cell);
  return "";
}

/**
 * Build parse-layer rows from a sheet read as a raw grid (header row first).
 *
 * Duplicate header keys keep the FIRST column and drop the later ones — this is
 * what makes "only the first blank-header column is the owner" hold: a second
 * spacer column also headed `''` never reaches the row object at all.
 * Trailing header whitespace is NOT trimmed ('Serial No. ' is a real header
 * the parse layer matches verbatim).
 */
export function recordsFromSheetRows(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): Array<Record<string, unknown>> {
  if (rows.length === 0) return [];
  const [header, ...data] = rows;

  // Column index → key, with later duplicates masked out (null = dropped).
  const seen = new Set<string>();
  const keys: Array<string | null> = header.map((cell) => {
    const key = headerKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
    return key;
  });

  return data.map((cells) => {
    const record: Record<string, unknown> = {};
    keys.forEach((key, i) => {
      if (key === null) return;
      record[key] = cells[i] ?? null;
    });
    return record;
  });
}
