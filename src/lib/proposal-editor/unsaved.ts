/**
 * Unsaved-changes guard for the proposal editor (2026-10-30). Pure decisions only.
 *
 * Each step form (client, one per brand name, package and pay link, wording, discounts, included items)
 * is saved by its own button. "Save and create link" saves none of them, so a change left unsaved
 * would be missing from the client link. This is a UX guard only: the server actions never read
 * browser state and nothing about pricing or the link action changes.
 */

/** Dirty sections, keyed by form id; the value is the words used for it in a sentence. */
export type DirtyState = Readonly<Record<string, string>>;

export type DirtyAction =
  | { type: "dirty"; id: string; label: string }
  | { type: "clean"; id: string }
  | { type: "reset" };

export const EMPTY_DIRTY: DirtyState = Object.freeze({});

export function dirtyReducer(state: DirtyState, action: DirtyAction): DirtyState {
  switch (action.type) {
    case "dirty": {
      if (!action.id) return state;
      const label = action.label.trim() || "this section";
      if (state[action.id] === label) return state;
      return { ...state, [action.id]: label };
    }
    case "clean": {
      if (!(action.id in state)) return state;
      const next = { ...state };
      delete next[action.id];
      return next;
    }
    case "reset":
      return Object.keys(state).length === 0 ? state : EMPTY_DIRTY;
  }
}

/** The labels of the unsaved sections, in the order they became unsaved. */
export function unsavedLabels(state: DirtyState): string[] {
  return Object.values(state);
}

export function isDirty(state: DirtyState, id: string): boolean {
  return id in state;
}

export function anyDirty(state: DirtyState): boolean {
  return Object.keys(state).length > 0;
}

function joinAnd(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Save your changes to The Fold first." or "...to The Fold and Client first." Null when nothing is unsaved. */
export function blockingSentence(labels: readonly string[]): string | null {
  const unique = labels.filter((l, i) => l && labels.indexOf(l) === i);
  if (unique.length === 0) return null;
  return `Save your changes to ${joinAnd(unique)} first.`;
}

/** Whether a button that finishes the proposal is disabled, and the sentence that says why. */
export function finishButtonState(input: {
  pending: boolean;
  blockingErrors?: number;
  unsavedLabels: readonly string[];
}): { disabled: boolean; sentence: string | null } {
  const sentence = blockingSentence(input.unsavedLabels);
  return { disabled: input.pending || (input.blockingErrors ?? 0) > 0 || sentence !== null, sentence };
}

/** The words for the pill beside a section heading. */
export const UNSAVED_PILL = "Unsaved changes";

/** Shown by the browser's own leave prompt (most browsers ignore the text). */
export const LEAVE_WARNING = "You have unsaved changes on this proposal.";
