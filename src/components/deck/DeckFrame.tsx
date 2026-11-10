import Link from "next/link";
import "./deck.css";
import { DECK_ALL_LIST_HEADING, DECK_DEAL_NOW, DECK_TITLE, DECK_VIEW_BOARD, DECK_VIEW_CARDS, DECK_VIEW_LIST, deckLaterArrivals } from "@/lib/ui/words";
import type { DeckView } from "@/lib/queue/deck";

export type DeckSideRow = { id: string; title: string; href: string; current: boolean; decided: boolean };

/**
 * The deck's frame: the deal line, "Needs you", the Cards | List | Board switch, the left column listing every one of
 * the person's approvals (current highlighted, decided ticked) and the footer with later arrivals. There is no "See all"
 * link: the left column IS all of them. Shared later with the weekly review deck.
 */
export function DeckFrame({
  dealLine,
  view,
  viewHref,
  side,
  sideNote,
  laterArrivals,
  nextDealLabel,
  dealNowHref,
  children,
}: {
  dealLine: string;
  view: DeckView;
  viewHref: (v: DeckView) => string;
  /** Null hides the left column (List and Board draw everything in the main area). */
  side: DeckSideRow[] | null;
  sideNote?: string | null;
  laterArrivals: number;
  nextDealLabel: string;
  dealNowHref: string;
  children: React.ReactNode;
}) {
  const views: { v: DeckView; label: string }[] = [
    { v: "cards", label: DECK_VIEW_CARDS },
    { v: "list", label: DECK_VIEW_LIST },
    { v: "board", label: DECK_VIEW_BOARD },
  ];
  return (
    <div className="dk-frame">
      <div className="dk-head">
        <div>
          <div className="lx-label">{dealLine}</div>
          <h1 className="lx-h1">{DECK_TITLE}</h1>
        </div>
        <nav aria-label="Deck view" className="lx-segs dk-switch">
          {views.map(({ v, label }) => (
            <Link key={v} href={viewHref(v)} aria-current={v === view ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div className={side && side.length > 0 ? "dk-body" : undefined}>
        {/* No rows, no box: the empty state beside it already says what is waiting and when. */}
        {side && side.length > 0 && (
          <nav className="lx-card dk-side" aria-label={DECK_ALL_LIST_HEADING}>
            <h2 className="lx-label">{DECK_ALL_LIST_HEADING}</h2>
            {sideNote && (
              <p className="lx-note" style={{ margin: 0 }}>
                {sideNote}
              </p>
            )}
            <ol>
              {side.map((r) => (
                <li key={r.id}>
                  {r.decided ? (
                    <span className="dk-side-row">
                      <span className="dk-tick" aria-label="Decided">
                        ✓
                      </span>
                      <span className="dk-done">{r.title}</span>
                    </span>
                  ) : (
                    <Link href={r.href} aria-current={r.current ? "true" : undefined}>
                      {r.title}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="dk-stage">{children}</div>
      </div>

      {laterArrivals > 0 && (
        <div className="dk-foot">
          <span className="lx-note">{deckLaterArrivals(laterArrivals, nextDealLabel)}</span>
          <Link href={dealNowHref} className="lx-btn lx-btn-sec lx-btn-sm">
            {DECK_DEAL_NOW}
          </Link>
        </div>
      )}
    </div>
  );
}
