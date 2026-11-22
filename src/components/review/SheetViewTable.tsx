"use client";

import { Fragment, type ReactNode } from "react";
import { SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { NO_SIZES, editColumnOf, sheetMinWidth } from "@/lib/review/sheet-edit";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import type { ColumnId, SheetColumn, SheetSectionId } from "@/lib/review/sheet-columns";
import { useColumnPrefs } from "./use-column-prefs";

export type SheetViewTableRow = { key: string; /** The row's `<td>`s, drawn on the server, by column. */ cells: Partial<Record<ColumnId, ReactNode>> };

/**
 * The read-only List table's draw step. The SERVER decides which columns exist (`columns` is `columnsFor`'s list) and renders every
 * cell; this island only puts them in the order the person chose and leaves out the ones they hid. No read, no permission and no
 * record data moves to the client beyond what the server already rendered.
 */
export function SheetViewTable({ section, columns, rows, initialPrefs }: { section: SheetSectionId; columns: SheetColumn[]; rows: SheetViewTableRow[]; initialPrefs?: PrefsDocument }) {
  const { columns: drawn } = useColumnPrefs(section, columns, initialPrefs);
  return (
    <SheetScroll>
      <SheetTable className="rv-sheet" minWidth={sheetMinWidth(NO_SIZES, false, drawn.map((c) => editColumnOf(c.id)))}>
        <thead>
          <tr>
            {drawn.map((c) => (
              <th key={c.id} title={c.title} data-column={c.id}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {drawn.map((c) => (
                <Fragment key={c.id}>{r.cells[c.id] ?? null}</Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </SheetTable>
    </SheetScroll>
  );
}
