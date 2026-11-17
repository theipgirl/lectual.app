"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";
import { dialogClass, dialogKeyAction, type DialogSize } from "@/lib/ui/dialog-keys";
import { focusRestoreTarget } from "@/lib/onboarding/engine";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

type CloseWay = { onClose: () => void; closeHref?: never } | { closeHref: string; onClose?: never };
type Common = CloseWay & {
  title: React.ReactNode;
  titleId?: string;
  describedById?: string;
  footer?: React.ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
};

/** The one close control (36): an X with the label "Close". A button, or a link when the close is a URL (a server-rendered panel). */
export function CloseButton({ onClick, href, label = "Close" }: { onClick?: () => void; href?: string; label?: string }) {
  if (href) {
    return (
      <Link data-close href={href} className="lx-close" aria-label={label} scroll={false}>
        <Icon name="close" size={18} />
      </Link>
    );
  }
  return (
    <button type="button" className="lx-close" aria-label={label} onClick={onClick}>
      <Icon name="close" size={18} />
    </button>
  );
}

/** Focus in on open, Tab wraps, Esc closes, focus goes back to the opener. */
export function useDialogKeys(
  ref: React.RefObject<HTMLElement | null>,
  { onClose, initialFocus, handleEsc = true }: { onClose?: () => void; initialFocus?: React.RefObject<HTMLElement | null>; handleEsc?: boolean },
) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      const action = dialogKeyAction(e, { count: items.length, current: items.indexOf(document.activeElement as HTMLElement) }, { handleEsc });
      if (!action) return;
      e.preventDefault();
      if (action.kind === "close") {
        if (closeRef.current) closeRef.current();
        else root.querySelector<HTMLAnchorElement>("a[data-close]")?.click();
      } else items[action.index]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      focusRestoreTarget(opener)?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Backdrop({ className, onClose, closeHref }: { className: string; onClose?: () => void; closeHref?: string }) {
  if (closeHref) return <Link href={closeHref} className={className} tabIndex={-1} aria-hidden="true" scroll={false} />;
  return <div className={className} onClick={onClose} aria-hidden="true" />;
}

/** The one centred dialog. */
export function Dialog(props: Common & { size?: DialogSize; handleEsc?: boolean }) {
  const { title, titleId, describedById, footer, initialFocus, className, children, size = "md", handleEsc } = props;
  const autoId = useId();
  const id = titleId ?? `dlg-${autoId}`;
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeys(ref, { onClose: props.onClose, initialFocus, handleEsc });
  return (
    <div className="lx-modal-root">
      <Backdrop className="lx-modal-backdrop" onClose={props.onClose} closeHref={props.closeHref} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={describedById} tabIndex={-1} className={dialogClass(size, className)}>
        <header className="lx-modal-head">
          <h2 id={id} className="lx-modal-title">
            {title}
          </h2>
          <CloseButton onClick={props.onClose} href={props.closeHref} />
        </header>
        <div className="lx-modal-body">{children}</div>
        {footer ? <footer className="lx-modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** The one right-side panel (a full-screen sheet under 900px). */
export function SidePanel(props: Common & { handleEsc?: boolean }) {
  const { title, titleId, describedById, footer, initialFocus, className, children, handleEsc } = props;
  const autoId = useId();
  const id = titleId ?? `pnl-${autoId}`;
  const ref = useRef<HTMLElement>(null);
  useDialogKeys(ref, { onClose: props.onClose, initialFocus, handleEsc });
  return (
    <div className="lx-drawer-root">
      <Backdrop className="lx-drawer-backdrop" onClose={props.onClose} closeHref={props.closeHref} />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={describedById} tabIndex={-1} className={`lx-drawer${className ? ` ${className}` : ""}`}>
        <header className="lx-modal-head">
          <h2 id={id} className="lx-modal-title">
            {title}
          </h2>
          <CloseButton onClick={props.onClose} href={props.closeHref} />
        </header>
        <div className="lx-modal-body">{children}</div>
        {footer ? <footer className="lx-modal-foot">{footer}</footer> : null}
      </aside>
    </div>
  );
}
