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
  DECK_CLOSER_LOOK,
  DECK_DRAFT_IN_GMAIL,
  DECK_DRAFT_NONE,
  DECK_DRAFT_IN_OUTLOOK,
  DECK_EDIT,
  DECK_HANDED_NO_YES,
  DECK_HAND_OFF,
  DECK_LATER,
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
};

type Mode = "idle" | "rejecting" | "handing" | "editing";

/**
 * One approval card. Yes waits 5 seconds with Undo before anything is posted; every other move posts at once and the
 * server re-checks it. Reject needs a typed note. Back / Skip are small arrows (and the left / right keys).
 */
export function ApprovalCard(props: ApprovalCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [holding, setHolding] = useState<number | null>(null);
  const [result, setResult] = useState<DeckResult | null>(null);
  const [sendResult, setSendResult] = useState<DeckResult | null>(null);
  const [note, setNote] = useState("");
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

  return (
    <div className="dk-stage">
      <article className="dk-card" aria-labelledby={`dk-title-${props.id}`}>
        <div className="dk-card-top">
          <span>{props.source}</span>
          <span className="dk-tag">{props.tag}</span>
          <span aria-label={`Card ${props.position} of ${props.total}`}>{deckPosition(props.position, props.total)}</span>
        </div>
        {props.handedToMe && props.handedByName && (
          <p className="dk-step" style={{ margin: 0 }}>
            {handedBy(props.handedByName)}
            {props.handNote ? `: ${props.handNote}` : "."}
          </p>
        )}
        <h2 className="dk-title" id={`dk-title-${props.id}`}>
          {props.title}
        </h2>
        {props.recipient && <p className="dk-to">To {props.recipient}.</p>}
        {props.opening && <p className="dk-opening">{props.opening}</p>}
        {props.firstStep && (
          <p className="dk-step">
            {props.checkFirst ? <strong>CHECK FIRST: </strong> : null}
            {props.firstStep}
          </p>
        )}
        {props.closerLook && <p className="dk-step">{DECK_CLOSER_LOOK}</p>}
        {props.handedToMe && !props.canYes && <p className="dk-step">{DECK_HANDED_NO_YES}</p>}

        {!decided && (
          <div className="dk-moves" role="group" aria-label="Decide this card">
            {props.canYes && (
              <button type="button" className="lx-btn lx-btn-danger" disabled={busy} onClick={() => setMode(mode === "rejecting" ? "idle" : "rejecting")} aria-expanded={mode === "rejecting"}>
                {DECK_REJECT}
              </button>
            )}
            {props.canMove && (
              <button
                type="button"
                className="lx-btn lx-btn-sec"
                disabled={busy || !!props.movesUnavailable}
                aria-describedby={props.movesUnavailable ? reasonId : undefined}
                onClick={() => run(() => laterCardAction(props.id))}
              >
                {DECK_LATER}
              </button>
            )}
            {props.review.canEdit && (
              <button type="button" className="lx-btn lx-btn-sec" disabled={busy} onClick={() => setMode(mode === "editing" ? "idle" : "editing")} aria-expanded={mode === "editing"}>
                {DECK_EDIT}
              </button>
            )}
            {props.canMove && (
              <button
                type="button"
                className="lx-btn lx-btn-sec"
                disabled={busy || !!props.movesUnavailable}
                aria-describedby={props.movesUnavailable ? reasonId : undefined}
                onClick={() => setMode(mode === "handing" ? "idle" : "handing")}
                aria-expanded={mode === "handing"}
              >
                {DECK_HAND_OFF}
              </button>
            )}
            {props.handedToMe && (
              <button type="button" className="lx-btn lx-btn-sec" disabled={busy} onClick={() => run(() => returnCardAction(props.id, ""))}>
                {DECK_SEND_BACK}
              </button>
            )}
            {props.closerLook && props.canYes ? (
              <a className="lx-btn lx-btn-pri" href={`/dashboard/queue/${encodeURIComponent(props.id)}/`}>
                {DECK_OPEN_TO_REVIEW}
              </a>
            ) : showMarkRead ? (
              <button type="button" className="lx-btn lx-btn-pri" disabled={busy || editing} title={editing ? DECK_EDITING_YES : undefined} onClick={() => run(() => markReadCardAction(props.id))}>
                {DECK_MARK_READ}
              </button>
            ) : showYes ? (
              <button type="button" className="lx-btn lx-btn-pri" disabled={busy || editing} title={editing ? DECK_EDITING_YES : undefined} onClick={startHold}>
                {DECK_YES}
              </button>
            ) : null}
          </div>
        )}
        {props.movesUnavailable && props.canMove && !decided && (
          <p id={reasonId} className="dk-opening" style={{ fontSize: 13 }}>
            {props.movesUnavailable}
          </p>
        )}
      </article>

      {holding !== null && <HoldToast seconds={holding} onUndo={undo} />}

      {mode === "rejecting" && !decided && (
        <form
          className="dk-panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) {
              setResult({ ok: false, error: DECK_REJECT_NOTE_NEEDED });
              return;
            }
            run(() => rejectCardAction(props.id, note));
          }}
        >
          <label htmlFor={`dk-reject-${props.id}`} className="lx-label">
            {DECK_REJECT_NOTE_LABEL}
          </label>
          <textarea id={`dk-reject-${props.id}`} className="lx-input" rows={3} maxLength={500} required value={note} onChange={(e) => setNote(e.target.value)} />
          <div>
            <button type="submit" className="lx-btn lx-btn-danger" disabled={pending}>
              {DECK_REJECT}
            </button>
          </div>
        </form>
      )}

      {mode === "handing" && !decided && (
        <div className="dk-panel">
          <HandOffPicker people={props.people} disabledReason={props.movesUnavailable} pending={pending} onHandOff={(userId, n) => run(() => handOffCardAction(props.id, userId, n))} />
        </div>
      )}

      {mode === "editing" && !decided && (
        <div className="dk-panel">
          <ReviewPanel id={props.id} initialBody={props.review.initialBody} canApprove={props.review.canApprove} canEdit={props.review.canEdit} audit={props.review.audit} />
        </div>
      )}

      {result && !result.ok && (
        <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          {result.error}
        </p>
      )}

      {result && result.ok && (
        <div className="dk-panel" role="status">
          {draft && !draft.provider ? (
            <p style={{ margin: 0 }}>{DECK_DRAFT_NONE}</p>
          ) : draft ? (
            <>
              <p style={{ margin: 0 }}>{draft.provider === "google" ? DECK_DRAFT_IN_GMAIL : DECK_DRAFT_IN_OUTLOOK}</p>
              {draft.webLink && (
                <a href={draft.webLink} target="_blank" rel="noopener noreferrer">
                  {DECK_OPEN_DRAFT}
                </a>
              )}
              {draft.canSend && draft.draftId && !(sendResult && sendResult.ok) ? (
                <div>
                  <button
                    type="button"
                    className="lx-btn lx-btn-sec"
                    disabled={pending}
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
                  </button>
                </div>
              ) : null}
              {!draft.canSend && draft.sendNote && (
                <p className="lx-note" style={{ margin: 0 }}>
                  {draft.sendNote}
                </p>
              )}
              {sendResult && (
                <p role={sendResult.ok ? "status" : "alert"} className={sendResult.ok ? "lx-note" : "lx-banner lx-banner-risk"} style={{ margin: 0 }}>
                  {sendResult.ok ? sendResult.message : sendResult.error}
                </p>
              )}
            </>
          ) : (
            <p style={{ margin: 0 }}>{result.message}</p>
          )}
          <div>
            <a className="lx-btn lx-btn-pri" href={props.afterHref}>
              {DECK_SKIP}
            </a>
          </div>
        </div>
      )}

      <nav className="dk-arrows" aria-label="Cards">
        {props.prevHref ? (
          <Link className="dk-arrow" href={props.prevHref} data-deck-prev aria-label={DECK_BACK} title={DECK_BACK}>
            ←
          </Link>
        ) : (
          <span className="dk-arrow" aria-disabled="true" aria-hidden="true">
            ←
          </span>
        )}
        {props.nextHref ? (
          <Link className="dk-arrow" href={props.nextHref} data-deck-next aria-label={DECK_SKIP} title={DECK_SKIP}>
            →
          </Link>
        ) : (
          <span className="dk-arrow" aria-disabled="true" aria-hidden="true">
            →
          </span>
        )}
      </nav>
    </div>
  );
}
