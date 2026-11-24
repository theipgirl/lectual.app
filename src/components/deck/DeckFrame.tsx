import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
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
import { ViewToggle } from "@/components/ViewToggle";

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
  canChangeDealTimes = false,
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
  /** True only in the owner view, where the dialog is mounted. */
  canChangeDealTimes?: boolean;
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
    <ViewToggle<DeckView> label="Deck view" value={view} views={views.map(({ v, label }) => ({ value: v, label, href: viewHref(v) }))} hrefFor={viewHref} className={cls} />
  );

  if (view !== "cards") {
    return (
      <div className="dk-frame dk-frame--wide">
        <PageHeader
          className="dk-wide-head lx-head-split"
          title={APPROVALS_NAME}
          titleClassName="dk-h1"
          sub={wideSub || undefined}
          actions={
            <>
              {switcher("")}
              {canChangeDealTimes && <DealTimesButton />}
            </>
          }
        />
        {children}
      </div>
    );
  }

  const dealBtn = (
    <Link href={dealNowHref} className="lx-btn lx-btn-sec dk-deal-btn">
      <DealIcon />
      {laterArrivals > 0 ? DECK_DEAL_NOW : DECK_DEAL_NEW}
    </Link>
  );
  return (
    <div className="dk-frame dk-frame--cards">
      <div className="dk-left">
        <PageHeader
          className="dk-pagehead"
          title={DECK_PAGE_TITLE}
          titleClassName="dk-h1"
          sub={DECK_PAGE_SUB}
          actions={
            <>
              {switcher("")}
              {canChangeDealTimes && <DealTimesButton />}
            </>
          }
        />
        <DeckSide rows={side ?? []} failed={sideFailed} note={sideNote} later={sideLater} decidedFailed={sideDecidedFailed} />
        {laterArrivals > 0 && dealLabel && (
          <section className="lx-card dk-arrived" aria-label={deckArrivedTitle(dealLabel)}>
            <div className="dk-sidecard-head">
              <h2>{deckArrivedTitle(dealLabel)}</h2>
              <span className="dk-count">{deckArrivedCount(laterArrivals, nextDealLabel)}</span>
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
              <span className="lx-label">{dealLine}</span>
              <h2 className="lx-h2 dk-zone-title">{DECK_TITLE}</h2>
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
