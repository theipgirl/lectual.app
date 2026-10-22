"use client";

import { markPaidAction, retryUploadAction, undoPaidAction } from "@/app/dashboard/proposals/[id]/paid-actions";
import type { PaidPanelView } from "@/lib/proposals/paid-view";
import { ActionForm, Outcome } from "./ActionForm";

/**
 * Payment and follow-up for one ACCEPTED version: the paid line, Mark paid / Undo for the
 * staff roles that may, the "marked by hand" note, and one line per follow-up step with its
 * outcome. It draws what `buildPaidPanelView` decided (the words, the tones and which
 * buttons exist), and every button is a server action that re-checks the module and the
 * role itself. A failed events read draws "Paid status couldn't be read" and no buttons.
 * The two links are plain anchors so the target is exactly the path built in `paid-view.ts`.
 */
export function PaidPanel({ proposalId, view }: { proposalId: string; view: PaidPanelView }) {
  const hidden = <input type="hidden" name="proposalId" value={proposalId} />;
  const unreadable = view.marker.state === "unreadable";

  return (
    <section className="lx-card pe-card pe-paid" aria-label="Payment and follow-up">
      <header className="pe-card-head">
        <h2 className="pe-h">Payment</h2>
      </header>

      <div className="pe-paid-line">
        <span className={`lx-pill lx-pill-${view.marker.tone}`}>{view.marker.label}</span>
        {view.showMark && (
          <ActionForm action={markPaidAction} className="pe-paid-act">
            {({ state, pending }) => (
              <>
                {hidden}
                <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
                  {pending ? "Marking…" : "Mark paid"}
                </button>
                <Outcome state={state} pending={pending} />
              </>
            )}
          </ActionForm>
        )}
        {view.showUndo && (
          <ActionForm action={undoPaidAction} className="pe-paid-act" confirm="Undo the paid mark? An engagement letter draft that was queued stays in the approval queue.">
            {({ state, pending }) => (
              <>
                {hidden}
                <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
                  {pending ? "Undoing…" : "Undo"}
                </button>
                <Outcome state={state} pending={pending} />
              </>
            )}
          </ActionForm>
        )}
      </div>

      {unreadable ? (
        <p className="lx-note pe-hint" role="status">
          {view.unreadableHelp}
        </p>
      ) : (
        <p className="lx-note pe-hint">{view.byHandNote}</p>
      )}

      {view.chooseTemplate && (
        <div className="lx-banner lx-banner-warn" role="status">
          <strong>{view.chooseTemplate.text}</strong>
          {" "}
          {view.chooseTemplate.href ? (
            <>
              Pick the template from the <a href={view.chooseTemplate.href}>LOE form</a>.
            </>
          ) : (
            "Open the matter first, then pick the template from the LOE form."
          )}
        </div>
      )}

      {view.lines.length > 0 && (
        <ul className="pe-steps" aria-label="Follow-up steps">
          {view.lines.map((line) => (
            <li key={line.key} data-tone={line.tone}>
              <span className="lx-label pe-step-label">{line.label}</span>
              <span className="pe-step-text">{line.text}</span>
              {line.link && <a href={line.link.href}>{line.link.label}</a>}
              {line.retry && (
                <ActionForm action={retryUploadAction} className="pe-paid-act">
                  {({ state, pending }) => (
                    <>
                      {hidden}
                      <input type="hidden" name="step" value={line.retry!} />
                      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
                        {pending ? "Trying…" : "Retry"}
                      </button>
                      <Outcome state={state} pending={pending} />
                    </>
                  )}
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
