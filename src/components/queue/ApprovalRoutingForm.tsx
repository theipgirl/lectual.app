"use client";

import { useActionState } from "react";
import { saveApprovalRoutingAction } from "@/app/dashboard/settings/approvals/actions";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import { roleLabel } from "@/lib/auth/roles";

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
    <form action={action} className="lx-card" style={{ padding: 20, display: "grid", gap: 16 }}>
      {rows.map((r) => (
        <div key={r.kind} style={{ display: "grid", gap: 4 }}>
          <label htmlFor={`route-${r.kind}`} style={{ fontWeight: 600 }}>
            {r.label}
            {r.attorneyOnly && <span className="lx-pill lx-pill-mute" style={{ marginLeft: 8 }}>Attorneys only</span>}
          </label>
          <p id={`route-${r.kind}-help`} className="lx-note" style={{ margin: 0 }}>
            {r.help}
          </p>
          <select id={`route-${r.kind}`} name={`kind.${r.kind}`} defaultValue={r.current} aria-describedby={`route-${r.kind}-help`} style={{ minHeight: 40, maxWidth: 420 }}>
            <option value="">Usual approvers (default)</option>
            {r.options.map((o) => (
              <option key={o.userId} value={o.userId}>
                {o.name} · {roleLabel(o.role)}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.saved && (
          <span role="status" className="lx-note">
            Saved
          </span>
        )}
        {state.error && (
          <span role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
