import Link from "next/link";
import { BoardCard, Pill } from "@/components/ui";
import { NO_MAINTENANCE_DEADLINE_HINT, NO_OPEN_DEADLINE, NO_OPEN_DEADLINE_HINT, MATTERS_BOARD_HIDDEN_NOTE, MATTER_BOARD_CLOSED_COLUMN, MATTER_BOARD_UNSTAGED_COLUMN, columnEmpty } from "@/lib/ui/words";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import { buildBoard } from "@/lib/matters/board";
import { matterLabel } from "@/lib/matters/docket-summary";
import { stageAge } from "@/lib/matters/worklist";
import { matterCardId, reviewHref, stageDisplayName } from "@/lib/matters/list-view";
import { CLOSED_COLUMN_KEY, UNSTAGED_COLUMN_KEY, splitHiddenColumns, stageColumnKey } from "@/lib/matters/views";
import { MoveMenu } from "./MoveMenu";
import { MovedCardScroller } from "./MovedCardScroller";
import { BoardEmptyStages } from "./BoardEmptyStages";
import { emptyStagesLabel } from "@/lib/intake/board-columns";
import type { MatterCardData } from "@/lib/record-card/matter-cards";
import { MatterCardFoot, MatterCardMenu } from "@/components/record-card/MatterBits";
import { neighbours, stageMenuModel, type MenuStage } from "@/lib/stages/menu-model";
import { StageMenu } from "@/components/views/stages/StageMenu";
import { ViewBoard, type BoardColumnSpec } from "@/components/views/board/ViewBoard";
import { ColumnMenu } from "@/components/views/layout/ColumnMenu";
import { HiddenColumnsMenu } from "@/components/views/layout/HiddenColumnsMenu";
import type { Layout, ViewKey } from "@/lib/views/layout/types";

/**
 * The docket as a board: one column per live stage (terminal stages fold into
 * one "Closed" column, and matters with no stage get their own, so nothing is
 * dropped; see buildBoard). Moving a card is the same role-gated stage action
 * as the matter page's stage picker.
 */
