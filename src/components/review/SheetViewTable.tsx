"use client";

import type { ReactNode } from "react";
import { ViewTable } from "@/components/views/table/ViewTable";
import { listColumnOf } from "@/lib/review/list-columns";
import { NEXT_MIN_WIDTH, NO_SIZES, colWidth, sheetMinWidth, sizeKeyOf } from "@/lib/review/sheet-edit";
import type { ColumnId, SheetColumn, SheetSectionId } from "@/lib/review/sheet-columns";

export type SheetViewTableRow = { key: string; /** The row's `<td>`s, drawn on the server, by column. */ cells: Partial<Record<ColumnId, ReactNode>> };

/**
 * The read-only List table's draw step: the shared List (`ViewTable`) in read-only mode. The SERVER decides which columns exist
 * (`columns` is `columnsFor`'s list, after the firm's layout) and renders every cell; this island draws exactly those columns, in
 * that order (there is no per-person choice). No read, no permission and no record data moves to the client beyond what the server
 * already rendered.
 */
export function SheetViewTable({ columns, rows }: { section?: SheetSectionId; columns: SheetColumn[]; rows: SheetViewTableRow[] }) {
  const drawn = columns;
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
