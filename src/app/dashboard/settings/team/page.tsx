import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { ROLES, hasRole } from "@/lib/auth/roles";
import { listMemberDirectory } from "@/lib/members/directory";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { LoadFailedCard, Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
import { RemoveMember, ROLE_LABEL, RoleSelect, TeamHeader } from "@/components/settings/TeamForms";
import { RoleTable } from "@/components/settings/RoleTable";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { inviteFormOpen } from "@/lib/team/invite-open";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { TEAM_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(TEAM_NAME) };

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
      <TeamHeader isAdmin={isAdmin} grantable={grantable} defaultOpen={inviteFormOpen(members.length, loadError)} />

      {loadError ? (
        <LoadFailedCard role="alert" what="your team" />
      ) : (
        <SheetCard>
          <SheetScroll>
            <SheetTable minWidth={640}>
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
                      <td data-label="Role">{manageable ? <RoleSelect userId={m.userId} role={m.role} grantable={grantable} name={name} /> : ROLE_LABEL[m.role] ?? m.role}</td>
                      <td data-label="Can approve client mail">
                        {QUEUE_APPROVE_ROLES.includes(m.role) ? <Pill tone="ok">Yes</Pill> : <Pill tone="mute">No</Pill>}
                      </td>
                      {isAdmin && <td className="lx-stack-actions">{manageable && <RemoveMember userId={m.userId} name={name} />}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
      {!isAdmin && <p className="lx-note">{ADMIN_TIER_PHRASE} can manage the team.</p>}

      <RoleTable />
    </>
  );
}
