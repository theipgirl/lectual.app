"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import {
  EMPTY_DIRTY,
  LEAVE_WARNING,
  UNSAVED_PILL,
  anyDirty,
  dirtyReducer,
  isDirty,
  unsavedLabels,
  type DirtyState,
} from "@/lib/proposal-editor/unsaved";

type Ctx = { state: DirtyState; markClean: (id: string) => void };

/** Outside a provider (New proposal, tests) nothing is ever unsaved. */
const GuardContext = createContext<Ctx>({ state: EMPTY_DIRTY, markClean: () => {} });

export function useUnsaved() {
  const { state, markClean } = useContext(GuardContext);
  return { state, labels: unsavedLabels(state), any: anyDirty(state), isDirty: (id: string) => isDirty(state, id), markClean };
}

/**
 * Listens for `input` / `change` on the whole document and asks the event's own form
 * (`target.form`, which follows the `form=` attribute, so More options fields count) whether it
 * is one the editor tracks (`data-unsaved-label`). Keyed by that form's id.
 */
export function UnsavedGuardProvider({ children, initial = EMPTY_DIRTY }: { children?: ReactNode; /** Tests only: start with these sections unsaved. */ initial?: DirtyState }) {
  const [state, dispatch] = useReducer(dirtyReducer, initial);

  useEffect(() => {
    function onEdit(e: Event) {
      const form = (e.target as { form?: HTMLFormElement | null } | null)?.form;
      const label = form?.dataset?.unsavedLabel;
      if (form && form.id && label) dispatch({ type: "dirty", id: form.id, label });
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

  const markClean = useCallback((id: string) => dispatch({ type: "clean", id }), []);
  const value = useMemo(() => ({ state, markClean }), [state, markClean]);
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

/** "Unsaved changes" beside a section heading; nothing when the section is saved. */
export function UnsavedPill({ formId }: { formId: string }) {
  const { isDirty: dirty } = useUnsaved();
  if (!dirty(formId)) return null;
  return (
    <span className="lx-pill lx-pill-warn pe-unsaved" data-unsaved-for={formId} role="status">
      {UNSAVED_PILL}
    </span>
  );
}

/** True when the form is unsaved: the Save button then takes the primary style. */
export function useFormDirty(formId: string | undefined): boolean {
  const { isDirty: dirty } = useUnsaved();
  return formId ? dirty(formId) : false;
}

/** A Save button placed away from its form (More options), tied to it by the `form` attribute. */
export function MoreSaveButton({ formId, label }: { formId: string; label: string }) {
  const dirty = useFormDirty(formId);
  return (
    <div className="pe-save">
      <button type="submit" form={formId} className={`lx-btn ${dirty ? "lx-btn-pri" : "lx-btn-sec"} lx-btn-sm`} data-more-save={formId}>
        {label}
      </button>
    </div>
  );
}
