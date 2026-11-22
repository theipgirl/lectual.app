import type { ReviewRow } from "@/lib/review/buckets";
import { lastContactText, shortDate } from "@/lib/review/format";
import { sheetSections, waitingCell } from "@/lib/review/sheet";
import { factCells, type FactCell, type FactCells } from "@/lib/review/sheet-cells";
import { customCells, type CustomColumnsState, type CustomMember } from "@/lib/custom-columns/rules";
import { MONEY_COLUMNS, NOTES_PRESENT, columnsFor } from "@/lib/review/sheet-columns";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import { documentsTag } from "@/lib/review/documents";
import { lastChangedText } from "@/lib/review/last-changed";
import { contactWords } from "@/lib/review/contact";
import { EDITABLE_COLUMNS, cellEditable, type SheetEditRow, type SheetPerms } from "@/lib/review/sheet-edit";
import { roleLabel } from "@/lib/auth/roles";
import { REFERRAL_SOURCES } from "@/lib/intake/referral-source";
import { SHEET_LEGEND_LABEL, SHEET_STAGES_UNREADABLE, SHEET_WORKED_OUT, SHEET_WORKED_OUT_BODY, SHEET_WORKED_OUT_FEES, SHEET_YOU_TYPE, SHEET_YOU_TYPE_BODY } from "@/lib/ui/words";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { SheetEditTable, type SheetEditInitial, type SheetPerson, type SheetSection } from "./SheetEditTable";
import { openHref, type Common } from "./shared";
import "./review-sheet-edit.css";

function toSheetRow(r: ReviewRow, href: string, today: string, names: ReadonlyMap<string, string>, canSeeMoney: boolean, custom?: Record<string, FactCell>): SheetEditRow {
  const facts = factCells(r, today);
  // A viewer who may not see fees never receives a fee cell, drawn or not.
  if (!canSeeMoney) for (const id of MONEY_COLUMNS) delete (facts as Partial<FactCells>)[id as keyof FactCells];
  return {
    key: r.key,
    kind: r.kind,
    id: r.id,
    client: r.client,
    mark: r.mark,
    openHref: href,
    stageId: r.stageId ?? null,
    stageLabel: r.stageLabel,
    nextStep: r.nextStep,
    assignedTo: r.assignedTo,
    source: r.source ?? null,
    waitingText: waitingCell(r, (d) => shortDate(d, today)),
    contactIsDate: r.contactKnown && !!r.lastContact,
    contactText: r.contactKnown && r.lastContact ? shortDate(r.lastContact.date, today) : lastContactText(r, today),
    documentsText: documentsTag(r.documentCount),
    changedText: lastChangedText(r.lastChange, names, today),
    facts,
    contactTitle: r.contactKnown && r.lastContact ? lastContactText(r, today) : r.lastContact ? contactWords(r.lastContact.type) : null,
    ...(custom ? { custom } : {}),
  };
}

/**
 * The owner view's Sheet, editable in place: Status, Next step, Owner and Source are typed; Waiting on and Last contact
 * are worked out and locked. Every edit goes through an existing review action, which re-resolves the role. A role that can't
 * write gets the same table with no editors. On a phone the rows stack and every edit happens in the record panel.
 */
export function SheetEdit({ rows, today, members, params, perms, initial, canSeeMoney = false, initialPrefs, custom = null, customMembers }: Common & {
  rows: ReviewRow[];
  perms: SheetPerms;
  initial?: SheetEditInitial;
  /** From the page's re-resolved role (`canSeeBilling`). Drops the fee columns when false. */ canSeeMoney?: boolean;
  /** Drawing-only starting column choices (a test or preview). */ initialPrefs?: PrefsDocument;
  /** The firm's custom columns as the page read them; read only here (no editor in this sprint). */ custom?: CustomColumnsState | null;
  /** The member directory for person cells; null when it couldn't be read. Defaults to `members`. */ customMembers?: CustomMember[] | null;
}) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const { trademarks, contracts } = sheetSections(rows);
  const fields = custom?.status === "ok" ? custom.fields : [];
  const cells = custom?.status === "ok" ? customCells(rows, fields, custom, customMembers === undefined ? members : customMembers, today) : null;
  const sheetRow = (r: ReviewRow) => toSheetRow(r, openHref(params, r), today, names, canSeeMoney, cells?.[r.key]);
  const sections: SheetSection[] = [
    { id: "trademarks", title: "Trademarks", rows: trademarks.map(sheetRow) },
    { id: "contracts", title: "Contracts", rows: contracts.map(sheetRow) },
  ];
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  const columns = { trademarks: columnsFor("trademarks", { canSeeMoney, hasNotes: NOTES_PRESENT, customFields: fields }), contracts: columnsFor("contracts", { canSeeMoney, hasNotes: NOTES_PRESENT, customFields: fields }) };
  const people: SheetPerson[] = members.map((m) => ({
    userId: m.userId,
    name: m.name,
    // The cell shows the first name when no one else in the firm shares it, else the whole name.
    short: members.filter((o) => first(o.name) === first(m.name)).length === 1 ? first(m.name) : m.name,
    roleLabel: roleLabel((m as { role?: string }).role ?? ""),
  }));
  const anyEditor = rows.some((r) => EDITABLE_COLUMNS.some((c) => cellEditable(c, r.kind, perms)));
  const stagesMissing = (perms.writeMatter && perms.matterStages === null && rows.some((r) => r.kind === "matter")) || (perms.moveLead && perms.leadStages === null && rows.some((r) => r.kind === "lead"));
  return (
    <div className="rse-root">
      {stagesMissing && (
        <Notice tone="warn" role="status">
          {SHEET_STAGES_UNREADABLE}
        </Notice>
      )}
      <SheetEditTable sections={sections} people={people} perms={perms} sources={[...REFERRAL_SOURCES]} today={today} initial={initial} columns={columns} initialPrefs={initialPrefs} customNotOn={custom?.status === "not-set-up"} />
      {anyEditor && (
        <section className="lx-card rse-legend" aria-label={SHEET_LEGEND_LABEL}>
          <div>
            <p className="rse-legend-title">
              {SHEET_YOU_TYPE} <Icon name="pencil" size={13} />
            </p>
            <p className="rse-legend-body">{SHEET_YOU_TYPE_BODY}</p>
          </div>
          <div>
            <p className="rse-legend-title">{SHEET_WORKED_OUT}</p>
            <p className="rse-legend-body">{SHEET_WORKED_OUT_BODY}{canSeeMoney ? ` ${SHEET_WORKED_OUT_FEES}` : ""}</p>
          </div>
        </section>
      )}
    </div>
  );
}
