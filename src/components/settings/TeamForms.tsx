"use client";

import { useActionState, useState, useTransition } from "react";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { PageHeader } from "@/components/ui/PageHeader";
import { CANCEL, SAVING, TEAM_NAME } from "@/lib/ui/words";
import {
  inviteMemberAction,
  removeMemberAction,
  setMemberRoleAction,
  type MemberActionState,
} from "@/app/dashboard/settings/team/actions";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { roleChangeQuestion } from "@/lib/team/role-change";

export { ROLE_LABEL };

function Msg({ state }: { state: MemberActionState }) {
  if (state.error) return <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>{state.error}</span>;
  if (state.warning) return <span className="lx-note" style={{ color: "var(--warn)" }}>{state.warning}</span>;
  if (state.notice) return <span className="lx-note" style={{ color: "var(--ok)" }}>{state.notice}</span>;
  return null;
}

/**
 * Only roles at or below the caller's own rank are offered; the server re-checks. Choosing a
 * different role does NOT save: it asks first, with Confirm and Cancel (Cancel puts the old role
 * back). The action only fires from Confirm.
 */
export function RoleSelect({ userId, role, grantable, name = "this person" }: { userId: string; role: string; grantable: string[]; name?: string }) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(setMemberRoleAction, {});
  const [chosen, setChosen] = useState(role);
  const options = grantable.includes(role) ? grantable : [role, ...grantable];
  const asking = chosen !== role;
  return (
    <form action={action} className="lx-inline-form">
      <input type="hidden" name="userId" value={userId} />
      <select name="role" className="lx-input" value={chosen} aria-label="Role" disabled={pending} onChange={(e) => setChosen(e.currentTarget.value)}>
        {options.map((r) => (
          <option key={r} value={r} disabled={!grantable.includes(r)}>
            {ROLE_LABEL[r] ?? r}
          </option>
        ))}
      </select>
      {asking && (
        <span role="alert" className="lx-note" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {roleChangeQuestion(name, role, chosen)}
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? SAVING : "Confirm"}
          </button>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending} onClick={() => setChosen(role)}>
            {CANCEL}
          </button>
        </span>
      )}
      <Msg state={state} />
    </form>
  );
}

export function RemoveMember({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(removeMemberAction, {});
  const [, startTransition] = useTransition();
  return (
    <div className="lx-inline-form">
      <InlineConfirm
        label="Remove"
        question={`Remove ${name} from the firm? They're signed out straight away.`}
        pending={pending}
        onConfirm={() => {
          const form = new FormData();
          form.set("userId", userId);
          startTransition(() => action(form));
        }}
      />
      <Msg state={state} />
    </div>
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
          {pending ? SAVING : "Invite teammate"}
        </button>
        <Msg state={state} />
      </div>
    </form>
  );
}

/**
 * The Team page header. "Invite teammate" is the page's one main button (in the header); it opens the form below.
 * A team of fewer than three starts with the form open (`defaultOpen`); only the admin tier sees any of it.
 */
export function TeamHeader({ isAdmin, grantable, defaultOpen }: { isAdmin: boolean; grantable: string[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <PageHeader
        title={TEAM_NAME}
        tour="team-head"
        sub={<>Ten roles, enforced in the database, not just hidden in the menu. A role decides what someone can open, edit and approve.</>}
        actions={
          isAdmin ? (
            <button type="button" className="lx-btn lx-btn-pri" aria-expanded={open} aria-controls="invite-teammate" onClick={() => setOpen((o) => !o)}>
              Invite teammate
            </button>
          ) : undefined
        }
      />
      {isAdmin && open ? (
        <section id="invite-teammate" className="lx-card lx-pad" aria-label="Invite teammate">
          <InviteForm grantable={grantable} />
        </section>
      ) : null}
    </>
  );
}
