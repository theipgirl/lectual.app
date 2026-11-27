import type { StepNotice } from "./TopCardFrame";
import { DECK_OPEN_DRAFT, LEAD_PAGE_OPEN_IN_APPROVALS } from "@/lib/ui/words";

/**
 * The state moves of the needs-yes card, as pure functions so they are tested without a browser. The rule that matters:
 * only Yes, Not this and Send back END the card (`outcome` set, buttons gone). A saved edit does not: its sentence goes
 * to the notice, the editor closes and Yes, Edit and Not this stay.
 */
export type Mode = "idle" | "editing" | "rejecting" | "sending-back";
export type Outcome = { ok: true; message: string; webLink?: string | null; warn?: boolean; text?: string } | { ok: false; error: string; connect?: string | null };
export type CardState = { mode: Mode; body: string; outcome: Outcome | null };
export type ActionKind = "edit" | "yes" | "not-this" | "send-back";

const httpsOnly = (href: string | null | undefined): string | null => (href && /^https:\/\//i.test(href) ? href : null);

/** The notice a success puts above the card. The approval link is built from the item's id captured BEFORE the card can swap. */
export function noticeFor(kind: ActionKind, r: Extract<Outcome, { ok: true }>, itemId: string): StepNotice {
  if (kind === "yes" && r.warn) return { tone: "warn", message: r.message, href: `/dashboard/queue/${encodeURIComponent(itemId)}/`, hrefLabel: LEAD_PAGE_OPEN_IN_APPROVALS, ...(r.text ? { text: r.text } : {}) };
  const web = kind === "yes" ? httpsOnly(r.webLink) : null;
  return { tone: "ok", message: r.message, href: web, hrefLabel: DECK_OPEN_DRAFT };
}

export function settle(state: CardState, kind: ActionKind, r: Outcome): CardState {
  if (!r.ok) return { ...state, outcome: r };
  if (kind === "edit") return { ...state, mode: "idle", outcome: null };
  return { ...state, mode: "idle", outcome: r };
}

/** The card is finished: only a terminal action sets it. */
export const isDone = (state: CardState): boolean => state.outcome?.ok === true;

/** Closing the editor by its own button discards what was typed and not saved (Cancel does the same). */
export function toggleEdit(state: CardState, savedBody: string): CardState {
  return state.mode === "editing" ? { ...state, mode: "idle", body: savedBody } : { ...state, mode: "editing" };
}
