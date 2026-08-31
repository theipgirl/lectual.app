/**
 * Card — the one surface every panel on this dashboard sits on.
 *
 * A card is a titled region, not a box: it renders as a `<section>` with an
 * accessible name, so the deadline hero, the month grid and the practice board
 * each show up as a landmark rather than as an anonymous div. Pass
 * `as="article"` for a repeated item (a matter card in a stage lane).
 *
 * Header anatomy — all optional, header is omitted entirely if none are set:
 *
 *   eyebrow   small mono uppercase kicker      "DEADLINES"
 *   title     the heading text                 "7 open · 2 overdue"
 *   meta      right-aligned slot for counts, badges, month arrows, filters
 *
 * `padded={false}` removes the body padding for content that must run edge to
 * edge — a calendar grid, a full-bleed list with its own row padding. The
 * header keeps its padding either way.
 *
 * The card owns no width and no margin. Grid placement belongs to the page.
 */

import type { ElementType, ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
  meta?: ReactNode;
  /** Footer strip below the body — legends, "view all" links. */
  footer?: ReactNode;
  /** Body padding. Set false for edge-to-edge content. Default true. */
  padded?: boolean;
  /** Element to render as. Default `section`. */
  as?: ElementType;
  /** Applied to the outer element (grid placement, min-heights). */
  className?: string;
  /** Heading level for `title`. Default 2. */
  headingLevel?: 2 | 3 | 4;
  id?: string;
};

export function Card({
  children,
  eyebrow,
  title,
  meta,
  footer,
  padded = true,
  as,
  className,
  headingLevel = 2,
  id,
}: CardProps) {
  const Root = (as ?? "section") as ElementType;
  const Heading = `h${headingLevel}` as ElementType;
  const hasHeader = Boolean(eyebrow || title || meta);
  const headingId = id && title ? `${id}-title` : undefined;

  return (
    <Root
      id={id}
      aria-labelledby={headingId}
      className={[
        "flex min-w-0 flex-col rounded-md border border-border bg-surface",
        "shadow-[var(--shadow)] print:shadow-none",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hasHeader ? (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow ? (
              <span className="font-mono text-[11px] font-semibold uppercase leading-4 tracking-[0.09em] text-muted">
                {eyebrow}
              </span>
            ) : null}
            {title ? (
              <Heading
                id={headingId}
                className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-ink"
              >
                {title}
              </Heading>
            ) : null}
          </div>
          {meta ? (
            <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
              {meta}
            </div>
          ) : null}
        </header>
      ) : null}

      <div className={padded ? "min-w-0 flex-1 p-4" : "min-w-0 flex-1"}>{children}</div>

      {footer ? (
        <footer className="border-t border-border px-4 py-2 text-xs text-muted">{footer}</footer>
      ) : null}
    </Root>
  );
}

export default Card;
