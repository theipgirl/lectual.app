"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import "@/components/deck/deck.css";
import "./lead-step.css";
import Link from "next/link";
import { HoldToast } from "@/components/deck/HoldToast";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";
import type { NeedsYesView } from "@/lib/lead-step/view-model";
import { leadStepEditAction, leadStepNotThisAction, leadStepSendBackAction, leadStepYesAction } from "@/lib/lead-step/actions";
import { holdSeconds, nextHold } from "./lead-step-hold";
import { useStepSay } from "./TopCardFrame";
import {
  CANCEL,
  LEAD_PAGE_ACTION_FAILED,
  LEAD_PAGE_APPROVALS_LINK,
  LEAD_PAGE_CHECK_FIRST,
  LEAD_PAGE_DONE_EDITING_YES,
  LEAD_PAGE_DRAFT_LABEL,
  LEAD_PAGE_EDIT_SAVE,
  LEAD_PAGE_OPEN_IN_APPROVALS,
  LEAD_PAGE_SEND_BACK_GO,
  LEAD_PAGE_SEND_BACK_NOTE,
  LEAD_PAGE_SHOW_WHOLE_DRAFT,
  LEAD_PAGE_WHY,
  LEAD_STEP_DROP,
  LEAD_STEP_EDIT,
  LEAD_STEP_NOT_THIS,
  LEAD_STEP_OPEN_PROPOSAL,
  LEAD_STEP_REASON_LABEL,
  LEAD_STEP_REASON_NEEDED,
  LEAD_STEP_SEND_BACK,
  LEAD_STEP_SUBJECT,
  LEAD_STEP_TO,
  LEAD_STEP_YES,
  DECK_OPEN_DRAFT,
  SAVING,
} from "@/lib/ui/words";

type Mode = "idle" | "editing" | "rejecting" | "sending-back";
type Outcome = { ok: true; message: string; webLink?: string | null } | { ok: false; error: string };

