import Link from "next/link";
import { Children } from "react";
import type { PillTone } from "@/lib/ui/tones";

/**
 * One board column and one board card, in the Weekly review card's look: a bold name, one quiet line under it, the next step or key
 * fact, and a due or age chip. A tone edge says why the card is there. Server-safe, no hooks.
 *
 * No button on every card: a move is the page's drag, or a small "⋯" `menu` the page passes in. A decision that already sits on a card
 * (Done, Open) goes in `foot` as text.
 */
export function BoardColumn({
  title,
  titleHref,
  titleLinkProps,
  as = "section",
  count,
  note,
  foot,
  empty,
  ariaLabel,
  children,
  className,
  ...rest
}: {
  title: string;
  titleHref?: string;
  /** Extra attributes for the title link (a data hook a test or the page reads). */
  titleLinkProps?: Record<`data-${string}`, string>;
  /** "details" draws a collapsible column (the Closed column): the header sits in the summary, the rest folds. */
  as?: "section" | "details";
  count: React.ReactNode;
  note?: React.ReactNode;
  /** Under the cards (a "Showing N of M" line). */
  foot?: React.ReactNode;
  empty?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const colClass = ["lx-board-col", className].filter(Boolean).join(" ");
  const header = (
    <header>
      <span className="lx-board-title">
        {titleHref ? (
          <Link href={titleHref} {...titleLinkProps}>
            {title}
          </Link>
        ) : (
          title
        )}
      </span>
      <span className="lx-board-count">{count}</span>
    </header>
  );
  // An empty array (a page mapping zero cards) counts as no cards, so the empty sentence still shows.
  const body = Children.toArray(children).length > 0 ? <ul className="lx-board-cards">{children}</ul> : empty ? <p className="lx-board-empty">{empty}</p> : null;
  if (as === "details") {
    return (
      <details className={colClass} aria-label={ariaLabel ?? title} {...(rest as React.HTMLAttributes<HTMLDetailsElement>)}>
        <summary>{header}</summary>
        {note}
        {body}
        {foot}
      </details>
    );
  }
  return (
    <section className={colClass} aria-label={ariaLabel ?? title} {...rest}>
      {header}
      {note}
      {body}
      {foot}
    </section>
  );
}

export function BoardCard({
  href,
  title,
  meta,
  step,
  chip,
  menu,
  foot,
  tone,
  id,
  scroll,
  children,
  className,
  ...rest
}: {
  href: string;
  /** `false` keeps the page where it is when the link only adds `?open=` (the opened card). */
  scroll?: boolean;
  title: string;
  meta?: React.ReactNode;
  step?: React.ReactNode;
  chip?: React.ReactNode;
  menu?: React.ReactNode;
  foot?: React.ReactNode;
  tone?: PillTone;
  id?: string;
  children?: React.ReactNode;
} & Omit<React.LiHTMLAttributes<HTMLLIElement>, "title">) {
  // A card with a menu but no foot line puts the menu beside its chip (or its name) so no empty strip is left at the foot.
  const menuRow = Boolean(menu && !foot && chip);
  return (
    <li className={["lx-board-card", className].filter(Boolean).join(" ")} data-tone={tone} id={id} {...rest}>
      <div className="lx-board-card-top">
        <span className="lx-board-card-title">
          <Link href={href} className="lx-rowlink" scroll={scroll}>
            {title}
          </Link>
        </span>
        {chip && menuRow ? null : chip}
        {menu && !foot && !chip ? menu : null}
      </div>
      {meta ? <div className="lx-board-card-meta">{meta}</div> : null}
      {step ? <div className="lx-board-card-step">{step}</div> : null}
      {menuRow ? (
        <div className="lx-board-card-chiprow">
          {chip}
          {menu}
        </div>
      ) : null}
      {children}
      {foot ? (
        <div className="lx-board-card-foot">
          <span>{foot}</span>
          {menu}
        </div>
      ) : null}
    </li>
  );
}
