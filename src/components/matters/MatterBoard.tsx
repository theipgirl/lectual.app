import Link from "next/link";
import "@/components/list-page/list-page.css";
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
}) {
  const board = buildBoard(props.stages, props.matters);
  const stageOptions = (props.moveStages ?? props.stages).map((s) => ({ id: s.id, label: s.label }));

  const card = (m: Matter) => {
    const age = stageAge(m);
    const owner = props.ownerName(m.assigned_to);
    return (
      <li key={m.id} id={matterCardId(m.id)} className="lp-board-card">
        <Link href={`/dashboard/matters/${m.id}/`} className="lx-rowlink">
          {matterLabel(m)}
        </Link>
        <span className="lx-note lx-num">{m.matter_number}</span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {age.days !== null && <span className={`lp-pill lp-pill-num${age.stale ? " lp-pill-risk" : ""}`}>{age.days}d</span>}
          {props.reviewIds.has(m.id) &&
            (props.reviewItems?.get(m.id) ? (
              <Link href={reviewHref(props.reviewItems.get(m.id)!)} className="lp-pill lp-pill-warn" style={{ position: "relative", zIndex: 1 }}>
                Review
              </Link>
            ) : (
              <span className="lp-pill lp-pill-warn">Review</span>
            ))}
          {owner && <span className="lx-note">{owner}</span>}
        </span>
        {props.canMove && stageOptions.length > 0 && <MoveMenu matterId={m.id} stageId={m.stage_id} stages={stageOptions} />}
      </li>
    );
  };

  const column = (key: string, title: string, sub: string | null, matters: Matter[], stale = 0) => (
    <section key={key} className="lx-board-col" aria-label={title}>
      <header>
        <span className="lx-board-title">{title}</span>
        <span className="lx-note">
          {matters.length}
          {stale ? ` · ${stale} gone quiet` : ""}
          {sub ? ` · ${sub}` : ""}
        </span>
      </header>
      {matters.length === 0 ? <p className="lx-note" style={{ margin: 0 }}>None</p> : <ul>{matters.map(card)}</ul>}
    </section>
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
  const openColumn = (c: (typeof board.open)[number]) => column(c.stage.id, stageDisplayName(c.stage.label), null, c.matters, c.stale);

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
