import Link from "next/link";
import type { ReactNode } from "react";
import { Pill } from "@/components/ui";
import { ViewTable, type ListColumn } from "@/components/views/table/ViewTable";
import { ColumnMenu } from "@/components/views/layout/ColumnMenu";
import { SheetFactTd } from "@/components/review/SheetFactTd";
import { NotesCell } from "@/components/review/NotesCell";
import { NextStepLine, OwnerPick, StagePick } from "@/components/record-card/controls";
import { MatterCardMenu } from "@/components/record-card/MatterBits";
import type { MatterCardData } from "@/lib/record-card/matter-cards";
import type { FactCell } from "@/lib/review/sheet-cells";
import { noteCellFor, type SheetNotes } from "@/lib/review/sheet-notes";
import type { Matter } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import { stageAge } from "@/lib/matters/worklist";
import { noOpenDeadline, noOpenDeadlineHint } from "@/lib/matters/deadline-safety";
import type { OpenDeadlineIndex } from "@/lib/matters/deadline-safety";
import { reviewHref, stageDisplayName, statusNote } from "@/lib/matters/list-view";
import { MATTER_TYPE_LABEL } from "@/app/dashboard/matters/labels";
import type { MatterKind, MatterListColumn } from "@/lib/matters/views";
import type { ViewKey } from "@/lib/views/layout/types";
import { BLANK, NO_MAINTENANCE_DEADLINE_HINT, NO_OPEN_DEADLINE, NO_OPEN_DEADLINE_HINT, TEAMMATE, UNASSIGNED } from "@/lib/ui/words";

/**
 * One band of the Matters or Contracts List, drawn through the shared `ViewTable` with the firm's own layout (order, names, widths,
 * hidden columns, firm columns). Server component: the cells are the record card's own controls (stage, owner, next step; each checks
 * the role again on the server) and the Weekly review's Notes cell. Firm columns are read-only here: they are typed on the matter's card.
 * The last column is the card's menu; it is not part of the layout (every band keeps it).
 */
export type DrawnMatterColumn = MatterListColumn & { width: number | null };

const ACTIONS_KEY = "actions";
/** The table is fixed-layout: these are the widths (px) until a layout sets one. Together they stay near the width the old fixed percentages gave. */
const DEFAULT_WIDTHS: Record<string, number> = { matter: 230, type: 70, stage: 150, in_stage: 70, owner: 90, next_step: 220, notes: 180, [ACTIONS_KEY]: 50 };
const FIRM_COLUMN_WIDTH = 140;

