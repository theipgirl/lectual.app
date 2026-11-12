"use client";

import { useState } from "react";
import type { LetterBlock } from "@/lib/loe/render";
import {
  LETTER_LIVE_COPY_NOTE,
  LETTER_NEWER_VERSION_NOTE,
  LETTER_PREVIEW_CONTROL,
  LETTER_PREVIEW_PLACEHOLDER_NOTE,
  LETTER_SWITCH_LABEL,
  LETTER_SWITCH_OFF_NOTE,
  LETTER_SWITCH_ON_NOTE,
  letterAttachedLabel,
} from "@/lib/ui/words";

/**
 * The engagement letter switch. It is a plain checkbox INSIDE the editor's one form, so the page's unsaved-changes guard
 * (which listens for `change` on that form) marks the page and "Save and create link" waits for the one Save. Turning it off hides the
 * Preview at once. The letter is drawn as React text from plain-text blocks: nothing here can become markup.
 */
export function LetterSwitch(props: {
  defaultOn: boolean;
  disabled: boolean;
  version: number;
  newerAvailable: boolean;
  blocks: LetterBlock[] | null;
  problems: string[];
}) {
  const [on, setOn] = useState(props.defaultOn);
  return (
    <div className="pe-letter">
      <input type="hidden" name="loeFields" value="1" />
      <label className="pe-check pe-letter-switch">
        <input type="checkbox" name="loeOn" value="on" checked={on} disabled={props.disabled} onChange={(e) => setOn(e.target.checked)} /> {LETTER_SWITCH_LABEL}
      </label>
      <p className="lx-note pe-hint">{on ? LETTER_SWITCH_ON_NOTE : LETTER_SWITCH_OFF_NOTE}</p>
      {on ? (
        <>
          <p className="pe-letter-version">
            <span className="lx-pill lx-pill-ok">{letterAttachedLabel(props.version)}</span>
            {props.newerAvailable ? <span className="lx-note"> {LETTER_NEWER_VERSION_NOTE}</span> : null}
          </p>
          <PreviewBlock blocks={props.blocks} problems={props.problems} />
        </>
      ) : null}
    </div>
  );
}

export function PreviewBlock({ blocks, problems }: { blocks: LetterBlock[] | null; problems: string[] }) {
  return (
    <details className="pe-letter-preview">
      <summary className="lx-btn lx-btn-ghost">{LETTER_PREVIEW_CONTROL}</summary>
      <p className="lx-note pe-hint">
        {LETTER_LIVE_COPY_NOTE} {LETTER_PREVIEW_PLACEHOLDER_NOTE}
      </p>
      {blocks ? (
        <div className="pe-letter-paper" data-testid="editor-letter-preview">
          {blocks.map((block, i) => (
            <p key={i}>
              {block.lead ? <strong>{block.lead}</strong> : null}
              {block.lead && block.text ? " " : null}
              {block.text}
            </p>
          ))}
        </div>
      ) : (
        <ul className="pe-letter-problems" role="alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
