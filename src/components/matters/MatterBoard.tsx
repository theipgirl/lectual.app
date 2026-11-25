import Link from "next/link";
import { BoardCard, BoardColumn, Pill } from "@/components/ui";
import { NO_MAINTENANCE_DEADLINE_HINT, NO_OPEN_DEADLINE, NO_OPEN_DEADLINE_HINT, columnEmpty } from "@/lib/ui/words";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import { buildBoard } from "@/lib/matters/board";
import { matterLabel } from "@/lib/matters/docket-summary";
import { stageAge } from "@/lib/matters/worklist";
import { matterCardId, reviewHref, stageDisplayName } from "@/lib/matters/list-view";
import { MoveMenu } from "./MoveMenu";
import { MovedCardScroller } from "./MovedCardScroller";
import { BoardEmptyStages } from "./BoardEmptyStages";
import { emptyStagesLabel } from "@/lib/intake/board-columns";
import type { MatterCardData } from "@/lib/record-card/matter-cards";
import { MatterCardFoot, MatterCardMenu } from "@/components/record-card/MatterBits";
import { neighbours, stageMenuModel, type MenuStage } from "@/lib/stages/menu-model";
import { StageMenu } from "@/components/views/stages/StageMenu";

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

  // Move left / right go beside the VISIBLE neighbour: with empty stages folded away, a populated column's neighbours are the other
  // populated ones, and an empty column's are the other empty ones (drawn together when shown).
  const populatedOrder = board.open.filter((c) => !props.collapseEmpty || c.matters.length > 0).map((c) => c.stage.id);
  const emptyOrder = props.collapseEmpty ? board.open.filter((c) => c.matters.length === 0).map((c) => c.stage.id) : [];
  const menuFor = (stageId: string, shown: number) => {
    const admin = props.stageAdmin;
    const stage = admin?.all.find((s) => s.id === stageId);
    if (!admin || !stage) return undefined;
    const order = emptyOrder.includes(stageId) ? emptyOrder : populatedOrder;
    return <StageMenu model={stageMenuModel({ kind: "matter", stage, all: admin.all, ...neighbours(order, stageId), holdings: admin.holdings, shown })} />;
  };

  const column = (key: string, title: string, sub: string | null, matters: Matter[], stale = 0, stageId: string | null = null) => (
    <BoardColumn
      key={key}
      title={title}
      menu={stageId ? menuFor(stageId, matters.length) : undefined}
      count={`${matters.length}${stale ? ` · ${stale} gone quiet` : ""}${sub ? ` · ${sub}` : ""}`}
      empty={columnEmpty("matters")}
    >
      {matters.map(card)}
    </BoardColumn>
  );

  const unstaged = board.unstaged.length > 0 ? column("unstaged", "Not on the docket yet", null, board.unstaged) : null;
  const closed =
    board.closedCount > 0
      ? column(
          "closed",
          "Closed",
          board.closed.map((c) => c.stage.label).join(", "),
          board.closed.flatMap((c) => c.matters),
        )
      : null;
  const openColumn = (c: (typeof board.open)[number]) => column(c.stage.id, stageDisplayName(c.stage.label), null, c.matters, c.stale, c.stage.id);

  if (props.collapseEmpty) {
    const populated = board.open.filter((c) => c.matters.length > 0);
    const empty = board.open.filter((c) => c.matters.length === 0);
    const body = (
      <>
        <MovedCardScroller />
        {unstaged}
        {populated.map(openColumn)}
        {closed}
      </>
    );
    if (empty.length === 0) {
      return (
        <div className="lx-board" role="region" aria-label="Docket board">
          {body}
        </div>
      );
    }
    const names = empty.map((c) => stageDisplayName(c.stage.label));
    return (
      <BoardEmptyStages
        labelHidden={emptyStagesLabel(empty.length, false, names)}
        labelShown={emptyStagesLabel(empty.length, true, names)}
        empty={empty.map(openColumn)}
      >
        {body}
      </BoardEmptyStages>
    );
  }

  return (
    <div className="lx-board" role="region" aria-label="Docket board">
      <MovedCardScroller />
      {unstaged}
      {board.open.map(openColumn)}
      {closed}
    </div>
  );
}
