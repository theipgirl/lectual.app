"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { createLinkAction, saveDraftAction } from "@/app/dashboard/proposals/[id]/actions";
import { DRAFT_FORM_ID } from "@/lib/proposal-editor/unsaved";
import { LINK_NOT_TURNED_ON } from "@/lib/proposal-editor/vocabulary";
import { useUnsaved } from "./UnsavedGuard";

type Slot = { state: ActionState; pending: boolean };
const DraftContext = createContext<{ save: Slot; link: Slot } | null>(null);

/** The state of the two things the one form can do. Outside the provider (a read-only page) both are idle. */
export function useDraft(): { save: Slot; link: Slot } {
  return useContext(DraftContext) ?? { save: { state: {}, pending: false }, link: { state: {}, pending: false } };
}

/**
 * The edit page's two actions, Save and "Save and create link", share ONE form (`DraftFormElement`). The buttons
 * live in the side column and the phone bar and reach the form through their `form` attribute. Wrap the whole
 * editor (form and side column) once; it sits inside `UnsavedGuardProvider`.
 */
export function DraftProvider({ children }: { children: ReactNode }) {
  const [saveState, saveDispatch, savePending] = useActionState<ActionState, FormData>(saveDraftAction, {});
  const [linkState, linkDispatch, linkPending] = useActionState<ActionState, FormData>(createLinkAction, {});
  const { markSaved } = useUnsaved();

  // A successful save makes the page clean again; a refusal leaves it unsaved. A link step that failed AFTER the save
  // went through (LINK_NOT_TURNED_ON) has still saved the changes.
  useEffect(() => {
    if (saveState.saved && !saveState.error) markSaved();
  }, [saveState, markSaved]);
  useEffect(() => {
    if ((linkState.saved && !linkState.error) || linkState.error === LINK_NOT_TURNED_ON) markSaved();
  }, [linkState, markSaved]);

  return (
    <DraftContext.Provider value={{ save: { state: saveState, pending: savePending }, link: { state: linkState, pending: linkPending } }}>
      <DraftDispatchContext.Provider value={{ saveDispatch, linkDispatch }}>{children}</DraftDispatchContext.Provider>
    </DraftContext.Provider>
  );
}

const DraftDispatchContext = createContext<{ saveDispatch: (f: FormData) => void; linkDispatch: (f: FormData) => void } | null>(null);

/**
 * The one editor form. It posts without React's automatic reset (a refusal must not wipe what was typed), picks
 * the action from the button that was pressed (`intent`), and tells "Save and create link" whether the page has
 * unsaved changes. `dirty=1` is only a hint: the server still re-reads the row.
 */
export function DraftFormElement({ proposalId, updatedAt, children }: { proposalId: string; updatedAt: string; children: ReactNode }) {
  const dispatch = useContext(DraftDispatchContext);
  const { any } = useUnsaved();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dispatch) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const button = submitter instanceof HTMLButtonElement ? submitter : null;
    const data = new FormData(e.currentTarget, button);
    if (button?.value === "link") {
      if (any) data.set("dirty", "1");
      startTransition(() => dispatch.linkDispatch(data));
    } else {
      startTransition(() => dispatch.saveDispatch(data));
    }
  }

  return (
    <form id={DRAFT_FORM_ID} onSubmit={onSubmit} className="pe-draft-form" noValidate>
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      {children}
    </form>
  );
}
