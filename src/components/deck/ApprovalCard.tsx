"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ReviewPanel } from "@/components/queue/ReviewPanel";
import type { AuditContext } from "@/lib/queue/hygiene";
import {
  approveCardAction,
  handOffCardAction,
  laterCardAction,
  markReadCardAction,
  rejectCardAction,
  returnCardAction,
  sendDraftNowAction,
  type DeckResult,
} from "@/app/dashboard/queue/deck/actions";
import { HoldToast } from "./HoldToast";
import { HandOffPicker, type HandOffPerson } from "./HandOffPicker";
import {
  DECK_BACK,
  DECK_CANCEL,
  DECK_CHOICE_DEFAULT,
  DECK_CHOICE_DRAFT_GMAIL,
  DECK_CHOICE_DRAFT_OUTLOOK,
  DECK_CHOICE_YOU_PRESS,
  DECK_CLOSER_LOOK,
  DECK_DRAFT_IN_GMAIL,
  DECK_DRAFT_NONE,
  DECK_DRAFT_IN_OUTLOOK,
  DECK_EDIT,
  DECK_FIRST_STEP,
  DECK_HAND_EYEBROW,
  DECK_REJECT_DRAFT,
  DECK_REJECT_EYEBROW,
  DECK_REJECT_HELP,
  DECK_REVIEW_HEAD,
  DECK_SUB_EDIT,
  DECK_SUB_HAND,
  DECK_SUB_LATER,
  DECK_SUB_OPEN,
  DECK_SUB_READ,
  DECK_SUB_REJECT,
  DECK_SUB_SEND_BACK,
  DECK_SUB_YES,
  deckApprovedLine,
  DECK_HANDED_NO_YES,
  DECK_HAND_OFF,
  DECK_LATER,
  DECK_LATER_DONE,
  DECK_MARK_READ,
  DECK_OPEN_DRAFT,
  DECK_OPEN_TO_REVIEW,
  DECK_REJECT,
  DECK_REJECT_NOTE_LABEL,
  DECK_REJECT_NOTE_NEEDED,
  DECK_SEND_BACK,
  DECK_SEND_NOW,
  DECK_SKIP,
  DECK_YES, DECK_EDITING_YES,
  deckPosition,
  handedBy,
} from "@/lib/ui/words";

export const HOLD_SECONDS = 5;

export type ApprovalCardProps = {
  id: string;
  source: string;
  tag: string;
  title: string;
  recipient: string | null;
  opening: string;
  firstStep: string | null;
  checkFirst: boolean;
  position: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
  /** Where to go once this card is decided: the next card, else the deck. */
  afterHref: string;
  internal: boolean;
  canYes: boolean;
  closerLook: boolean;
  handedByName: string | null;
  handNote: string | null;
  handedToMe: boolean;
  /** May this person hand off or put off this card (their yes, or handed to them). */
  canMove: boolean;
  /** Set when Hand off and Later can't be used yet; drawn disabled with this sentence. */
  movesUnavailable: string | null;
  people: HandOffPerson[];
  review: { initialBody: string; canApprove: boolean; canEdit: boolean; audit?: AuditContext };
  /** Where the card starts. Default is the plain card; the design harness and tests draw the other states with it. */
  initial?: { mode?: Mode; holding?: number; result?: DeckResult; note?: string };
};

export type Mode = "idle" | "rejecting" | "handing" | "editing";

function Clock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * One approval card. Yes waits 5 seconds with Undo before anything is posted; every other move posts at once and the
 * server re-checks it. Reject needs a typed note. Back / Skip are small arrows (and the left / right keys).
 */
