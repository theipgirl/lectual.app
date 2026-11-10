import Link from "next/link";
import type { ReviewRow } from "@/lib/review/buckets";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { laneOf } from "@/lib/review/lanes";
import { SHEET_COLUMNS, sheetSections, waitingCell } from "@/lib/review/sheet";
import { openHref, type Common } from "./shared";
import { SheetEdit } from "./SheetEdit";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import "@/components/list-page/list-page.css";
import "./review.css";

function SheetTable({ id, title, rows, today, members, params }: Common & { id: string; title: string; rows: ReviewRow[] }) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return (
    <section className="lx-card rv-sheet-sec" data-section={id} aria-labelledby={`rv-sheet-${id}`}>
      <h2 id={`rv-sheet-${id}`} className="lx-h2 rv-sheet-title">
        {title} <span className="lx-note">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="lx-note rv-strip-note">Nothing here for this view.</p>
      ) : (
        <div className="rv-sheet-wrap">
          <table className="lx-tbl lx-stack rv-sheet">
            <thead>
              <tr>
                {SHEET_COLUMNS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = r.nextStep ? dueText(r.nextStep.dueDate, today) : null;
                const lane = laneOf(r);
                return (
                  <tr key={r.key}>
                    <td className="pri">
                      <Link href={openHref(params, r)} className="lx-rowlink" scroll={false}>
                        {r.client}
                      </Link>
                    </td>
                    <td data-label="Mark">{r.mark ?? <span className="lx-note">—</span>}</td>
                    <td data-label="Status">{r.stageLabel ?? <span className="lx-note">—</span>}</td>
                    <td data-label="Next step">
                      {r.nextStep && due ? (
                        <>
                          {r.nextStep.title}
                          <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>{due.text}</span>
                        </>
                      ) : (
                        <span className="lx-note">No next step</span>
                      )}
                    </td>
                    <td data-label="Whose court">{lane ? names.get(lane) ?? "Teammate" : "Unassigned"}</td>
                    <td data-label="Waiting on">{waitingCell(r, (d) => shortDate(d, today))}</td>
                    <td data-label="Source">{r.source ?? <span className="lx-note">—</span>}</td>
                    <td data-label="Last contact">{lastContactText(r, today)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The Excel tracker as one table: Trademarks, then Contracts, in pipeline order. Edits happen in the panel the Client link opens. */
export function SheetView({ rows, owner, sheetEdit, ...common }: Common & { rows: ReviewRow[]; /** The owner view's editable sheet (owner view only). */ sheetEdit?: { perms: SheetPerms } }) {
  if (owner && sheetEdit) return <SheetEdit rows={rows} perms={sheetEdit.perms} owner {...common} />;
  const { trademarks, contracts } = sheetSections(rows);
  return (
    <div className="rv-sheets">
      <SheetTable id="trademarks" title="Trademarks" rows={trademarks} {...common} />
      <SheetTable id="contracts" title="Contracts" rows={contracts} {...common} />
      {owner && <p className="rv-sheet-note">Next step and Whose court come from next steps and mail, not from the spreadsheet. Edits happen in the record panel.</p>}
    </div>
  );
}
