"use client";

import { useActionState } from "react";
import { saveApprovalRoutingAction } from "@/app/dashboard/settings/approvals/actions";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { roleLabel } from "@/lib/auth/roles";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { SavedNote } from "@/components/ui/SavedNote";
import { SAVING } from "@/lib/ui/words";
import "./handed.css";

export type RoutingRow = {
  kind: string;
  label: string;
  help: string;
  attorneyOnly: boolean;
  current: string;
  options: { userId: string; name: string; role: string }[];
};

/** One row per kind: the label, one line of help, and a person to send it to. */
export function ApprovalRoutingForm({ rows }: { rows: RoutingRow[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveApprovalRoutingAction, {});
  return (
    <form action={action} className="lx-card lx-pad lx-routing">
      {rows.map((r) => (
        <div key={r.kind} className="lx-routing-row">
          <label htmlFor={`route-${r.kind}`} className="lx-routing-label">
            {r.label}
            {r.attorneyOnly && (
              <span className="lx-handed-pill">
                <Pill>Attorneys only</Pill>
              </span>
            )}
          </label>
          <p id={`route-${r.kind}-help`} className="lx-note lx-routing-help">
            {r.help}
          </p>
          <select id={`route-${r.kind}`} name={`kind.${r.kind}`} defaultValue={r.current} aria-describedby={`route-${r.kind}-help`} className="lx-input lx-routing-select">
            <option value="">Usual approvers (default)</option>
            {r.options.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name} · {roleLabel(o.role)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="lx-queue-filters">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : "Save"}
        </button>
        <SavedNote show={!!state.saved} />
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
      </div>
    </form>
  );
}