export function ApprovalCard(props: ApprovalCardProps) {
  const [mode, setMode] = useState<Mode>(props.initial?.mode ?? "idle");
  const [holding, setHolding] = useState<number | null>(props.initial?.holding ?? null);
  const [result, setResult] = useState<DeckResult | null>(props.initial?.result ?? null);
  const [sendResult, setSendResult] = useState<DeckResult | null>(null);
  const [note, setNote] = useState(props.initial?.note ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reasonId = useId();
  const decided = !!result && result.ok;

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const run = (action: () => Promise<DeckResult>) =>
    startTransition(async () => {
      try {
        setResult(await action());
      } catch {
        setResult({ ok: false, error: "That didn't go through. Nothing was sent. Refresh to try again." });
      }
    });

  const startHold = () => {
    if (holding !== null || pending) return;
    let left = HOLD_SECONDS;
    setHolding(left);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setHolding(left);
        return;
      }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setHolding(null);
      run(() => approveCardAction(props.id));
    }, 1000);
  };
  const undo = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setHolding(null);
  };

  const busy = pending || holding !== null || decided;
  // While the editor is open, Yes would approve the SAVED text, not what is being typed: approve from the editor instead.
  const editing = mode === "editing";
  const draft = result && result.ok ? result.draft : null;
  const showYes = props.canYes && !props.closerLook && !props.internal;
  const showMarkRead = props.canYes && props.internal && !props.closerLook;
  const stageMode = decided ? "decided" : holding !== null ? "holding" : mode;
  const moveCount = (props.canYes ? 1 : 0) + (props.canMove ? 2 : 0) + (props.review.canEdit ? 1 : 0) + (props.handedToMe ? 1 : 0);
  const quiet = props.internal;

  return (
    <div className="dk-stage" data-mode={stageMode}>
      <div className="dk-mini">
        <small>{props.source}</small>
        <b>{props.title}</b>
      </div>
      <div className="dk-cardwrap">
        <div className="dk-cardwrap-in">
          <article className="dk-card" aria-labelledby={`dk-title-${props.id}`}>
            <div className="dk-card-top">
              <span className="dk-src">
                <i aria-hidden="true">L</i>
                <span>{props.source}</span>
              </span>
              <span className={quiet ? "dk-tag dk-tag--quiet" : "dk-tag"}>{props.tag}</span>
            </div>
            <h2 className="dk-title" id={`dk-title-${props.id}`}>
              {props.title}
            </h2>
            {props.handedToMe && props.handedByName && (
              <p className="dk-ctx">
                {handedBy(props.handedByName)}
                {props.handNote ? `: ${props.handNote}` : "."}
              </p>
            )}
            {(props.recipient || props.opening) && (
              <p className="dk-ctx">
                {props.recipient ? `To ${props.recipient}.` : ""}
                {props.recipient && props.opening ? " " : ""}
                {props.opening}
              </p>
            )}
            <div className="dk-card-foot">
              <span className="dk-why">
                {props.firstStep ? (props.checkFirst ? <strong>CHECK FIRST: </strong> : `${DECK_FIRST_STEP} `) : null}
                {props.firstStep?.replace(/^(first step|check first):\s*/i, "")}
              </span>
              <nav className="dk-pos" aria-label="Cards">
                {props.prevHref ? (
                  <Link className="dk-arrow" href={props.prevHref} data-deck-prev aria-label={DECK_BACK} title={DECK_BACK}>
                    ‹
                  </Link>
                ) : (
                  <span className="dk-arrow" aria-disabled="true" aria-hidden="true">
                    ‹
                  </span>
                )}
                <span aria-label={`Card ${props.position} of ${props.total}`}>{deckPosition(props.position, props.total)}</span>
                {props.nextHref ? (
                  <Link className="dk-arrow" href={props.nextHref} data-deck-next aria-label={DECK_SKIP} title={DECK_SKIP}>
                    ›
                  </Link>
                ) : (
                  <span className="dk-arrow" aria-disabled="true" aria-hidden="true">
                    ›
                  </span>
                )}
              </nav>
            </div>
          </article>
          <span className="dk-card-stack" aria-hidden="true" />
        </div>
      </div>

      {props.handedToMe && !props.canYes && !decided && (
        <p className="dk-handnote" role="note">
          {DECK_HANDED_NO_YES}
        </p>
      )}

      {props.closerLook && !decided && (
        <div className="dk-reason" role="note">
          <Clock />
          <span>
            <b>{DECK_REVIEW_HEAD}</b> {DECK_CLOSER_LOOK}
          </span>
        </div>
      )}

      {holding !== null && <HoldToast seconds={holding} onUndo={undo} />}

      {mode === "rejecting" && !decided && (
        <>
          <div className="dk-scrim" aria-hidden="true" />
          <form
            className="dk-sheet dk-sheet--reject"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) {
                setResult({ ok: false, error: DECK_REJECT_NOTE_NEEDED });
                return;
              }
              run(() => rejectCardAction(props.id, note));
            }}
          >
            <span className="dk-grab" aria-hidden="true" />
            <span className="dk-eyebrow">{DECK_REJECT_EYEBROW}</span>
            <div className="dk-field">
              <label htmlFor={`dk-reject-${props.id}`}>{DECK_REJECT_NOTE_LABEL}</label>
              <textarea id={`dk-reject-${props.id}`} rows={3} maxLength={500} required value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="dk-hint dk-hint--left">{DECK_REJECT_HELP}</p>
            <div className="dk-sheet-actions">
              <button type="button" className="dk-move" onClick={() => setMode("idle")}>
                {DECK_CANCEL}
              </button>
              <button type="submit" className="dk-move dk-move--primary" disabled={pending}>
                {DECK_REJECT_DRAFT}
              </button>
            </div>
          </form>
        </>
      )}

      {mode === "handing" && !decided && (
        <HandOffPicker people={props.people} disabledReason={props.movesUnavailable} pending={pending} onCancel={() => setMode("idle")} onHandOff={(userId, n) => run(() => handOffCardAction(props.id, userId, n))} />
      )}

      {mode === "editing" && !decided && (
        <div className="dk-panel">
          <ReviewPanel id={props.id} initialBody={props.review.initialBody} canApprove={props.review.canApprove} canEdit={props.review.canEdit} audit={props.review.audit} />
        </div>
      )}

      {result && !result.ok && (
        <p role="alert" className="lx-banner lx-banner-risk dk-error">
          {result.error}
        </p>
      )}

      {result && result.ok && !draft && result.message === DECK_LATER_DONE && (
        // Later: one dark pill with the way on (the board's toast; there is no undo for Later).
        <div className="dk-later-done" role="status">
          <span>{result.message}</span>
          <a href={props.afterHref}>{DECK_SKIP}</a>
        </div>
      )}

      {result && result.ok && !(!draft && result.message === DECK_LATER_DONE) && (
        <div className="dk-after" role="status">
          {draft ? <span className="dk-after-line">{deckApprovedLine(props.title)}</span> : null}
          {draft && !draft.provider ? (
            <p className="dk-after-msg">{DECK_DRAFT_NONE}</p>
          ) : draft ? (
            <>
              <div className="dk-choices" role="group" aria-label="What happens to the email">
                <button type="button" className="dk-choice" aria-pressed={!(sendResult && sendResult.ok)} disabled>
                  {draft.provider === "google" ? DECK_CHOICE_DRAFT_GMAIL : DECK_CHOICE_DRAFT_OUTLOOK}
                  <small>{DECK_CHOICE_DEFAULT}</small>
                </button>
                {draft.canSend && draft.draftId ? (
                  <button
                    type="button"
                    className="dk-choice"
                    aria-pressed={!!(sendResult && sendResult.ok)}
                    disabled={pending || !!(sendResult && sendResult.ok)}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          setSendResult(await sendDraftNowAction(props.id, draft.draftId));
                        } catch {
                          setSendResult({ ok: false, error: "Couldn't send from here, so nothing was sent. Open the draft in Outlook and press Send there." });
                        }
                      })
                    }
                  >
                    {DECK_SEND_NOW}
                    <small>{DECK_CHOICE_YOU_PRESS}</small>
                  </button>
                ) : null}
              </div>
              <p className="dk-after-msg">{draft.provider === "google" ? DECK_DRAFT_IN_GMAIL : DECK_DRAFT_IN_OUTLOOK}</p>
              {draft.webLink && (
                <a className="dk-after-link" href={draft.webLink} target="_blank" rel="noopener noreferrer">
                  {DECK_OPEN_DRAFT}
                </a>
              )}
              {!draft.canSend && draft.sendNote && <p className="dk-after-note">{draft.sendNote}</p>}
              {sendResult && (
                <p role={sendResult.ok ? "status" : "alert"} className={sendResult.ok ? "dk-after-msg" : "lx-banner lx-banner-risk"}>
                  {sendResult.ok ? sendResult.message : sendResult.error}
                </p>
              )}
            </>
          ) : (
            <p className="dk-after-msg">{result.message}</p>
          )}
          <div className="dk-after-actions">
            <a className="dk-after-next" href={props.afterHref}>
              {DECK_SKIP}
            </a>
          </div>
        </div>
      )}

      {!decided && mode !== "rejecting" && (
        <div className="dk-moves">
          <div className={`dk-moves5 dk-moves5--${moveCount >= 5 ? 5 : moveCount === 3 ? 3 : moveCount <= 2 ? 2 : 4}`} role="group" aria-label="Decide this card">
            {props.canYes && (
              <button type="button" className="dk-move dk-move--reject" disabled={busy} onClick={() => setMode("rejecting")}>
                {DECK_REJECT}
                <small>{DECK_SUB_REJECT}</small>
              </button>
            )}
            {props.canMove && (
              <button
                type="button"
                className="dk-move"
                disabled={busy || !!props.movesUnavailable}
                aria-describedby={props.movesUnavailable ? reasonId : undefined}
                onClick={() => run(() => laterCardAction(props.id))}
              >
                {DECK_LATER}
                <small>{DECK_SUB_LATER}</small>
              </button>
            )}
            {props.review.canEdit && (
              <button type="button" className="dk-move" disabled={busy} onClick={() => setMode(mode === "editing" ? "idle" : "editing")} aria-expanded={mode === "editing"}>
                {DECK_EDIT}
                <small>{DECK_SUB_EDIT}</small>
              </button>
            )}
            {props.canMove && (
              <button
                type="button"
                className="dk-move"
                disabled={busy || !!props.movesUnavailable}
                aria-describedby={props.movesUnavailable ? reasonId : undefined}
                onClick={() => setMode(mode === "handing" ? "idle" : "handing")}
                aria-expanded={mode === "handing"}
                title={DECK_HAND_EYEBROW}
              >
                {DECK_HAND_OFF}
                <small>{DECK_SUB_HAND}</small>
              </button>
            )}
            {props.handedToMe && (
              <button type="button" className="dk-move" disabled={busy} onClick={() => run(() => returnCardAction(props.id, ""))}>
                {DECK_SEND_BACK}
                <small>{DECK_SUB_SEND_BACK}</small>
              </button>
            )}
          </div>
          {props.closerLook && props.canYes ? (
            <a className="dk-move dk-move--yes dk-move--open" href={`/dashboard/queue/${encodeURIComponent(props.id)}/`}>
              {DECK_OPEN_TO_REVIEW}
              <small>{DECK_SUB_OPEN}</small>
            </a>
          ) : showMarkRead ? (
            <button type="button" className="dk-move dk-move--yes" disabled={busy || editing} title={editing ? DECK_EDITING_YES : undefined} onClick={() => run(() => markReadCardAction(props.id))}>
              {DECK_MARK_READ}
              <small>{DECK_SUB_READ}</small>
            </button>
          ) : showYes ? (
            <button type="button" className="dk-move dk-move--yes" disabled={busy || editing} title={editing ? DECK_EDITING_YES : undefined} onClick={startHold}>
              {DECK_YES}
              <small>{DECK_SUB_YES}</small>
            </button>
          ) : null}
        </div>
      )}
      {props.movesUnavailable && props.canMove && !decided && (
        <p id={reasonId} className="dk-moves-note">
          {props.movesUnavailable}
        </p>
      )}
    </div>
  );
}
