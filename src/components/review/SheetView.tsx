import Link from "next/link";
import type { ReviewRow } from "@/lib/review/buckets";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { documentsTag } from "@/lib/review/documents";
import { laneOf } from "@/lib/review/lanes";
import { sheetSections, waitingCell } from "@/lib/review/sheet";
import { FACT_COLUMN_IDS, NOTES_PRESENT, columnsFor, type ColumnId, type CustomStateLike, type SheetColumn, type SheetSectionId } from "@/lib/review/sheet-columns";
import { factCells, type FactCell } from "@/lib/review/sheet-cells";
import { customCells, noteStateOf, type CustomColumnsState, type CustomMember } from "@/lib/custom-columns/rules";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import { LastChanged, openHref, type Common } from "./shared";
import { SheetEdit } from "./SheetEdit";
import { SectionNote } from "./SectionNote";
import { SheetFactTd } from "./SheetFactTd";
import { SheetViewTable, type SheetViewTableRow } from "./SheetViewTable";
import type { SheetPerms } from "@/lib/review/sheet-edit";
import { SheetCard } from "@/components/ui/SheetTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { BLANK, TEAMMATE, UNASSIGNED, SHEET_EMPTY_SECTION } from "@/lib/ui/words";
import "@/components/list-page/list-page.css";
import "./review.css";

function SheetSection({ id, title, rows, today, members, params, columns, initialPrefs, custom, noteState, adminTier }: Common & { id: SheetSectionId; title: string; rows: ReviewRow[]; columns: SheetColumn[]; initialPrefs?: PrefsDocument; /** The firm's columns' cells by row key, then `cf:<field id>`. */ custom: Record<string, Record<string, FactCell>>; /** What the section note needs of the custom state (null: not read). */ noteState: CustomStateLike; adminTier: boolean }) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const dash = <span className="lx-note">{BLANK}</span>;
  const tableRows: SheetViewTableRow[] = rows.map((r) => {
    const due = r.nextStep ? dueText(r.nextStep.dueDate, today) : null;
    const lane = laneOf(r);
    const facts = factCells(r, today);
    const label = (cid: ColumnId) => columns.find((c) => c.id === cid)?.header ?? "";
    const cells: SheetViewTableRow["cells"] = {
      client: (
        <td className="pri" title={r.client}>
          <Link href={openHref(params, r)} className="lx-rowlink" scroll={false}>
            {r.client}
          </Link>
          {r.company && <span className="lx-note rv-sub">{r.company}</span>}
          {documentsTag(r.documentCount) && <span className="lx-note rv-sub">{documentsTag(r.documentCount)}</span>}
          <LastChanged row={r} members={members} today={today} />
        </td>
      ),
      mark: <td data-label={label("mark")}>{r.mark ?? dash}</td>,
      status: <td data-label={label("status")}>{r.stageLabel ?? dash}</td>,
      next: (
        <td data-label={label("next")}>
          {r.nextStep && due ? (
            <>
              {r.nextStep.title}
              <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>{due.text}</span>
            </>
          ) : (
            <span className="lx-note">No next step</span>
          )}
        </td>
      ),
      owner: <td data-label={label("owner")}>{lane ? names.get(lane) ?? TEAMMATE : UNASSIGNED}</td>,
      waiting: <td data-label={label("waiting")}>{waitingCell(r, (d) => shortDate(d, today))}</td>,
      source: <td data-label={label("source")}>{r.source ?? dash}</td>,
      contact: <td data-label={label("contact")}>{lastContactText(r, today)}</td>,
    };
    // Only the columns this viewer is allowed: no fee cell is built (or shipped to the browser) for anyone else.
    for (const f of FACT_COLUMN_IDS) if (columns.some((c) => c.id === f)) cells[f] = <SheetFactTd cell={facts[f]} label={label(f)} />;
    // The firm's own columns: read-only cells, the same three states as the facts.
    for (const c of columns) if (c.kind) cells[c.id] = <SheetFactTd cell={custom[r.key]?.[c.id]} label={c.header} />;
    return { key: r.key, cells };
  });
  return (
    <SheetCard as="section" className="rv-sheet-sec" data-section={id} aria-labelledby={`rv-sheet-${id}`}>
      <h2 id={`rv-sheet-${id}`} className="lx-h3 rv-sheet-title">
        {title} <span className="lx-note">{rows.length}</span>
      </h2>
      <SectionNote section={id} customState={noteState} adminTier={adminTier} />
      {rows.length === 0 ? (
        <div className="rv-strip-note"><EmptyState variant="line">{SHEET_EMPTY_SECTION}</EmptyState></div>
      ) : (
        <SheetViewTable section={id} columns={columns} rows={tableRows} initialPrefs={initialPrefs} />
      )}
    </SheetCard>
  );
}

/** The Excel tracker as one table: Trademarks, then Contracts, in pipeline order. Edits happen in the record card the Client link opens. */
export function SheetView({ rows, owner, sheetEdit, canSeeMoney = false, initialPrefs, custom = null, customMembers, adminTier = false, ...common }: Common & {
  rows: ReviewRow[];
  /** The owner view's editable sheet (owner view only). */ sheetEdit?: { perms: SheetPerms };
  /** From the page's re-resolved role (`canSeeBilling`), never from the browser. */ canSeeMoney?: boolean;
  /** Drawing-only starting column choices (a test or preview). */ initialPrefs?: PrefsDocument;
  /** The firm's custom columns as the page read them (null: not read). Only `ok` adds columns. */ custom?: CustomColumnsState | null;
  /** The member directory for person cells; null when it couldn't be read (a person cell then says so). Defaults to `members`. */ customMembers?: CustomMember[] | null;
  /** The admin tier (`canSeeSetup` of the page's re-resolved role): the section note's "not switched on" line and "Add a column" link are theirs only. */ adminTier?: boolean;
}) {
  if (owner && sheetEdit) return <SheetEdit rows={rows} perms={sheetEdit.perms} owner canSeeMoney={canSeeMoney} initialPrefs={initialPrefs} custom={custom} customMembers={customMembers} adminTier={adminTier} {...common} />;
  const { trademarks, contracts } = sheetSections(rows);
  const fields = custom?.status === "ok" ? custom.fields : [];
  const cells = custom?.status === "ok" ? customCells(rows, fields, custom, customMembers === undefined ? common.members : customMembers, common.today) : {};
  const noteState = noteStateOf(custom);
  const columns = { trademarks: columnsFor("trademarks", { canSeeMoney, hasNotes: NOTES_PRESENT, customFields: fields }), contracts: columnsFor("contracts", { canSeeMoney, hasNotes: NOTES_PRESENT, customFields: fields }) };
  return (
    <div className="rv-sheets">
      <SheetSection id="trademarks" title="Trademarks" rows={trademarks} columns={columns.trademarks} initialPrefs={initialPrefs} custom={cells} noteState={noteState} adminTier={adminTier} {...common} />
      <SheetSection id="contracts" title="Contracts" rows={contracts} columns={columns.contracts} initialPrefs={initialPrefs} custom={cells} noteState={noteState} adminTier={adminTier} {...common} />
    </div>
  );
}
