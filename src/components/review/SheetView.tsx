import Link from "next/link";
import type { ReviewRow } from "@/lib/review/buckets";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { documentsTag } from "@/lib/review/documents";
import { laneOf } from "@/lib/review/lanes";
import { SHEET_COLUMNS, sheetSections, waitingCell } from "@/lib/review/sheet";
import { LastChanged, openHref, type Common } from "./shared";
import { SheetEdit } from "./SheetEdit";
import { NotesCell } from "./NotesCell";
import { noteCellFor, type SheetNotes } from "@/lib/review/sheet-notes";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { BLANK, LAST_CONTACT, OWNER_COLUMN, TEAMMATE, UNASSIGNED, SHEET_EMPTY_SECTION, SHEET_NOTES_COLUMN } from "@/lib/ui/words";
import "@/components/list-page/list-page.css";
import "./review.css";

function SheetSection({ id, title, rows, today, members, params, canWrite, notes }: Common & { id: string; title: string; rows: ReviewRow[]; notes: SheetNotes | null }) {
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
                      {r.company && <span className="lx-note rv-sub">{r.company}</span>}
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
                    <td data-label={SHEET_NOTES_COLUMN} className="rv-notes-td">
                      <NotesCell kind={r.kind} id={r.id} client={r.client} cell={noteCellFor(notes, r)} canEdit={canWrite} today={today} />
                    </td>
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

/** The Excel tracker as one table: Trademarks, then Contracts, in pipeline order. Edits happen in the record card the Client link opens. */
export function SheetView({ rows, owner, sheetEdit, notes = null, ...common }: Common & { rows: ReviewRow[]; /** The owner view's editable sheet (owner view only). */ sheetEdit?: { perms: SheetPerms }; /** The Notes column's reads (sheet-notes.ts). */ notes?: SheetNotes | null }) {
  if (owner && sheetEdit) return <SheetEdit rows={rows} perms={sheetEdit.perms} notes={notes} owner {...common} />;
  const { trademarks, contracts } = sheetSections(rows);
  return (
    <div className="rv-sheets">
      <SheetSection id="trademarks" title="Trademarks" rows={trademarks} notes={notes} {...common} />
      <SheetSection id="contracts" title="Contracts" rows={contracts} notes={notes} {...common} />
    </div>
  );
}
