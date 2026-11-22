import type { FactCell } from "@/lib/review/sheet-cells";

/**
 * One read-only cell of the List's spreadsheet columns (serial, dates, practice area, owner-only fees). No hooks and no client code, so
 * the server's `SheetView` and the owner Sheet's client table draw it the same way. A failed read is said, a dash is "nothing recorded",
 * and a past-due office action date carries the risk class.
 */
export function SheetFactTd({ cell, label, className, quiet = "lx-note" }: { cell: FactCell | undefined; label: string; className?: string; quiet?: string }) {
  const c: FactCell = cell ?? { text: "—", tone: "none" };
  const classes = [className, c.overdue ? "rv-oa-overdue" : null].filter(Boolean).join(" ") || undefined;
  return (
    <td data-label={label} className={classes} title={c.title}>
      {c.tone === "value" ? c.text : <span className={quiet}>{c.text}</span>}
    </td>
  );
}
