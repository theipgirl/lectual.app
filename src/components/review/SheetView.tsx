import Link from "next/link";
import type { ReviewRow } from "@/lib/review/buckets";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { documentsTag } from "@/lib/review/documents";
import { laneOf } from "@/lib/review/lanes";
import { SHEET_COLUMNS, sheetSections, waitingCell } from "@/lib/review/sheet";
import { LastChanged, openHref, type Common } from "./shared";
import { SheetEdit } from "./SheetEdit";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { BLANK, LAST_CONTACT, OWNER_COLUMN, TEAMMATE, UNASSIGNED, SHEET_EMPTY_SECTION } from "@/lib/ui/words";
import "@/components/list-page/list-page.css";
import "./review.css";

function SheetSection({ id, title, rows, today, members, params }: Common & { id: string; title: string; rows: ReviewRow[] }) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return (
    <SheetCard as="section" className="rv-sheet-sec" data-section={id} aria-labelledby={`rv-sheet-${id}`}>
      <h2 id={`rv-sheet-${id}`} className="lx-h3 rv-sheet-title">
        {title} <span className="lx-note">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <div className="rv-strip-note"><EmptyState variant="line">{SHEET_EMPTY_SECTION}</EmptyState></div>
      ) : (
        <SheetScroll>
          <SheetTable className="rv-sheet">
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
                    <td className="pri" title={r.client}>
                      <Link href={openHref(params, r)} className="lx-rowlink" scroll={false}>
                        {r.client}
                      </Link>
                      {documentsTag(r.documentCount) && <span className="lx-note rv-sub">{documentsTag(r.documentCount)}</span>}
                      <LastChanged row={r} members={members} today={today} />
                    </td>
                    <td data-label="Mark">{r.mark ?? <span className="lx-note">{BLANK}</span>}</td>
                    <td data-label="Status">{r.stageLabel ?? <span className="lx-note">{BLANK}</span>}</td>
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
                    <td data-label={OWNER_COLUMN}>{lane ? names.get(lane) ?? TEAMMATE : UNASSIGNED}</td>
                    <td data-label="Waiting on">{waitingCell(r, (d) => shortDate(d, today))}</td>
                    <td data-label="Source">{r.source ?? <span className="lx-note">{BLANK}</span>}</td>
                    <td data-label={LAST_CONTACT}>{lastContactText(r, today)}</td>
                  </tr>
                );
              })}
            </tbody>
          </SheetTable>
        </SheetScroll>
      )}
    </SheetCard>
  );
}

/** The Excel tracker as one table: Trademarks, then Contracts, in pipeline order. Edits happen in the panel the Client link opens. */
export function SheetView({ rows, owner, sheetEdit, ...common }: Common & { rows: ReviewRow[]; /** The owner view's editable sheet (owner view only). */ sheetEdit?: { perms: SheetPerms } }) {
  if (owner && sheetEdit) return <SheetEdit rows={rows} perms={sheetEdit.perms} owner {...common} />;
  const { trademarks, contracts } = sheetSections(rows);
  return (
    <div className="rv-sheets">
      <SheetSection id="trademarks" title="Trademarks" rows={trademarks} {...common} />
      <SheetSection id="contracts" title="Contracts" rows={contracts} {...common} />
    </div>
  );
}
