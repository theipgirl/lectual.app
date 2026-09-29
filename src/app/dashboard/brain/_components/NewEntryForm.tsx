"use client";

import { useActionState } from "react";
import { createBrainEntryAction, type ActionState } from "../actions";
import { BRAIN_CATEGORIES, BRAIN_CATEGORY_LABEL } from "../enums";

/** Collapsible "New entry" form — admin-only (senior_admin+), rendered by the page. */
export default function NewEntryForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createBrainEntryAction,
    {},
  );

  return (
    <details className="lx-card lx-disclosure">
      <summary>New entry</summary>
      <form action={formAction} className="lx-brain-form">
        <label className="lx-field">
          <span className="lx-label">Category</span>
          <select name="category" required defaultValue="" className="lx-input">
            <option value="" disabled>
              Choose a category…
            </option>
            {BRAIN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {BRAIN_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="lx-field">
          <span className="lx-label">Key</span>
          <input name="key" type="text" required placeholder="e.g. brand-voice-tone" className="lx-input" />
        </label>

        <label className="lx-field">
          <span className="lx-label">Title</span>
          <input name="title" type="text" required placeholder="e.g. Brand voice — tone" className="lx-input" />
        </label>

        <label className="lx-field">
          <span className="lx-label">Body</span>
          <textarea name="body" rows={4} placeholder="Notes, guidance, or a template body…" className="lx-input" />
        </label>

        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending} style={{ justifySelf: "start" }}>
          {pending ? "Creating…" : "Create entry"}
        </button>

        {state.error && <p role="alert" className="lx-brain-error">{state.error}</p>}
      </form>
    </details>
  );
}
