"use client";

import { useEffect, useId, useRef, useState } from "react";
import { nextTabFocus } from "@/lib/copilot/launcher";
import { LEADS_COMPARE_FAILED } from "@/lib/ui/words";
import { loadCompareAction } from "../actions";
import CompareView, { type CompareState } from "./CompareView";

export type CompareTarget = { leadId: string; otherId: string; trigger: HTMLElement | null };

const FOCUSABLE = "a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * The "Possible duplicate" compare panel's behaviour: reads both leads when it opens (one server action, read only), moves focus
 * into the dialog, closes on Esc, the Close button or the backdrop, wraps Tab inside, and puts focus back on the marker that
 * opened it. The two leads are never changed here; a Merge link (owner and admin) goes to the merge screen.
 */
export default function CompareDialog({ target, onClose }: { target: CompareTarget | null; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<{ key: string; value: CompareState } | null>(null);
  const key = target ? `${target.leadId}:${target.otherId}` : null;

  useEffect(() => {
    if (!target || !key) return;
    let live = true;
    loadCompareAction(target.leadId, target.otherId)
      .then((result) => {
        if (live) setState({ key, value: result.ok ? { status: "ok", data: result.data } : { status: "failed", error: result.error } });
      })
      .catch(() => {
        if (live) setState({ key, value: { status: "failed", error: LEADS_COMPARE_FAILED } });
      });
    return () => {
      live = false;
    };
  }, [target, key]);

  useEffect(() => {
    if (!target) return;
    const opener = target.trigger;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const index = nextTabFocus({ count: nodes.length, current: nodes.indexOf(document.activeElement as HTMLElement), shift: event.shiftKey });
      if (index === null) return;
      event.preventDefault();
      nodes[index]?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [target, onClose]);

  if (!target) return null;
  const shown: CompareState = state && state.key === key ? state.value : { status: "loading" };
  return (
    <div
      className="ix-cmp-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className="ix-cmp-wrap">
        <CompareView state={shown} titleId={titleId} closeRef={closeRef} onClose={onClose} />
      </div>
    </div>
  );
}
