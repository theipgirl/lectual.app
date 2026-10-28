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

/**
 * The docket as a board: one column per live stage (terminal stages fold into
 * one "Closed" column, and matters with no stage get their own, so nothing is
 * dropped; see buildBoard). Moving a card is the same role-gated stage action
 * as the matter page's stage picker.
 */
export function MatterBoard(props: {
  stages: MatterStage[];
  matters: Matter[];
  canMove: boolean;
  reviewIds: ReadonlySet<string>;
  /** matter id -> the queue item to review; the Review pill links to it. */
  reviewItems?: ReadonlyMap<string, string>;
  ownerName: (id: string | null) => string | null;
}) {
  const board = buildBoard(props.stages, props.matters);
  const stageOptions = props.stages.map((s) => ({ id: s.id, label: s.label }));

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
          {age.days !== null && <span className={`lp-pill${age.stale ? " lp-pill-risk" : ""}`}>{age.days}d</span>}
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

  return (
    <div className="lx-board" role="region" aria-label="Docket board">
      <MovedCardScroller />
      {board.unstaged.length > 0 && column("unstaged", "Not on the docket yet", null, board.unstaged)}
      {board.open.map((c) => column(c.stage.id, stageDisplayName(c.stage.label), null, c.matters, c.stale))}
      {board.closedCount > 0 &&
        column(
          "closed",
          "Closed",
          board.closed.map((c) => c.stage.label).join(", "),
          board.closed.flatMap((c) => c.matters),
        )}
    </div>
  );
}
