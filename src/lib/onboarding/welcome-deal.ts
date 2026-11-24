import { dealLabel, DEFAULT_DEAL_TIMES } from "@/lib/deal/times";
import {
  WELCOME_CARD_1_BODY,
  WELCOME_CARD_1_STEP,
  WELCOME_CARD_1_TITLE,
  WELCOME_CARD_2_BODY,
  WELCOME_CARD_2_STEP,
  WELCOME_CARD_2_TITLE,
  WELCOME_CARD_3_STEP,
  WELCOME_CARD_3_TITLE,
  WELCOME_CARD_4_BODY,
  WELCOME_CARD_4_STEP,
  WELCOME_CARD_4_TITLE,
  WELCOME_TAG,
  welcomeCard3Body,
} from "@/lib/ui/words";
import { stepTour, type StepAction } from "./engine";
import type { TourOutcome } from "./tour";

/**
 * The welcome deal: the owner view's first-sign-in guide, four cards in the deck's own look. In the owner view it
 * REPLACES the Sprint 21 tour (the technician view keeps the tour; the layout draws one or the other, never both).
 * It has its OWN flag, `user_metadata.lectual_welcome = { version, seen_at, outcome }`, written by
 * `markWelcomeSeenAction`; `lectual_tour` is never read or written here, so a person who finished the tour in the
 * technician view still sees the welcome deal the first time they are in the owner view. The flag decides what is DRAWN,
 * never what anyone may see or do. Pure.
 */
export const WELCOME_VERSION = 1;
export type WelcomeMeta = { version: number; seen_at: string; outcome: TourOutcome };

/** True when the stored welcome version is missing, malformed or older than `version`. Never throws. */
export function shouldShowWelcome(userMetadata: unknown, version: number = WELCOME_VERSION): boolean {
  if (typeof userMetadata !== "object" || userMetadata === null) return true;
  const stored = (userMetadata as Record<string, unknown>).lectual_welcome;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return true;
  const seen = (stored as Record<string, unknown>).version;
  if (typeof seen !== "number" || !Number.isFinite(seen)) return true;
  return seen < version;
}

export function buildWelcomeMeta(outcome: TourOutcome, now: Date, version: number = WELCOME_VERSION): WelcomeMeta {
  return { version, seen_at: now.toISOString(), outcome };
}

export const SHOW_WELCOME_EVENT = "lectual:show-welcome-deal";

export type WelcomeCard = {
  id: "cards" | "moves" | "deals" | "review";
  tag: string;
  title: string;
  /** The card's sentences. */
  body: string;
  /** What to try first, without the "First step:" label (the card draws it). */
  step: string;
};

/** The four cards. Card 3 names the person's own deal times, else the defaults. */
export function welcomeCards(dealTimes?: readonly string[] | null): WelcomeCard[] {
  const [a, b] = dealTimes && dealTimes.length === 2 ? dealTimes : DEFAULT_DEAL_TIMES;
  return [
    { id: "cards", tag: WELCOME_TAG, title: WELCOME_CARD_1_TITLE, body: WELCOME_CARD_1_BODY, step: WELCOME_CARD_1_STEP },
    { id: "moves", tag: WELCOME_TAG, title: WELCOME_CARD_2_TITLE, body: WELCOME_CARD_2_BODY, step: WELCOME_CARD_2_STEP },
    { id: "deals", tag: WELCOME_TAG, title: WELCOME_CARD_3_TITLE, body: welcomeCard3Body(dealLabel(a), dealLabel(b)), step: WELCOME_CARD_3_STEP },
    { id: "review", tag: WELCOME_TAG, title: WELCOME_CARD_4_TITLE, body: WELCOME_CARD_4_BODY, step: WELCOME_CARD_4_STEP },
  ];
}

/** Which first-sign-in guide the layout draws: the welcome deal for the owner shell, the tour for every other shell. */
export function guideFor(shellVariant: "owner" | undefined): "welcome" | "tour" {
  return shellVariant === "owner" ? "welcome" : "tour";
}

/** The server's "draw it on load" answer: owner shell, a member (never staff acting in a firm), and the tour flag unseen. */
export function shouldShowWelcomeDeal(input: { userMetadata: unknown; shellVariant: "owner" | undefined; actingAsStaff: boolean }): boolean {
  return guideFor(input.shellVariant) === "welcome" && !input.actingAsStaff && shouldShowWelcome(input.userMetadata);
}

export type WelcomeState = { index: number; outcome: TourOutcome | null };

/** A fresh run (first sign-in and "Show tips again" alike): card 1, nothing decided. */
export function startWelcome(): WelcomeState {
  return { index: 0, outcome: null };
}

/** next / back / skip. Next on the last card finishes (outcome `finished`); skip is `skipped`; back never leaves card 1. */
export function stepWelcome(state: { index: number }, action: StepAction, count: number): WelcomeState {
  const r = stepTour({ index: state.index, count }, action);
  return { index: r.index, outcome: r.outcome };
}

/** True on the last card, where the right-hand move reads Finish. */
export function isLastCard(index: number, count: number): boolean {
  return index >= count - 1;
}

type Dispatcher = { dispatchEvent: (event: Event) => boolean };
/** Asks the welcome deal to start again from card 1 (the owner account menu's "Show tips again"). */
export function requestWelcomeAgain(target: Dispatcher): void {
  target.dispatchEvent(new Event(SHOW_WELCOME_EVENT));
}
