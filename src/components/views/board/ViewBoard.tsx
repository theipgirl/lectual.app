import type { ReactNode } from "react";
import { BoardColumn } from "@/components/ui/Board";

/**
 * The ONE Board: every Board in the app (the Weekly review's people lanes now; Matters' stage columns, Contracts and Leads next) draws its
 * columns through this, so they look alike. It owns the columns' markup (the Board kit's column, the one or two lists inside it, the empty
 * lines) and nothing else: what a column is (a person, a stage), which cards it holds and how a card looks are the caller's. Hook-free and
 * server-safe.
 *
 * A column holds one or more GROUPS of cards. One group with no heading is a plain stage column (a Matters board); two headed groups are
 * the review's "Our turn" and "Waiting on client". A column with no cards says so in each group's own sentence, never by drawing nothing.
 */
export type BoardGroupSpec<C> = {
  key: string;
  /** The list's heading ("Our turn · 4"). Absent on a plain column. */
  heading?: ReactNode;
  /** The sentence for a list with no cards. */
  empty: string;
  cards: readonly C[];
  /** A page's CSS or test hook on the list (the review's `data-half`). */
  attrs?: Record<`data-${string}`, string>;
};

export type BoardColumnSpec<C> = {
  /** The column's fixed key (what a layout names). Never changes with a rename. */
  key: string;
  /** The column's heading: its built-in name, or the firm's own label. */
  title: string;
  count: ReactNode;
  countTitle?: string;
  ariaLabel?: string;
  /** A quiet line under the heading (a person's load). */
  note?: ReactNode;
  className?: string;
  attrs?: Record<`data-${string}`, string>;
  /** A small control after the count (the owner's column menu). */
  menu?: ReactNode;
  groups: readonly BoardGroupSpec<C>[];
};

export function ViewBoard<C>({
  columns,
  renderCard,
  className,
  headingLevel,
  ...rest
}: {
  columns: readonly BoardColumnSpec<C>[];
  renderCard: (card: C, column: BoardColumnSpec<C>) => ReactNode;
  /** The page's own class beside the kit's (`rv-board`). */
  className?: string;
  /** A real heading for each column title (a person's lane is an h2). */
  headingLevel?: 2 | 3;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div {...rest} className={["lx-board", className].filter(Boolean).join(" ")}>
      {columns.map((col) => {
        const plain = col.groups.length === 1 && col.groups[0].heading === undefined;
        return (
          <BoardColumn
            key={col.key}
            className={col.className}
            {...col.attrs}
            title={col.title}
            headingLevel={headingLevel}
            count={col.count}
            countTitle={col.countTitle}
            ariaLabel={col.ariaLabel}
            note={col.note}
            menu={col.menu}
            bare={!plain}
            empty={plain ? col.groups[0].empty : undefined}
          >
            {plain
              ? col.groups[0].cards.map((card) => renderCard(card, col))
              : col.groups.map((g) => (
                  <section key={g.key} className="rv-lane-list" {...g.attrs}>
                    <h3 className="rv-lane-head lx-label">{g.heading}</h3>
                    {g.cards.length === 0 ? (
                      <p className="lx-board-empty">{g.empty}</p>
                    ) : (
                      <ul className="lx-board-cards">{g.cards.map((card) => renderCard(card, col))}</ul>
                    )}
                  </section>
                ))}
          </BoardColumn>
        );
      })}
    </div>
  );
}
