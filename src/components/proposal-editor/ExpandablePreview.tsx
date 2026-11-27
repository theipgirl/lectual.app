"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@/components/ui/Dialog";
import { lockScroll } from "@/lib/proposal-editor/expand-preview";
import { EDITOR_WORDS } from "@/lib/proposal-editor/vocabulary";

/**
 * "What the client sees": the saved client page, drawn by the page as `children` (the same `ProposalDocument` and the
 * same saved content), in the side column, with an Expand button that shows it full width in the shared large dialog.
 *
 * While the dialog is open the preview is drawn ONLY there (the card says it is shown full width), so the page never
 * holds two copies of the client page. The shared dialog keeps focus inside, closes on Esc or Close, and gives focus
 * back to Expand; the page behind does not scroll. It is portalled to <body> because the editor page is a size
 * container, which would otherwise trap a fixed dialog inside the page.
 */
export function ExpandablePreview({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll([document.documentElement, document.body, ...Array.from(document.querySelectorAll<HTMLElement>(".lx-page"))]);
    return () => unlock();
  }, [open]);

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
            <Dialog size="lg" title="What the client sees" onClose={close} className="pe-xp-dialog">
              <p className="lx-note">Updates when you save</p>
              <div className="pe-xp-body">{children}</div>
            </Dialog>,
            document.body,
          )
        : null}
    </section>
  );
}
