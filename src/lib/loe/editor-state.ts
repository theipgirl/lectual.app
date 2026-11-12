import type { ApprovedRead } from "./templates-store";
import { hasPendingLetterCheck } from "@/lib/proposals/letter-check";
import { loeIsCurrent } from "@/lib/proposals/loe-snapshot";
import type { ProposalContent, ProposalLoe } from "@/lib/proposals/types";
import type { LoeValues } from "./fields";

/**
 * Which of the editor's Engagement letter states is drawn (Sprint 6). Pure: the page reads the firm's approved letter through
 * the scoped client (`getApprovedLetter`) and passes the read in.
 *
 *  - `none`        the firm has no approved letter of this kind (or the table isn't there yet): the set-up line, NO switch.
 *  - `unreadable`  the read failed: says so, never "no letter", and no switch (a person must not turn a letter off on a guess).
 *  - `on`          the switch is on: the attached version and a Preview.
 *  - `off`         the firm has a letter, this proposal doesn't carry it.
 *  - `absent`      a version that can no longer be edited and has no letter (read-only, no read was made).
 *
 * "On" is simply "the saved copy exists": a proposal made while the firm had an approved letter carries it from the start
 * (the one builder attaches it), and Save removes the copy when the switch is off.
 */
export type EditorLetterState =
  | { state: "none" }
  | { state: "unreadable" }
  | { state: "on"; version: number; title: string; body: string; newerAvailable: boolean; switchable: boolean }
  | {
      state: "off";
      version: number;
      title: string;
      body: string;
      switchable: boolean;
      /**
       * The draft was made while the firm's letter couldn't be read and nobody has chosen since (`letter-check.ts`): the switch is
       * drawn ON, so an ordinary Save attaches the letter. Turning it off is then a person's explicit choice.
       */
      startOn: boolean;
    }
  | { state: "absent" };

export function editorLetterState(input: {
  read: ApprovedRead | null;
  attached: ProposalLoe | undefined;
  /** The content still carries the unresolved "couldn't be attached" check (`hasPendingLetterCheck`). */
  pending?: boolean;
}): EditorLetterState {
  const { read, attached } = input;
  // Not editable (live, accepted...): nothing is read and nothing can change; show what the version carries.
  if (read === null) {
    return attached ? { state: "on", version: attached.template_version, title: attached.title, body: attached.body, newerAvailable: false, switchable: false } : { state: "absent" };
  }
  if (read.status === "unavailable") return { state: "unreadable" };
  if (read.status === "not-set-up" || read.letter === null) return { state: "none" };
  const approved = read.letter;
  if (attached) {
    const newer = attached.template_id !== approved.id || attached.template_version !== approved.version || attached.body !== approved.body || attached.title !== approved.title;
    return { state: "on", version: attached.template_version, title: attached.title, body: attached.body, newerAvailable: newer, switchable: true };
  }
  return { state: "off", version: approved.version, title: approved.title, body: approved.body, switchable: true, startOn: input.pending === true };
}

/** Merge fields shown as [placeholders] in the editor's preview: nothing is merged for a real person here. */
export const PLACEHOLDER_VALUES: Readonly<Required<LoeValues>> = {
  date: "[date]",
  client_name: "[client's name]",
  entity_name: "[business name]",
  address_block: "[client's address]",
  client_email: "[client's email]",
  signer_name: "[name typed at signing]",
  signed_date: "[date signed]",
};

/** What a save does with the switch. `posted` is whether the form carried the switch at all (a save from elsewhere keeps it as it is). */
export function wantedFromForm(form: FormData, currentlyOn: boolean): boolean {
  if (form.get("loeFields") !== "1") return currentlyOn;
  return form.get("loeOn") === "on";
}

/**
 * Create-link's check of the letter copy: `no_letter` (the content carries none: nothing to check), `current` (it is the firm's
 * approved version), `stale` (it differs in id, version, title or body, or the firm no longer has an approved letter) or
 * `unreadable` (the approved-letter read failed: the link is not made on a guess), or `unattached` (no letter, and the draft
 * still carries the unresolved "couldn't be attached" check: a Save attaches the letter or a person turns it off first).
 */
export type LetterCopyCheck =
  | "no_letter"
  | "current"
  | "stale"
  | "unreadable"
  /** No letter on the content, but the "couldn't be attached" check is still unresolved: the link is not made. */
  | "unattached";

export function letterCopyCheck(content: ProposalContent, read: ApprovedRead): LetterCopyCheck {
  if (hasPendingLetterCheck(content)) return "unattached";
  if (!content.loe) return "no_letter";
  if (read.status !== "ok") return "unreadable";
  return loeIsCurrent(content, read.letter) ? "current" : "stale";
}
