"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "@/lib/copilot/launcher";
import { markTourSeenAction } from "@/lib/onboarding/actions";
import { closeTour, focusRestoreTarget, hasVisibleModal, readGuard, shouldOpenOnLoad, tourKeyAction } from "@/lib/onboarding/engine";
import type { TourOutcome } from "@/lib/onboarding/tour";
import { isLastCard, SHOW_WELCOME_EVENT, startWelcome, stepWelcome, welcomeCards, type WelcomeCard } from "@/lib/onboarding/welcome-deal";
import {
  DECK_FIRST_STEP,
  WELCOME_ARIA,
  WELCOME_BACK,
  WELCOME_FINISH,
  WELCOME_FORWARD,
  WELCOME_NEXT,
  WELCOME_SKIP,
  WELCOME_SOURCE,
  deckPosition,
} from "@/lib/ui/words";
import "@/components/deck/deck.css";
import "./welcome-deal.css";

type ViewProps = {
  cards: WelcomeCard[];
  index: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  popRef?: React.Ref<HTMLDivElement>;
  nextRef?: React.Ref<HTMLButtonElement>;
};

/** The dialog: one deck card, the position with its arrows, and the two moves. Presentational. */
export function WelcomeDealView({ cards, index, onNext, onBack, onSkip, popRef, nextRef }: ViewProps) {
  const titleId = useId();
  const card = cards[Math.min(Math.max(index, 0), cards.length - 1)];
  if (!card) return null;
  const last = isLastCard(index, cards.length);
  return (
    <div className="wd-root">
      <div className="wd-scrim" />
      <div ref={popRef} className="wd-dialog" role="dialog" aria-modal="true" aria-label={WELCOME_ARIA} aria-labelledby={titleId} tabIndex={-1}>
        <div className="dk-cardwrap">
          <div className="dk-cardwrap-in">
            <article className="dk-card">
              <div className="dk-card-top">
                <span className="dk-src">
                  <i aria-hidden="true">L</i>
                  <span>{WELCOME_SOURCE}</span>
                </span>
                <span className="dk-tag">{card.tag}</span>
              </div>
              <h2 className="dk-title" id={titleId}>
                {card.title}
              </h2>
              <p className="dk-ctx">{card.body}</p>
              <div className="dk-card-foot">
                <span className="dk-why">{`${DECK_FIRST_STEP} ${card.step}`}</span>
                <nav className="dk-pos wd-pos" aria-label="Steps">
                  <button type="button" className="dk-arrow" aria-label={WELCOME_BACK} title={WELCOME_BACK} disabled={index === 0} onClick={onBack}>
                    ‹
                  </button>
                  <span aria-label={`Card ${index + 1} of ${cards.length}`}>{deckPosition(index + 1, cards.length)}</span>
                  <button type="button" className="dk-arrow" aria-label={WELCOME_FORWARD} title={WELCOME_FORWARD} disabled={last} onClick={onNext}>
                    ›
                  </button>
                </nav>
              </div>
            </article>
            <span className="dk-card-stack" aria-hidden="true" />
          </div>
        </div>
        <div className="wd-moves">
          <button type="button" className="dk-move" onClick={onSkip}>
            {WELCOME_SKIP}
          </button>
          <button ref={nextRef} type="button" className="dk-move dk-move--yes" onClick={onNext}>
            {last ? WELCOME_FINISH : WELCOME_NEXT}
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  /** The server's answer: owner shell, a member, and the tour flag unseen. */
  open: boolean;
  /** The person's two deal times ("HH:MM", firm time); card 3 names them. */
  dealTimes: readonly string[];
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The owner view's welcome deal. Opens once on load when the server says so (same session guard and visible-modal check
 * as the tour), and again from the account menu's "Show tips again". Closing is optimistic, like the tour: it goes away
 * at once, the guard is set, then the existing `lectual_tour` flag is written; a failed save is swallowed.
 */
export function WelcomeDeal({ open, dealTimes }: Props) {
  const cards = useMemo(() => welcomeCards(dealTimes), [dealTimes]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const popRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const begin = useCallback(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setIndex(startWelcome().index);
    setActive(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (shouldOpenOnLoad({ open, guard: readGuard(sessionStore()), modalOpen: hasVisibleModal(document) })) begin();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, begin]);

  useEffect(() => {
    window.addEventListener(SHOW_WELCOME_EVENT, begin);
    return () => window.removeEventListener(SHOW_WELCOME_EVENT, begin);
  }, [begin]);

  const finish = useCallback((outcome: TourOutcome) => {
    void closeTour({
      outcome,
      action: markTourSeenAction,
      storage: sessionStore(),
      onClosed: () => {
        setActive(false);
        focusRestoreTarget(returnTo.current)?.focus();
        returnTo.current = null;
      },
    });
  }, []);

  const go = useCallback(
    (action: "next" | "back" | "skip") => {
      const result = stepWelcome({ index }, action, cards.length);
      if (result.outcome) finish(result.outcome);
      else setIndex(result.index);
    },
    [index, cards.length, finish],
  );

  useEffect(() => {
    if (active) (nextRef.current ?? popRef.current)?.focus();
  }, [active, index]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const items = popRef.current ? Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
      const action = tourKeyAction(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          inField: !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable),
        },
        { count: items.length, current: items.indexOf(document.activeElement as HTMLElement) },
      );
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.kind === "focus") items[action.index]?.focus();
      else go(action.kind);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, go]);

  if (!active) return null;
  return <WelcomeDealView cards={cards} index={index} popRef={popRef} nextRef={nextRef} onNext={() => go("next")} onBack={() => go("back")} onSkip={() => go("skip")} />;
}
