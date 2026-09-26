import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { ROLES, hasRole } from "@/lib/auth/roles";
import { listMemberDirectory } from "@/lib/members/directory";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { InviteForm, RemoveMember, ROLE_LABEL, RoleSelect } from "@/components/settings/TeamForms";

export const dynamic = "force-dynamic";

/**
 * Team & roles. Everyone in the firm can see who's on it. Changing roles,
 * inviting and removing are senior_admin and above, and every one of those is
 * re-checked in @/lib/settings (rank ceilings, no self-change, never
 * ownerless) and again by RLS on crm_org_member.
 */
export default async function TeamPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const isAdmin = hasRole(session.role, "senior_admin");
  // You can grant only roles at or below your own.
  const grantable = ROLES.filter((r) => hasRole(session.role, r));

  let members: Awaited<ReturnType<typeof listMemberDirectory>> = [];
  let loadError = false;
  try {
    members = await listMemberDirectory();
  } catch {
    loadError = true;
  }

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Settings</div>
          <h1 className="lx-h1">Team &amp; roles</h1>
          <p className="lx-sub">Ten roles, enforced in the database, not just hidden in the menu. A role decides what someone can open, edit and approve.</p>
        </div>
      </div>

      {isAdmin && (
        <details className="lx-card lx-disclosure">
          <summary>Invite teammate</summary>
          <div style={{ padding: "0 18px 18px" }}>
            <InviteForm grantable={grantable} />
          </div>
        </details>
      )}

      {loadError ? (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load your team. Try again shortly.
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Can approve client mail</th>
                {isAdmin && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.userId === session.user.id;
                const manageable = isAdmin && !self && hasRole(session.role, m.role);
                const name = m.displayName ?? m.email ?? "Teammate";
                return (
                  <tr key={m.userId}>
                    <td className="pri">
                      {name}
                      {self && <span className="lx-note"> (you)</span>}
                      {m.email && m.displayName && <div className="lx-note">{m.email}</div>}
                    </td>
                    <td>{manageable ? <RoleSelect userId={m.userId} role={m.role} grantable={grantable} /> : ROLE_LABEL[m.role] ?? m.role}</td>
                    <td>
                      {QUEUE_APPROVE_ROLES.includes(m.role) ? <span className="lx-pill lx-pill-ok">Yes</span> : <span className="lx-pill lx-pill-mute">No</span>}
                    </td>
                    {isAdmin && <td style={{ textAlign: "right" }}>{manageable && <RemoveMember userId={m.userId} name={name} />}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!isAdmin && <p className="lx-note">Owners, admins and senior admins manage the team.</p>}
    </>
  );
}
