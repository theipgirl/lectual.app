import { Fragment, type CSSProperties, type ReactNode } from "react";
import { SheetScroll, SheetTable } from "@/components/ui/SheetTable";

/**
 * The ONE List: every List in the app (the Weekly review now; Matters, Contracts and Leads next) draws its table through this, so they
 * look and behave alike. It owns the markup (the sheet table kit's scroller and table, the column group, the header row, the body rows
 * and the empty line) and nothing else: which columns exist, what a cell holds and how it is edited are the caller's. Hook-free and
 * server-safe, so a server component can use it directly and a client island (the editable table) can too.
 *
 * `canEditCells` only says which MODE the table is in (`data-cells`): read-only and editable Lists are the same table with the same
 * classes. It decides no permission: whatever edits a cell checks its own gate, and the server action behind it checks the role again.
 */
export type ListColumn = {
  /** The column's fixed key (the registry id): what a layout, a cell and a CSS hook name. Never changes with a rename. */
  key: string;
  /** The header word: the built-in name, or the firm's own label when the layout renamed it. */
  label: string;
  /** The header's hover text. */
  title?: string;
  /** Saved or chosen width in pixels (null/absent = the table's default for the column). */
  width?: number | null;
  /** The link to the record: first, never hidden. */
  pinned?: boolean;
  /** Typed in place in an editable List. */
  editable?: boolean;
  /** A firm's own column: its kind. */
  kind?: string;
  /** An extra class on this column's header cell. */
  headClass?: string;
};

export type ListRowBase = { /** Unique in the table; `data-row`. */ key: string; /** A row's own height (a viewer's resize). */ height?: number | null };

export function ViewTable<R extends ListRowBase>({
  columns,
  rows,
  cell,
  tableClass,
  fixed,
  minWidth,
  canEditCells = false,
  widthOf,
  renderHead,
  emptyText,
  rowClass,
}: {
  columns: readonly ListColumn[];
  rows: readonly R[];
  /** The `<td>` for a row and a column (a server-drawn cell, or an editor). Null draws no cell. */
  cell: (row: R, column: ListColumn) => ReactNode;
  /** The table's own class beside the kit's (`rv-sheet` or `rse-tbl`: a page's CSS hook). */
  tableClass?: string;
  /** `table-layout: fixed`, with the column group's widths in force. */
  fixed?: boolean;
  /** The narrowest the table gets before it scrolls sideways inside its card. */
  minWidth?: number;
  canEditCells?: boolean;
  /** The width a column is drawn at; when given it decides alone (null = flexible). Absent: the column's own `width`. */
  widthOf?: (column: ListColumn) => number | null | undefined;
  /** The header cell's content (an editable List adds its pencil and resize grip). Default: the label. */
  renderHead?: (column: ListColumn) => ReactNode;
  /** One line drawn instead of rows when there are none. Absent: an empty body. */
  emptyText?: string;
  rowClass?: (row: R) => string | undefined;
}) {
  // A caller's `widthOf` decides alone: its null means flexible (no width), not "fall back to the column's own".
  const width = (c: ListColumn): number | null => (widthOf ? (widthOf(c) ?? null) : (c.width ?? null));
  // A column group only where a width is in force: a table with no widths keeps the plain markup.
  const grouped = fixed || columns.some((c) => width(c) !== null);
  return (
    <SheetScroll>
      <SheetTable className={tableClass} fixed={fixed} minWidth={minWidth} data-cells={canEditCells ? "editable" : "read-only"}>
        {grouped && (
          <colgroup>
            {columns.map((c) => {
              const w = width(c);
              return <col key={c.key} style={w !== null ? ({ width: w } satisfies CSSProperties) : undefined} />;
            })}
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-column={c.key} className={c.headClass} title={c.title}>
                {renderHead ? renderHead(c) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyText ? (
            <tr className="sheet-empty">
              <td colSpan={Math.max(1, columns.length)}>{emptyText}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} data-row={r.key} className={rowClass?.(r)} style={r.height ? { height: r.height } : undefined}>
                {columns.map((c) => (
                  <Fragment key={c.key}>{cell(r, c) ?? null}</Fragment>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </SheetTable>
    </SheetScroll>
  );
}