export function MatterBoard(props: {
  stages: MatterStage[];
  /** Every stage a card can be moved to (a phase group's board draws only its own stages). Defaults to `stages`. */
  moveStages?: MatterStage[];
  /** A phase group's board: stages with no matter are named in one row ("N empty stages: A, B · Show") instead of drawn. */
  collapseEmpty?: boolean;
  matters: Matter[];
  canMove: boolean;
  reviewIds: ReadonlySet<string>;
  /** matter id -> the queue item to review; the Review pill links to it. */
  reviewItems?: ReadonlyMap<string, string>;
  ownerName: (id: string | null) => string | null;
  /** PGE Sprint 3: filed trademarks with no open deadline (a tag only). Absent or empty = none flagged. */
  noDeadlineIds?: ReadonlySet<string>;
  /** Of `noDeadlineIds`, the registered marks (no Section 8 / renewal deadline open): their tag's hover text says so. */
  registeredNoDeadlineIds?: ReadonlySet<string>;
  /** Sprint 10: what each role may do on each card, the open link and the lines. Absent: the plain board, as before. */
  cards?: Record<string, MatterCardData>;
  /**
   * The owner's stage menu on each open stage column (spec-editable-views.md 3b): every matter stage the firm has and what each holds
   * (null = couldn't be read). Absent for everyone but an owner membership row, and in a preview. "Closed" and "Not on the docket
   * yet" are not stages and get no menu.
   */
  stageAdmin?: { all: MenuStage[]; holdings: Record<string, string[]> | null; merged?: Record<string, number> | null } | null;
  /**
   * The firm's saved layout of this Board (`matters_board` / `contracts_board`). It decides ONE thing: which columns are hidden. The
   * order and the names of stage columns are the stages' own (the stage menu changes those), so no second ordering exists.
   */
  layout?: Layout | null;
  /** Given only for an owner whose saved layout was read: the column menu (Hide) on each column and the "Hidden columns" control. */
  layoutEdit?: { view: ViewKey; rev: number | null } | null;
}) {
  const board = buildBoard(props.stages, props.matters);
  const stageOptions = (props.moveStages ?? props.stages).map((s) => ({ id: s.id, label: s.label, phase: s.phase ?? null }));

  const card = (m: Matter) => {
    const age = stageAge(m);
    const owner = props.ownerName(m.assigned_to);
    const reviewId = props.reviewItems?.get(m.id);
    const needsReview = props.reviewIds.has(m.id);
    const noDeadline = props.noDeadlineIds?.has(m.id) ?? false;
    const rc = props.cards?.[m.id];
    return (
      <BoardCard
        key={m.id}
        id={matterCardId(m.id)}
        href={rc?.openHref ?? `/dashboard/matters/${m.id}/`}
        linkScroll={rc ? false : undefined}
        title={matterLabel(m)}
        tone={age.stale ? "risk" : needsReview ? "warn" : undefined}
        meta={owner && !rc ? `${m.matter_number} · ${owner}` : m.matter_number}
        chip={
          age.days !== null ? (
            <Pill num tone={age.stale ? "risk" : "mute"}>
              {age.days}d
            </Pill>
          ) : undefined
        }
        foot={
          needsReview || noDeadline ? (
            <>
              {needsReview &&
                (reviewId ? (
                  <Link href={reviewHref(reviewId)} className="lx-pill lx-pill-warn">
                    Review
                  </Link>
                ) : (
                  <Pill tone="warn">Review</Pill>
                ))}
              {needsReview && noDeadline && " "}
              {noDeadline && (
                <Pill tone="risk" title={props.registeredNoDeadlineIds?.has(m.id) ? NO_MAINTENANCE_DEADLINE_HINT : NO_OPEN_DEADLINE_HINT}>
                  {NO_OPEN_DEADLINE}
                </Pill>
              )}
            </>
          ) : undefined
        }
        step={rc ? <MatterCardFoot card={rc} /> : undefined}
        menu={
          rc ? (
            <MatterCardMenu card={rc} type={m.type} phases={stageOptions.map((o) => ({ id: o.id, phase: o.phase }))} announceGroup={!!props.collapseEmpty} />
          ) : props.canMove && stageOptions.length > 0 ? (
            <MoveMenu matterId={m.id} title={matterLabel(m)} stageId={m.stage_id} stages={stageOptions} type={m.type} announceGroup={!!props.collapseEmpty} />
          ) : undefined
        }
      />
    );
  };

  type Col = { key: string; title: string; sub: string | null; matters: Matter[]; stale: number; stageId: string | null };
  const unstaged: Col[] = board.unstaged.length > 0 ? [{ key: UNSTAGED_COLUMN_KEY, title: MATTER_BOARD_UNSTAGED_COLUMN, sub: null, matters: board.unstaged, stale: 0, stageId: null }] : [];
  const closed: Col[] =
    board.closedCount > 0
      ? [{ key: CLOSED_COLUMN_KEY, title: MATTER_BOARD_CLOSED_COLUMN, sub: board.closed.map((c) => c.stage.label).join(", "), matters: board.closed.flatMap((c) => c.matters), stale: 0, stageId: null }]
      : [];
  const opens: Col[] = board.open.map((c) => ({ key: stageColumnKey(c.stage.id), title: stageDisplayName(c.stage.label), sub: null, matters: c.matters, stale: c.stale, stageId: c.stage.id }));
  // The firm's layout hides columns; a hidden column's matters are counted in one line, never silently gone.
  const { shown: drawn, hidden } = splitHiddenColumns([...unstaged, ...opens, ...closed], props.layout);
  const hiddenMatters = hidden.reduce((n, c) => n + c.matters.length, 0);

  // Move left / right go beside the VISIBLE neighbour: with empty stages folded away, a populated column's neighbours are the other
  // populated ones, and an empty column's are the other empty ones (drawn together when shown).
  const stageCols = drawn.filter((c) => c.stageId !== null);
  const populatedOrder = stageCols.filter((c) => !props.collapseEmpty || c.matters.length > 0).map((c) => c.stageId as string);
  const emptyOrder = props.collapseEmpty ? stageCols.filter((c) => c.matters.length === 0).map((c) => c.stageId as string) : [];
  const stageMenuFor = (stageId: string, shown: number) => {
    const admin = props.stageAdmin;
    const stage = admin?.all.find((s) => s.id === stageId);
    if (!admin || !stage) return null;
    const order = emptyOrder.includes(stageId) ? emptyOrder : populatedOrder;
    return <StageMenu model={stageMenuModel({ kind: "matter", stage, all: admin.all, ...neighbours(order, stageId), holdings: admin.holdings, shown })} />;
  };

  const spec = (c: Col, emptyStage = false): BoardColumnSpec<Matter> => {
    const stageMenu = c.stageId ? stageMenuFor(c.stageId, c.matters.length) : null;
    const columnMenu = props.layoutEdit ? <ColumnMenu view={props.layoutEdit.view} rev={props.layoutEdit.rev} columnKey={c.key} label={c.title} kind="stage" /> : null;
    return {
      key: c.key,
      title: c.title,
      count: `${c.matters.length}${c.stale ? ` · ${c.stale} gone quiet` : ""}${c.sub ? ` · ${c.sub}` : ""}`,
      menu: stageMenu || columnMenu ? <>{columnMenu}{stageMenu}</> : undefined,
      ...(emptyStage ? { attrs: { "data-empty-stage": "true" } } : {}),
      groups: [{ key: "cards", empty: columnEmpty("matters"), cards: c.matters }],
    };
  };
  const board_ = (cols: readonly Col[], emptyKeys: ReadonlySet<string> = new Set()) => <ViewBoard columns={cols.map((c) => spec(c, emptyKeys.has(c.key)))} renderCard={card} role="region" aria-label="Docket board" />;

  const hiddenBar =
    hidden.length > 0 ? (
      <div className="lx-board-hidden">
        <p role="status" className="lx-note lx-state-line">
          {MATTERS_BOARD_HIDDEN_NOTE(hidden.length, hiddenMatters)}
        </p>
        {props.layoutEdit && <HiddenColumnsMenu groups={[{ view: props.layoutEdit.view, rev: props.layoutEdit.rev, items: hidden.map((c) => ({ key: c.key, label: c.title })) }]} />}
      </div>
    ) : null;

  if (props.collapseEmpty) {
    const populated = drawn.filter((c) => c.stageId === null || c.matters.length > 0);
    const empty = drawn.filter((c) => c.stageId !== null && c.matters.length === 0);
    if (empty.length === 0) {
      return (
        <>
          {hiddenBar}
          <MovedCardScroller />
          {board_(populated)}
        </>
      );
    }
    const names = empty.map((c) => c.title);
    return (
      <>
        {hiddenBar}
        <MovedCardScroller />
        <BoardEmptyStages
          labelHidden={emptyStagesLabel(empty.length, false, names)}
          labelShown={emptyStagesLabel(empty.length, true, names)}
          board={board_([...populated, ...empty], new Set(empty.map((c) => c.key)))}
        />
      </>
    );
  }

  return (
    <>
      {hiddenBar}
      <MovedCardScroller />
      {board_(drawn)}
    </>
  );
}
