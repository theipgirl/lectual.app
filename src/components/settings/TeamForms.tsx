"use client";

import { useActionState } from "react";
import {
  inviteMemberAction,
  removeMemberAction,
  setMemberRoleAction,
  type MemberActionState,
} from "@/app/dashboard/settings/team/actions";

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  senior_admin: "Senior admin",
  attorney: "Attorney",
  intake: "Intake",
  paralegal: "Paralegal",
  law_clerk: "Law clerk",
  social_media: "Social media",
  clerk: "Clerk",
  viewer: "Viewer",
};

function Msg({ state }: { state: MemberActionState }) {
  if (state.error) return <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>{state.error}</span>;
  if (state.warning) return <span className="lx-note" style={{ color: "var(--warn)" }}>{state.warning}</span>;
  if (state.notice) return <span className="lx-note" style={{ color: "var(--ok)" }}>{state.notice}</span>;
  return null;
}

/** Only roles at or below the caller's own rank are offered; the server re-checks. */
export function RoleSelect({ userId, role, grantable }: { userId: string; role: string; grantable: string[] }) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(setMemberRoleAction, {});
  const options = grantable.includes(role) ? grantable : [role, ...grantable];
  return (
    <form action={action} className="lx-inline-form">
      <input type="hidden" name="userId" value={userId} />
      <select name="role" className="lx-input" defaultValue={role} aria-label="Role" disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((r) => (
          <option key={r} value={r} disabled={!grantable.includes(r)}>
            {ROLE_LABEL[r] ?? r}
          </option>
        ))}
      </select>
      <Msg state={state} />
    </form>
  );
}

export function RemoveMember({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(removeMemberAction, {});
  return (
    <form
      action={action}
      className="lx-inline-form"
      onSubmit={(e) => {
        if (!confirm(`Remove ${name} from the firm? They're signed out straight away.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
        {pending ? "…" : "Remove"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function InviteForm({ grantable }: { grantable: string[] }) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(inviteMemberAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field">
        <span className="lx-label">Email</span>
        <input className="lx-input" type="email" name="email" required placeholder="name@yourfirm.com" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Role</span>
        <select className="lx-input" name="role" defaultValue={grantable.includes("paralegal") ? "paralegal" : grantable.at(-1)}>
          {grantable.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Inviting…" : "Invite teammate"}
        </button>
        <Msg state={state} />
      </div>
    </form>
  );
}
