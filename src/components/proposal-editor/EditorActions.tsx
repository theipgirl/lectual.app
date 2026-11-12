"use client";

import { DRAFT_FORM_ID, SAVES_FIRST } from "@/lib/proposal-editor/unsaved";
import { BUTTON_WORDS } from "@/lib/proposal-editor/vocabulary";
import { Outcome } from "./ActionForm";
import { useDraft } from "./DraftForm";
import { UnsavedMarker, useUnsaved } from "./UnsavedGuard";

/**
 * Preview, Save and "Save and create link": ONE set of buttons for the whole page. On a desktop it is the last
 * card of the sticky side column; under 900px the same element is the fixed bottom bar (CSS only), so there is
 * exactly one Save and one "Save and create link" in the page, never a second copy for phones.
 *
 * The buttons submit the editor's one form through their `form` attribute. "Save and create link" is not disabled
 * by unsaved changes: it saves first, and says so.
 */
export function EditorActions({
  canSave,
  canCreateLink,
  askText,
  blocking,
}: {
  /** A role that may write, on a draft or saved version. Without it nothing here is drawn but Preview. */
  canSave: boolean;
  /** A named approver on a draft: the button that creates the link. */
  canCreateLink: boolean;
  /** A writer who is not an approver: the sentence shown instead of the button ("Ask Rebecca to create the link."). */
  askText: string | null;
  /** How many checklist items block the link (the button explains, it does not hide). */
  blocking: number;
}) {
  const { save, link } = useDraft();
  const { any } = useUnsaved();
  const busy = save.pending || link.pending;
  return (
    <section className="lx-card pe-actions" aria-label="Page actions" data-pe-actions>
      <div className="pe-actions-row">
        <a className="lx-btn lx-btn-sec pe-act-preview" href="#pe-preview">
          {BUTTON_WORDS.preview}
        </a>
        {canSave && (
          <button type="submit" form={DRAFT_FORM_ID} name="intent" value="save" className={`lx-btn ${any ? "lx-btn-pri" : "lx-btn-sec"}`} disabled={busy}>
            {save.pending ? BUTTON_WORDS.saving : BUTTON_WORDS.save}
          </button>
        )}
        {canCreateLink && (
          <button
            type="submit"
            form={DRAFT_FORM_ID}
            name="intent"
            value="link"
            className="lx-btn lx-btn-pri"
            disabled={busy}
            title={blocking > 0 ? "Some things still need fixing; see Ready to send?" : undefined}
          >
            {link.pending ? BUTTON_WORDS.creatingLink : BUTTON_WORDS.createLink}
          </button>
        )}
      </div>
      {canCreateLink && any && (
        <p className="lx-note pe-saves-first" data-saves-first>
          {SAVES_FIRST}
        </p>
      )}
      {askText && <p className="lx-note pe-ask">{askText}</p>}
      <UnsavedMarker />
      <Outcome state={save.state} pending={save.pending} />
      <Outcome state={link.state} pending={link.pending} />
    </section>
  );
}
