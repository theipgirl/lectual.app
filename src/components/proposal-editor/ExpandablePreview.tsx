"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { expandKeyAction, lockScroll } from "@/lib/proposal-editor/expand-preview";
import { EDITOR_WORDS } from "@/lib/proposal-editor/vocabulary";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * "What the client sees": the saved client page, drawn by the page as `children` (the same `ProposalDocument` and the
 * same saved content), in the side column, with an Expand button that shows it full width in a modal dialog.
 *
 * While the dialog is open the preview is drawn ONLY there (the card says it is shown full width), so the page never
 * holds two copies of the client page. Focus moves to Close, Esc and Close close it, Tab wraps inside it, the page
 * behind does not scroll, and focus returns to Expand.
 */
export function ExpandablePreview({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const button = opener.current;
    const unlock = lockScroll([document.documentElement, document.body, ...Array.from(document.querySelectorAll<HTMLElement>(".lx-page"))]);
    closeBtn.current?.focus();
    return () => {
      unlock();
      if (button && button.isConnected) button.focus();
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const root = dialog.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    const action = expandKeyAction(e, { count: items.length, current: items.indexOf(document.activeElement as HTMLElement) });
    if (!action) return;
    e.preventDefault();
    if (action.kind === "close") close();
    else items[action.index]?.focus();
  }

  return (
    <section className="lx-card pe-preview" id="pe-preview" aria-label="Preview of the client page">
      <div className="pe-preview-head">
        <span className="lx-label">What the client sees</span>
        <span className="lx-note">Updates when you save</span>
        <button
          ref={opener}
          type="button"
          className="lx-btn lx-btn-sec lx-btn-sm pe-preview-expand"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {EDITOR_WORDS.expandPreview}
        </button>
      </div>
      {open ? (
        <p className="lx-note pe-preview-away">{EDITOR_WORDS.previewShownFullWidth}</p>
      ) : (
        <div className="pe-preview-body">{children}</div>
      )}
      {/* Only ever open after a click, so the document is there for the portal; the server draws the card alone. */}
      {open
        ? createPortal(
            <div className="pe-xp-root">
              <div className="pe-xp-backdrop" onClick={close} aria-hidden="true" />
              <div ref={dialog} className="lx-card pe-xp-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
                <div className="pe-xp-head">
                  <h2 id={titleId} className="lx-label pe-xp-title">
                    What the client sees
                  </h2>
                  <span className="lx-note">Updates when you save</span>
                  <button ref={closeBtn} type="button" className="lx-btn lx-btn-sec lx-btn-sm pe-xp-close" onClick={close}>
                    {EDITOR_WORDS.closePreview}
                  </button>
                </div>
                <div className="pe-xp-body">{children}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