export function MatterListTable({
  matters,
  columns,
  kind,
  layoutEdit,
  fieldMeta,
  cards,
  memberName,
  reviewIds,
  reviewItems,
  openDeadlineIds,
  firmCells,
  notes,
  canWrite,
  today,
}: {
  matters: readonly Matter[];
  columns: readonly DrawnMatterColumn[];
  kind: MatterKind;
  /** Given only for an owner whose saved layout was read: the menu on each header. */
  layoutEdit: { view: ViewKey; rev: number | null } | null;
  /** A firm column's kind and choices, by `cf:` key (for its header menu). */
  fieldMeta: Record<string, { kind: string; options: readonly string[] }>;
  cards: Record<string, MatterCardData>;
  memberName: ReadonlyMap<string, string>;
  reviewIds: ReadonlySet<string>;
  reviewItems: ReadonlyMap<string, string>;
  /** null = the open-deadline read failed (nothing is flagged, the page says so once). */
  openDeadlineIds: OpenDeadlineIndex | null;
  /** The firm columns' cells, by matter id then `cf:` key. */
  firmCells: Record<string, Record<string, FactCell>>;
  notes: SheetNotes | null;
  canWrite: boolean;
  today: string;
}) {
  const listColumns: ListColumn[] = [
    ...columns.map((c): ListColumn => ({ key: c.key, label: c.label, width: c.width, pinned: c.key === "matter", kind: c.kind, headClass: c.key === "in_stage" ? "num" : undefined })),
    { key: ACTIONS_KEY, label: "Actions" },
  ];

  const head = (c: ListColumn): ReactNode => {
    if (c.key === ACTIONS_KEY) return <span className="lx-sr">{c.label}</span>;
    if (!layoutEdit) return c.label;
    const at = columns.findIndex((x) => x.key === c.key);
    const prev = columns[at - 1];
    const meta = fieldMeta[c.key];
    return (
      <>
        {c.label}
        <ColumnMenu
          view={layoutEdit.view}
          rev={layoutEdit.rev}
          columnKey={c.key}
          label={c.label}
          pinned={c.pinned}
          allowAdd
          section={kind}
          prevKey={prev && prev.key !== "matter" ? prev.key : null}
          nextKey={columns[at + 1]?.key ?? null}
          firm={meta ? { kind: meta.kind, options: meta.options } : null}
        />
      </>
    );
  };

  const cell = (m: Matter, c: ListColumn): ReactNode => {
    const rc = cards[m.id];
    const label = c.label;
    switch (c.key) {
      case "matter": {
        const note = statusNote(m.status);
        const reviewId = reviewItems.get(m.id);
        return (
          <td className="pri">
            <Link href={rc.openHref} scroll={false} data-card-open="" className="lx-rowlink">
              {matterLabel(m)}
            </Link>
            <div className="lx-note mt-sub">
              {m.matter_number}
              {m.owner_name ? ` · ${m.owner_name}` : ""}
              {note ? ` · ${note}` : ""}
              {openDeadlineIds && noOpenDeadline(m, openDeadlineIds) && (
                <>
                  {" "}
                  <Pill tone="risk" title={noOpenDeadlineHint(m, { filed: NO_OPEN_DEADLINE_HINT, registered: NO_MAINTENANCE_DEADLINE_HINT })}>{NO_OPEN_DEADLINE}</Pill>
                </>
              )}
              {reviewIds.has(m.id) && (
                <>
                  {" "}
                  {reviewId ? (
                    <Link href={reviewHref(reviewId)} className="lx-pill lx-pill-warn">
                      Review
                    </Link>
                  ) : (
                    <Pill tone="warn">Review</Pill>
                  )}
                </>
              )}
            </div>
          </td>
        );
      }
      case "type":
        return <td data-label={label}>{MATTER_TYPE_LABEL[m.type]}</td>;
      case "stage":
        return <td data-label={label}>{rc.edits.stage ? <StagePick kind="matter" id={m.id} name={matterLabel(m)} stage={rc.stage} /> : m.stage ? <Pill wrap>{stageDisplayName(m.stage.label)}</Pill> : BLANK}</td>;
      case "in_stage": {
        const age = stageAge(m);
        return (
          <td className="num" data-label={label}>
            {age.days === null ? BLANK : age.stale ? <Pill num tone="risk">{age.days}d</Pill> : `${age.days}d`}
          </td>
        );
      }
      case "owner":
        return <td data-label={label}>{rc.edits.owner ? <OwnerPick kind="matter" id={m.id} name={matterLabel(m)} owner={rc.owner} /> : m.assigned_to ? memberName.get(m.assigned_to) ?? TEAMMATE : UNASSIGNED}</td>;
      case "next_step":
        return (
          <td data-label={label}>
            <NextStepLine kind="matter" id={m.id} line={rc.nextStep} dueIso={rc.dueIso} text={rc.bottom.nextStep} />
          </td>
        );
      case "notes":
        return (
          <td data-label={label} className="rv-notes-td">
            <NotesCell kind="matter" id={m.id} client={matterLabel(m)} cell={noteCellFor(notes, { kind: "matter", id: m.id })} canEdit={canWrite} today={today} />
          </td>
        );
      case ACTIONS_KEY:
        return (
          <td data-label="Actions">
            <MatterCardMenu card={rc} />
          </td>
        );
      default:
        // A firm column (`cf:<id>`): read-only here, typed on the matter's own card.
        return <SheetFactTd cell={firmCells[m.id]?.[c.key]} label={label} />;
    }
  };

  const byId = new Map(matters.map((m) => [m.id, m]));
  return (
    <ViewTable
      columns={listColumns}
      rows={matters.map((m) => ({ key: m.id }))}
      cell={(row, c) => cell(byId.get(row.key)!, c)}
      renderHead={head}
      fixed
      widthOf={(c) => c.width ?? DEFAULT_WIDTHS[c.key] ?? FIRM_COLUMN_WIDTH}
      minWidth={800}
      rowClass={() => "lp-row"}
      canEditCells={canWrite}
    />
  );
}
