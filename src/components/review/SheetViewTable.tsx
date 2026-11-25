"use client";

import type { ReactNode } from "react";
import { ViewTable } from "@/components/views/table/ViewTable";
import { listColumnOf } from "@/lib/review/list-columns";
import { NEXT_MIN_WIDTH, NO_SIZES, colWidth, sheetMinWidth, sizeKeyOf } from "@/lib/review/sheet-edit";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import type { ColumnId, SheetColumn, SheetSectionId } from "@/lib/review/sheet-columns";
import { useColumnPrefs } from "./use-column-prefs";

export type SheetViewTableRow = { key: string; /** The row's `<td>`s, drawn on the server, by column. */ cells: Partial<Record<ColumnId, ReactNode>> };

/**
 * The read-only List table's draw step: the shared List (`ViewTable`) in read-only mode. The SERVER decides which columns exist
 * (`columns` is `columnsFor`'s list, after the firm's layout) and renders every cell; this island only puts them in the order the
 * person chose and leaves out the ones they hid. No read, no permission and no record data moves to the client beyond what the server
 * already rendered.
 */
export function SheetViewTable({ section, columns, rows, initialPrefs }: { section: SheetSectionId; columns: SheetColumn[]; rows: SheetViewTableRow[]; initialPrefs?: PrefsDocument }) {
  const { columns: drawn } = useColumnPrefs(section, columns, initialPrefs);
  // A column the firm gave a width is drawn at it; otherwise the registry's default decides how wide the table must be.
  const minWidth = drawn.reduce((total, c) => total + (c.width ?? colWidth(NO_SIZES, sizeKeyOf(c.id)) ?? NEXT_MIN_WIDTH), 0);
  return (
    <ViewTable
      columns={drawn.map(listColumnOf)}
      rows={rows}
      cell={(r, c) => r.cells[c.key as ColumnId] ?? null}
      tableClass="rv-sheet"
      minWidth={drawn.some((c) => c.width) ? minWidth : sheetMinWidth(NO_SIZES, drawn.map((c) => sizeKeyOf(c.id)))}
    />
  );
}