/** The first lines of a draft are shown; the rest sit behind "Show the whole draft". Paragraphs are plain React text. */
const SHOWN_PARAGRAPHS = 5;
const paragraphs = (body: string): string[] => body.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
const httpsOnly = (href: string | null | undefined): string | null => (href && /^https:\/\//i.test(href) ? href : null);

/**
 * The top card when something needs a yes: the prepared item inline, with Yes / Edit / Not this. Every button is
 * drawn from `view.actions` (the engine decided it); the server actions re-check everything. Yes is a client hold with
 * Undo, and only the end of the hold posts. The sentence after Yes is whatever the action returned.
 */
export function NeedsYourYes({ leadId, view, initial }: { leadId: string; view: NeedsYesView; initial?: { mode?: Mode; holding?: number; outcome?: Outcome; body?: string; reason?: string } }) {
  const say = useStepSay();
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "idle");
  const [holding, setHolding] = useState<number | null>(initial?.holding ?? null);
  const [outcome, setOutcome] = useState<Outcome | null>(initial?.outcome ?? null);
  const [body, setBody] = useState(initial?.body ?? view.email?.body ?? "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reasonId = useId();
  const bodyId = useId();
  const noteId = useId();
  const seconds = holdSeconds(view.holdMs);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const settle = (r: Outcome) => {
    setOutcome(r);
    if (!r.ok) return;
    setMode("idle");
    if (say) say({ tone: "ok", message: r.message, href: httpsOnly(r.webLink), hrefLabel: DECK_OPEN_DRAFT });
  };
  const run = (action: () => Promise<Outcome>) =>
    startTransition(async () => {
      try {
        settle(await action());
      } catch {
        settle({ ok: false, error: LEAD_PAGE_ACTION_FAILED });
      }
    });

  // The hold. Only the tick that ends it posts; Undo posts nothing at all.
  const startHold = () => {
    if (holding !== null || pending) return;
    setHolding(nextHold({ holding: null }, "start", seconds).state.holding);
    let state = { holding: seconds as number | null };
    timer.current = setInterval(() => {
      const step = nextHold(state, "tick", seconds);
      state = step.state;
      setHolding(state.holding);
      if (!step.fire) return;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      run(() => leadStepYesAction(leadId, view.itemId));
    }, 1000);
  };
  const undo = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setHolding(nextHold({ holding: 1 }, "undo", seconds).state.holding);
  };

  const done = outcome?.ok === true;
  const busy = pending || holding !== null || done;
  const editing = mode === "editing";
  const shown = view.email ? paragraphs(view.email.body) : [];
  const first = shown.slice(0, SHOWN_PARAGRAPHS);
  const rest = shown.slice(SHOWN_PARAGRAPHS);
  const readOnly = !view.actions.yes && !view.actions.edit && !view.actions.notThis;

  return (
    <section className="lx-card ls-card" aria-label="Next step" data-step="needs-yes" data-read-only={readOnly ? "true" : undefined}>
      <div className="ls-eyebrow">
        <Pill tone={view.actions.yes ? "ox" : MEANING_TONE.needsPerson}>{view.eyebrow}</Pill>
        <Pill>{view.kindLabel}</Pill>
      </div>
      <h2 className="ls-h">{view.headline}</h2>

      {view.handoff && (
        <p className="ls-line">
          <b>{view.handoff.text}</b>
          {view.handoff.note ? `: ${view.handoff.note}` : "."}
        </p>
      )}

      {view.email && !editing && (
        <div className="ls-inset" data-draft="view">
          <span className="lx-label">{LEAD_PAGE_DRAFT_LABEL}</span>
          {(view.email.to || view.email.subject) && (
            <dl className="ls-kv2">
              {view.email.to && (
                <>
                  <dt className="lx-label">{LEAD_STEP_TO}</dt>
                  <dd>{view.email.to}</dd>
                </>
              )}
              {view.email.subject && (
                <>
                  <dt className="lx-label">{LEAD_STEP_SUBJECT}</dt>
                  <dd>{view.email.subject}</dd>
                </>
              )}
            </dl>
          )}
          <div className="ls-body">
            {first.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {rest.length > 0 && (
              <details className="ls-more">
                <summary>{LEAD_PAGE_SHOW_WHOLE_DRAFT}</summary>
                {rest.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </details>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="ls-inset" data-draft="edit">
          <label className="lx-label" htmlFor={bodyId}>
            {LEAD_PAGE_DRAFT_LABEL}
          </label>
          <textarea id={bodyId} className="lx-input ls-draft" rows={Math.min(20, Math.max(8, body.split("\n").length + 2))} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="ls-act">
            <button type="button" className="lx-btn lx-btn-sec" disabled={pending} onClick={() => run(() => leadStepEditAction(leadId, view.itemId, body))}>
              {pending ? SAVING : LEAD_PAGE_EDIT_SAVE}
            </button>
            <button
              type="button"
              className="lx-btn lx-btn-ghost"
              disabled={pending}
              onClick={() => {
                setBody(view.email?.body ?? "");
                setMode("idle");
              }}
            >
              {CANCEL}
            </button>
          </div>
        </div>
      )}

      {view.proposal && (
        <div className="ls-inset" data-proposal="true">
          <dl className="ls-kv">
            {view.proposal.rows.map((r) => (
              <div key={r.label} className="ls-kv-row">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
          <a className="lx-link" href={view.proposal.href}>
            {LEAD_STEP_OPEN_PROPOSAL}
          </a>
        </div>
      )}

      {view.why.length > 0 && (
        <ul className="ls-why" aria-label={LEAD_PAGE_WHY}>
          {view.why.map((w, i) => (
            <li key={i}>
              {w.checkFirst ? <b>{LEAD_PAGE_CHECK_FIRST} </b> : null}
              {w.text.replace(/^(check first|first step):\s*/i, "")}
            </li>
          ))}
        </ul>
      )}

      {holding !== null && <HoldToast seconds={holding} onUndo={undo} />}

      {mode === "rejecting" && !done && (
        <form
          className="ls-reason"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setOutcome({ ok: false, error: LEAD_STEP_REASON_NEEDED });
              return;
            }
            run(() => leadStepNotThisAction(leadId, view.itemId, reason));
          }}
        >
          <label className="lx-label" htmlFor={reasonId}>
            {LEAD_STEP_REASON_LABEL}
          </label>
          <input id={reasonId} className="lx-input" maxLength={200} required value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="ls-act">
            <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
              {pending ? SAVING : LEAD_STEP_DROP}
            </button>
            <button type="button" className="lx-btn lx-btn-ghost" disabled={pending} onClick={() => setMode("idle")}>
              {CANCEL}
            </button>
          </div>
        </form>
      )}

      {mode === "sending-back" && !done && (
        <form
          className="ls-reason"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => leadStepSendBackAction(leadId, view.itemId, note));
          }}
        >
          <label className="lx-label" htmlFor={noteId}>
            {LEAD_PAGE_SEND_BACK_NOTE}
          </label>
          <input id={noteId} className="lx-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="ls-act">
            <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
              {pending ? SAVING : LEAD_PAGE_SEND_BACK_GO}
            </button>
            <button type="button" className="lx-btn lx-btn-ghost" disabled={pending} onClick={() => setMode("idle")}>
              {CANCEL}
            </button>
          </div>
        </form>
      )}

      {outcome && !outcome.ok && (
        <Notice tone="risk" role="alert">
          {outcome.error}
        </Notice>
      )}
      {outcome && outcome.ok && !say && (
        <Notice tone="ok" role="status">
          {outcome.message}
        </Notice>
      )}

      {!done && mode !== "rejecting" && mode !== "sending-back" && (view.actions.yes || view.actions.edit || view.actions.notThis || view.sendBack) && (
        <div className="ls-act" role="group" aria-label={view.headline}>
          {view.actions.yes && (
            <button type="button" className="lx-btn lx-btn-pri ls-yes" disabled={busy || editing} title={editing ? LEAD_PAGE_DONE_EDITING_YES : undefined} onClick={startHold}>
              {LEAD_STEP_YES}
            </button>
          )}
          {view.actions.edit && view.email && (
            <button type="button" className="lx-btn lx-btn-sec" disabled={busy} aria-expanded={editing} onClick={() => setMode(editing ? "idle" : "editing")}>
              {LEAD_STEP_EDIT}
            </button>
          )}
          {view.actions.notThis && (
            <button type="button" className="lx-btn lx-btn-ghost" disabled={busy || editing} onClick={() => setMode("rejecting")}>
              {LEAD_STEP_NOT_THIS}
            </button>
          )}
          {view.sendBack && (
            <button type="button" className="lx-btn lx-btn-sec" disabled={busy} onClick={() => setMode("sending-back")}>
              {LEAD_STEP_SEND_BACK}
            </button>
          )}
        </div>
      )}

      {view.actions.edit && !view.email && !done && (
        <p className="ls-line">
          <a className="lx-link" href={view.approvalHref}>
            {LEAD_PAGE_OPEN_IN_APPROVALS}
          </a>
        </p>
      )}

      {view.blocked && !done && (
        <Notice tone="warn">
          {view.blocked}{" "}
          <a className="lx-link" href={view.approvalHref}>
            {LEAD_PAGE_OPEN_IN_APPROVALS}
          </a>
        </Notice>
      )}

      {view.waitingOn && (
        <p className="ls-line">
          <Pill tone={MEANING_TONE.needsPerson}>{view.waitingOn}</Pill>
        </p>
      )}

      {view.others && (
        <p className="ls-line ls-lined">
          {view.others}.{" "}
          <Link className="lx-link" href="/dashboard/queue/">
            {LEAD_PAGE_APPROVALS_LINK}
          </Link>
        </p>
      )}
    </section>
  );
}
