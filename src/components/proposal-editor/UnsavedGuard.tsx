"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { DRAFT_FORM_ID, EMPTY_DIRTY, LEAVE_WARNING, UNSAVED_PILL, anyDirty, dirtyReducer, type DirtyState } from "@/lib/proposal-editor/unsaved";

type Ctx = {
  state: DirtyState;
  markDirty: () => void;
  rowAdded: () => void;
  rowRemoved: () => void;
  markSaved: () => void;
};

const noop = () => {};

/** Outside a provider (New proposal, tests) nothing is ever unsaved. */
const GuardContext = createContext<Ctx>({ state: EMPTY_DIRTY, markDirty: noop, rowAdded: noop, rowRemoved: noop, markSaved: noop });

export function useUnsaved() {
  const ctx = useContext(GuardContext);
  return { any: anyDirty(ctx.state), markDirty: ctx.markDirty, rowAdded: ctx.rowAdded, rowRemoved: ctx.rowRemoved, markSaved: ctx.markSaved };
}

/**
 * ONE marker for the whole edit page. It listens for `input` / `change` on the document and asks the event's
 * own form (`target.form`, which follows the `form=` attribute) whether it is the editor's one form. Adding or
 * removing a row fires no `input` event, so the row buttons call `rowAdded` / `rowRemoved` themselves.
 */
export function UnsavedGuardProvider({ children, initial = EMPTY_DIRTY }: { children?: ReactNode; /** Tests only: start unsaved. */ initial?: DirtyState }) {
  const [state, dispatch] = useReducer(dirtyReducer, initial);

  useEffect(() => {
    function onEdit(e: Event) {
      const form = (e.target as { form?: HTMLFormElement | null } | null)?.form;
      if (form && form.id === DRAFT_FORM_ID) dispatch({ type: "edit" });
    }
    document.addEventListener("input", onEdit);
    document.addEventListener("change", onEdit);
    return () => {
      document.removeEventListener("input", onEdit);
      document.removeEventListener("change", onEdit);
    };
  }, []);

  const dirty = anyDirty(state);
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    function onLeave(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = LEAVE_WARNING;
    }
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const markDirty = useCallback(() => dispatch({ type: "edit" }), []);
  const rowAdded = useCallback(() => dispatch({ type: "rowAdded" }), []);
  const rowRemoved = useCallback(() => dispatch({ type: "rowRemoved" }), []);
  const markSaved = useCallback(() => dispatch({ type: "saved" }), []);
  const value = useMemo(() => ({ state, markDirty, rowAdded, rowRemoved, markSaved }), [state, markDirty, rowAdded, rowRemoved, markSaved]);
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

/** The one "Unsaved changes" marker; nothing when the page is saved. */
export function UnsavedMarker() {
  const { any } = useUnsaved();
  if (!any) return null;
  return (
    <span className="lx-pill lx-pill-warn pe-unsaved" data-unsaved-marker role="status">
      {UNSAVED_PILL}
    </span>
  );
}

/** "Prices update when you save", only while the page has unsaved changes. */
export function UnsavedPriceNote({ text }: { text: string }) {
  const { any } = useUnsaved();
  if (!any) return null;
  return (
    <p className="lx-note pe-price-note" role="status" data-price-note>
      {text}
    </p>
  );
}
