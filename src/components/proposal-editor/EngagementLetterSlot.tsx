import Link from "next/link";
import { UnsavedMarker } from "./UnsavedGuard";
import { LetterSwitch, PreviewBlock } from "./LetterSwitch";
import { PLACEHOLDER_VALUES, type EditorLetterState } from "@/lib/loe/editor-state";
import { renderLetter, type LetterBlock } from "@/lib/loe/render";
import {
  LETTER_ABSENT_NOTE,
  LETTER_READ_ONLY_SECTION_NOTE,
  LETTER_SECTION_HEADING,
  LETTER_SECTION_HINT,
  LETTER_SECTION_UNREADABLE,
  LETTER_SETUP_LINE,
  LETTER_SETUP_LINK,
  letterAttachedLabel,
} from "@/lib/ui/words";

/** Where a firm writes and approves its letter. */
const SETUP_HREF = "/dashboard/settings/proposals/engagement-letter/";

function previewOf(body: string): { blocks: LetterBlock[] | null; problems: string[] } {
  const result = renderLetter(body, PLACEHOLDER_VALUES);
  return result.ok ? { blocks: result.blocks, problems: [] } : { blocks: null, problems: result.errors.map((e) => e.sentence) };
}

/**
 * Section 5 of the edit page: the engagement letter. Five states, all drawn (nothing returns null):
 * the set-up line when the firm has no approved letter (no switch), the switch with its attached version and a Preview,
 * the switch off, an unreadable approved-letter read (says so, no switch), and a version that can no longer be edited.
 * `canWrite` false (viewer, social media) never gets the switch input.
 */
export function EngagementLetterSlot({ state, editable }: { state: EditorLetterState; editable: boolean }) {
  return (
    <section className="lx-card pe-card" id="pe-sec-letter" aria-label={LETTER_SECTION_HEADING}>
      <header className="pe-card-head pe-card-head-row">
        <div>
          <h2 className="pe-h">{LETTER_SECTION_HEADING}</h2>
          <p className="lx-note pe-hint">{LETTER_SECTION_HINT}</p>
        </div>
        <UnsavedMarker />
      </header>
      <Body state={state} editable={editable} />
    </section>
  );
}

function Body({ state, editable }: { state: EditorLetterState; editable: boolean }) {
  switch (state.state) {
    case "none":
      return (
        <p className="pe-letter-setup" data-letter-state="none">
          {LETTER_SETUP_LINE}{" "}
          <Link href={SETUP_HREF}>{LETTER_SETUP_LINK}</Link>
        </p>
      );
    case "unreadable":
      return (
        <p className="lx-note" role="alert" data-letter-state="unreadable">
          {LETTER_SECTION_UNREADABLE}
        </p>
      );
    case "absent":
      return (
        <p className="lx-note" data-letter-state="absent">
          {LETTER_ABSENT_NOTE}
        </p>
      );
    case "on":
    case "off": {
      const { blocks, problems } = previewOf(state.body);
      const switchable = editable && state.switchable;
      if (!switchable) {
        // Read-only: what this version carries, with no switch input (a live link, a viewer).
        return (
          <div className="pe-letter" data-letter-state={state.state}>
            {state.state === "on" ? (
              <>
                <p className="pe-letter-version">
                  <span className="lx-pill lx-pill-ok">{letterAttachedLabel(state.version)}</span>
                </p>
                <PreviewBlock blocks={blocks} problems={problems} />
              </>
            ) : (
              <p className="lx-note">{LETTER_ABSENT_NOTE}</p>
            )}
            {editable ? null : <p className="lx-note">{LETTER_READ_ONLY_SECTION_NOTE}</p>}
          </div>
        );
      }
      return (
        <div data-letter-state={state.state}>
          <LetterSwitch
            // On when the saved copy exists, and ALSO for a draft whose letter couldn't be attached when it was made (`startOn`):
            // the default for every proposal is to carry the firm's letter, so an ordinary Save attaches it.
            defaultOn={state.state === "on" || (state.state === "off" && state.startOn)}
            pending={state.state === "off" && state.startOn}
            disabled={false}
            version={state.version}
            newerAvailable={state.state === "on" && state.newerAvailable}
            blocks={blocks}
            problems={problems}
          />
        </div>
      );
    }
  }
}
