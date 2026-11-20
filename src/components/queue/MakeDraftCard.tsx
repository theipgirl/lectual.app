"use client";

import "./handed.css";
import { useActionState } from "react";
import { clearClaimAction, makeDraftAction, type MakeDraftState } from "@/app/dashboard/queue/actions";
import { Notice } from "@/components/ui/Notice";
import { APPROVED_TEXT_LABEL, CLEAR_CLAIM_BUTTON, CONNECT_OUTLOOK_LINK, DRAFTED_IN_OUTLOOK, MAKE_DRAFT_BUTTON, MAKE_DRAFT_TITLE, SAVING } from "@/lib/ui/words";

export type MakeDraftView =
  | { kind: "ready" }
  | { kind: "drafted" }
  /** A claimed attempt with no outcome: check Drafts; the approved text as plain text to copy. No button. */
  | { kind: "check-drafts"; sentence: string; text: string }
  /** The button is drawn disabled with the sentence; `connect` adds the "Connect Outlook" link. */
  | { kind: "blocked"; sentence: string; connect: string | null };

/**
 * "Make the draft in my Outlook" on an approved email passed to this viewer (Sprint 4). The form posts the item id and
 * nothing else: the action re-reads who is calling, the item, the card events and the caller's OWN Outlook connection.
 */
export function MakeDraftCard({ id, intro, view }: { id: string; intro: string; view: MakeDraftView }) {
  const [state, action, pending] = useActionState<MakeDraftState, FormData>(makeDraftAction, {});
  const [cleared, clearAction, clearing] = useActionState<MakeDraftState, FormData>(clearClaimAction, {});
  const done = !!state.message;
  return (
    <section className="lx-card lx-handed" data-make-draft aria-label={MAKE_DRAFT_TITLE}>
      <p className="lx-handed-by">{intro}</p>
      {view.kind === "drafted" ? (
        <Notice tone="ok" role="status">
          {DRAFTED_IN_OUTLOOK}
        </Notice>
      ) : view.kind === "check-drafts" ? (
        <div data-make-draft-check>
          <Notice tone="warn" role="status">
            {view.sentence}
          </Notice>
          <p className="lx-label">{APPROVED_TEXT_LABEL}</p>
          <pre className="lx-handed-text" style={{ whiteSpace: "pre-wrap" }}>
            {view.text}
          </pre>
          <form action={clearAction} className="lx-sendback" data-clear-claim>
            <input type="hidden" name="id" value={id} />
            {cleared.error && (
              <Notice tone="risk" role="alert">
                {cleared.error}
              </Notice>
            )}
            {cleared.message && (
              <Notice tone="ok" role="status">
                {cleared.message}
              </Notice>
            )}
            <button type="submit" className="lx-btn lx-btn-sec" disabled={clearing || !!cleared.message}>
              {clearing ? SAVING : CLEAR_CLAIM_BUTTON}
            </button>
          </form>
        </div>
      ) : (
        <form action={action} className="lx-sendback">
          <input type="hidden" name="id" value={id} />
          {view.kind === "blocked" && (
            <p id={`md-why-${id}`} className="lx-note" role="status" data-make-draft-blocked>
              {view.sentence}
              {view.connect && (
                <>
                  {" "}
                  <a href={view.connect}>{CONNECT_OUTLOOK_LINK}</a>
                </>
              )}
            </p>
          )}
          {state.error && (
            <Notice tone="risk" role="alert">
              {state.error}
            </Notice>
          )}
          {state.message && (
            <Notice tone="ok" role="status">
              {state.message}
              {state.webLink && (
                <>
                  {" "}
                  <a href={state.webLink} target="_blank" rel="noreferrer">
                    Open the draft
                  </a>
                </>
              )}
            </Notice>
          )}
          <button
            type="submit"
            className="lx-btn lx-btn-pri"
            disabled={pending || done || view.kind === "blocked"}
            aria-describedby={view.kind === "blocked" ? `md-why-${id}` : undefined}
          >
            {pending ? SAVING : MAKE_DRAFT_BUTTON}
          </button>
        </form>
      )}
    </section>
  );
}
