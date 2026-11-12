import Link from "next/link";
import "./deck.css";
import {
  APPROVALS_NAME,
  DECK_ARRIVED_NOTE,
  DECK_DEAL_NEW,
  DECK_DEAL_NOW,
  DECK_PAGE_SUB,
  DECK_PAGE_TITLE,
  DECK_SIDE_TITLE,
  DECK_TITLE,
  DECK_VIEW_BOARD,
  DECK_VIEW_CARDS,
  DECK_VIEW_LIST,
  deckArrivedBody,
  deckArrivedCount,
  deckArrivedTitle,
  deckLaterArrivals,
} from "@/lib/ui/words";
import type { DeckView } from "@/lib/queue/deck";
import { DeckSide, type DeckSideLater, type DeckSideRow } from "./DeckSide";
import { DealTimesButton } from "./DealTimesButton";

export type { DeckSideRow } from "./DeckSide";

function DealIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}

/**
 * The deck's frame. Cards: a left column (page head, "All your approvals", arrivals) beside the well-coloured zone that holds
 * the deal. List and Board: a wide head and the page body. Shared later with the weekly review deck.
 */
export function DeckFrame({
  dealLine,
  view,
  viewHref,
  side,
  sideNote,
  sideFailed,
  sideLater,
  sideDecidedFailed,
  laterArrivals,
  nextDealLabel,
  dealLabel,
  dealNowHref,
  meta,
  wideSub,
  children,
}: {
  dealLine: string;
  view: DeckView;
  viewHref: (v: DeckView) => string;
  side: DeckSideRow[] | null;
  sideNote?: string | null;
  sideFailed?: boolean;
  /** The viewer's own Later cards for the side column. */
  sideLater?: DeckSideLater;
  sideDecidedFailed?: boolean;
  laterArrivals: number;
  nextDealLabel: string;
  /** The deal that is open now ("7:00 AM"), null before the first. */
  dealLabel?: string | null;
  dealNowHref: string;
  /** "6 left · about 8 min", "All decided", "Can't show". */
  meta?: string | null;
  /** The sentence under the wide head (List and Board). */
  wideSub?: string;
  children: React.ReactNode;
}) {
  const views: { v: DeckView; label: string }[] = [
    { v: "cards", label: DECK_VIEW_CARDS },
    { v: "list", label: DECK_VIEW_LIST },
    { v: "board", label: DECK_VIEW_BOARD },
  ];
  const switcher = (cls: string) => (
    <nav aria-label="Deck view" className={`dk-switch ${cls}`.trim()}>
      {views.map(({ v, label }) => (
        <Link key={v} href={viewHref(v)} aria-current={v === view ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );

  if (view !== "cards") {
    return (
      <div className="dk-frame dk-frame--wide">
        <div className="dk-wide-head">
          <div className="dk-titlerow">
            <h1 className="dk-h1 dk-h1--wide">{APPROVALS_NAME}</h1>
            {switcher("")}
          </div>
          {wideSub && <p className="dk-sub">{wideSub}</p>}
          <DealTimesButton />
        </div>
        {children}
      </div>
    );
  }

  const dealBtn = (
    <Link href={dealNowHref} className="dk-deal-btn">
      <DealIcon />
      {laterArrivals > 0 ? DECK_DEAL_NOW : DECK_DEAL_NEW}
    </Link>
  );
  return (
    <div className="dk-frame dk-frame--cards">
      <div className="dk-left">
        <div className="dk-pagehead">
          <span className="dk-eyebrow">{APPROVALS_NAME}</span>
          <div className="dk-head-row">
            <h1 className="dk-h1">{DECK_PAGE_TITLE}</h1>
            {switcher("")}
          </div>
          <p className="dk-sub">{DECK_PAGE_SUB}</p>
          <DealTimesButton />
        </div>
        <DeckSide rows={side ?? []} failed={sideFailed} note={sideNote} later={sideLater} decidedFailed={sideDecidedFailed} />
        {laterArrivals > 0 && dealLabel && (
          <section className="dk-arrived" aria-label={deckArrivedTitle(dealLabel)}>
            <div className="dk-sidecard-head">
              <h2>{deckArrivedTitle(dealLabel)}</h2>
              <span className="dk-sub-mono">{deckArrivedCount(laterArrivals, nextDealLabel)}</span>
            </div>
            <p className="dk-side-note">{deckArrivedBody(nextDealLabel)}</p>
          </section>
        )}
      </div>
      <section className="dk-zone" aria-label={DECK_SIDE_TITLE}>
        <div className="dk-zone-col">
          <div className="dk-phone-switch">
            {switcher("")}
            {dealBtn}
          </div>
          <div className="dk-zone-head">
            <div className="dk-zone-titles">
              <span className="dk-eyebrow">{dealLine}</span>
              <h2 className="dk-zone-title">{DECK_TITLE}</h2>
            </div>
            <div className="dk-zone-meta">
              {meta && <span className="dk-meta">{meta}</span>}
              {dealBtn}
            </div>
          </div>
          {laterArrivals > 0 && (
            <div className="dk-more3">
              <i aria-hidden="true" />
              <b>{deckLaterArrivals(laterArrivals, nextDealLabel)}</b>
              <span>{DECK_ARRIVED_NOTE}</span>
            </div>
          )}
          {children}
        </div>
      </section>
    </div>
  );
}
