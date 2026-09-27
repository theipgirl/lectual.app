"use client";

import { useActionState } from "react";
import { createTemplateAction } from "@/app/dashboard/campaigns/templates/actions";
import type { ActionState } from "@/app/dashboard/campaigns/errors";

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

/**
 * "New template". `{{first_name}}`, `{{business_name}}` etc. are filled from
 * the enrolled lead when a step drafts (@/lib/campaigns/steps.ts's
 * leadTemplateVars) — this form doesn't validate token spelling, it only
 * records the ones the firm says the template uses, for the list to show.
 */
export function NewTemplateForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTemplateAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field">
        <span className="lx-label">Name</span>
        <input className="lx-input" name="name" required maxLength={200} placeholder="e.g. Nurture — day 4" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Subject</span>
        <input className="lx-input" name="subject" required maxLength={300} placeholder="e.g. What a trademark actually protects" />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Body</span>
        <textarea className="lx-input" name="bodyHtml" required rows={6} placeholder={"Hi {{first_name}},\n\n…"} />
        <span className="lx-note">Use {"{{first_name}}"}, {"{{business_name}}"}, {"{{client_name}}"} to personalize.</span>
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Plain-text body (optional)</span>
        <textarea className="lx-input" name="bodyText" rows={4} placeholder="Falls back to the HTML body if left blank" />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Variables used (comma-separated, for reference)</span>
        <input className="lx-input" name="variables" placeholder="first_name, business_name" />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Creating…" : "Create template"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}
