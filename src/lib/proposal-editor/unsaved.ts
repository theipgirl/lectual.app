/**
 * Unsaved-changes marker for the proposal editor. Pure decisions only.
 *
 * The edit page is ONE form with ONE Save, so there is one marker for the page, not one per
 * section. Typing, ticking, and adding or removing a row (a mark, a class, a credit, an included
 * item, a piece of work) all make the page unsaved; a successful save makes it clean again and a
 * refusal does not. This is a UX guard only: the server actions never read browser state.
 */

export type DirtyState = Readonly<{ dirty: boolean }>;

export type DirtyAction =
  | { type: "edit" }
  | { type: "rowAdded" }
  | { type: "rowRemoved" }
  | { type: "saved" }
  | { type: "refused" };

export const EMPTY_DIRTY: DirtyState = Object.freeze({ dirty: false });

export function dirtyReducer(state: DirtyState, action: DirtyAction): DirtyState {
  switch (action.type) {
    case "edit":
    case "rowAdded":
    case "rowRemoved":
      return state.dirty ? state : { dirty: true };
    case "saved":
      return state.dirty ? EMPTY_DIRTY : state;
    case "refused":
      return state;
  }
}

export function anyDirty(state: DirtyState): boolean {
  return state.dirty;
}

/** The words for the one marker. */
export const UNSAVED_PILL = "Unsaved changes";

/** Beside the "Save and create link" button while the page is unsaved. */
export const SAVES_FIRST = "Saves first";

/** Why a button that needs a saved page is held back. */
export const SAVE_FIRST_SENTENCE = "Save your changes first.";

/** The id of the one editor form. */
export const DRAFT_FORM_ID = "pe-draft";

/** Shown by the browser's own leave prompt (most browsers ignore the text). */
export const LEAVE_WARNING = "You have unsaved changes on this proposal.";
