import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { ROLES, hasRole } from "@/lib/auth/roles";
import { listMemberDirectory } from "@/lib/members/directory";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { LoadFailedCard, LoadFailedLine, Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
import { RemoveMember, ROLE_LABEL, RoleSelect, TeamHeader } from "@/components/settings/TeamForms";
import { RoleTable } from "@/components/settings/RoleTable";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { inviteFormOpen } from "@/lib/team/invite-open";
import { ADMIN_TIER_PHRASE, canSeeSetup } from "@/lib/setup/roles";
import { CONSULT_PREP_TEAM_HEADING, CONSULT_PREP_TEAM_HELP, CONSULT_PREP_TEAM_NONE, CONSULT_PREP_TEAM_UNCHECKED, DEADLINE_ALERTS_NONE_CHOSEN, DEADLINE_ALERTS_UNCHECKED, DEADLINE_ALERTS_SETTINGS_HEADING, DEADLINE_ALERTS_SETTINGS_HELP, TEAM_NAME } from "@/lib/ui/words";
import { canReceiveDeadlineAlerts } from "@/lib/today/deadline-alerts";
import { loadRecipientSetting } from "@/lib/today/deadline-alerts-store";
import { DeadlineAlertsForm } from "@/components/settings/DeadlineAlertsForm";
import { ConsultPrepEmailsForm } from "@/components/settings/ConsultPrepEmailsForm";
import { loadConsultPrepSetting } from "@/lib/consult-prep/recipients-store";
import "@/components/settings/deadline-alerts.css";

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
  // Deadline alerts (PGE Sprint 3): every member sees who gets them; only the admin tier changes the list.
  const alerts = loadError ? ({ status: "unavailable" } as const) : await loadRecipientSetting();
  const canSetAlerts = canSeeSetup(session.role);
  // Consult prep emails (automatic consult prep): the same shape, its own firm note.
  const prepSetting = loadError ? ({ status: "unavailable" } as const) : await loadConsultPrepSetting();

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

      <section className="lx-card lx-dl-alerts" aria-labelledby="team-deadline-alerts">
        <h2 id="team-deadline-alerts" className="lx-h2">
          {DEADLINE_ALERTS_SETTINGS_HEADING}
        </h2>
        <p className="lx-note" style={{ margin: 0 }}>{DEADLINE_ALERTS_SETTINGS_HELP}</p>
        {alerts.status !== "ok" ? (
          <LoadFailedLine role="alert" refresh={false}>{DEADLINE_ALERTS_UNCHECKED}</LoadFailedLine>
        ) : canSetAlerts ? (
          <DeadlineAlertsForm
            members={members.filter((m) => canReceiveDeadlineAlerts(m.role)).map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate", role: ROLE_LABEL[m.role] ?? m.role, chosen: alerts.userIds.includes(m.userId) }))}
          />
        ) : alerts.userIds.length === 0 ? (
          <p className="lx-note" style={{ margin: 0 }}>{DEADLINE_ALERTS_NONE_CHOSEN}</p>
        ) : (
          <ul className="lx-dl-alerts-names">
            {members.filter((m) => alerts.userIds.includes(m.userId)).map((m) => (
              <li key={m.userId}>{m.displayName ?? m.email ?? "Teammate"}</li>
            ))}
          </ul>
        )}
        {alerts.status === "ok" && !canSetAlerts && <p className="lx-note" style={{ margin: 0 }}>{ADMIN_TIER_PHRASE} can change who gets them.</p>}
      </section>

      <section className="lx-card lx-dl-alerts" aria-labelledby="team-consult-prep">
        <h2 id="team-consult-prep" className="lx-h2">
          {CONSULT_PREP_TEAM_HEADING}
        </h2>
        <p className="lx-note" style={{ margin: 0 }}>{CONSULT_PREP_TEAM_HELP}</p>
        {prepSetting.status !== "ok" ? (
          <LoadFailedLine role="alert" refresh={false}>{CONSULT_PREP_TEAM_UNCHECKED}</LoadFailedLine>
        ) : canSetAlerts ? (
          <ConsultPrepEmailsForm
            members={members.filter((m) => canReceiveDeadlineAlerts(m.role)).map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate", role: ROLE_LABEL[m.role] ?? m.role, chosen: prepSetting.userIds.includes(m.userId) }))}
            cc={prepSetting.cc}
          />
        ) : prepSetting.userIds.length === 0 ? (
          <p className="lx-note" style={{ margin: 0 }}>{CONSULT_PREP_TEAM_NONE}</p>
        ) : (
          <ul className="lx-dl-alerts-names">
            {members.filter((m) => prepSetting.userIds.includes(m.userId)).map((m) => (
              <li key={m.userId}>{m.displayName ?? m.email ?? "Teammate"}</li>
            ))}
          </ul>
        )}
        {prepSetting.status === "ok" && !canSetAlerts && <p className="lx-note" style={{ margin: 0 }}>{ADMIN_TIER_PHRASE} can change who gets them.</p>}
      </section>

      <RoleTable />
    </>
  );
}
