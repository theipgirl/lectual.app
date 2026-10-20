import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getOrgProfile } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { firmTeamSignOff } from "@/lib/consult-proposal/shared";

/**
 * What auditDraft (src/lib/queue/hygiene.ts) needs to judge who signed a client
 * email: the firm's sign-off, its team sign-off and the other members' names.
 * The queue item page and reviewQueueAction both load it here, so the page's
 * warning and the action's refusal are built from the same facts.
 *
 * Never throws. `memberNames` is null when either the profile or the member
 * directory couldn't be read: the signer check is then reported as not run,
 * while the checks that need no lookup (banner, worksheet, placeholder) still do.
 */
export type QueueAuditContext = {
  signOff: string | null;
  teamSignOff: string | null;
  memberNames: string[] | null;
};

export async function loadAuditContext(): Promise<QueueAuditContext> {
  const [profile, members, org] = await Promise.allSettled([
    getOrgProfile(),
    listMemberDirectory(),
    getScopedClient().then((supabase) => supabase.from("crm_org").select("name, slug").maybeSingle()),
  ]);

  const signOff = profile.status === "fulfilled" ? (profile.value?.email_signature?.trim() || null) : null;
  const orgRow = org.status === "fulfilled" && !org.value.error ? org.value.data : null;
  // No identified member (the directory fell back to unidentified rows) means we couldn't check, not "nobody else".
  const identified =
    members.status === "fulfilled"
      ? members.value.flatMap((m) => (m.identified && m.displayName?.trim() ? [m.displayName.trim()] : []))
      : [];
  const memberNames = profile.status === "fulfilled" && identified.length > 0 ? identified : null;

  return {
    signOff,
    teamSignOff: orgRow ? firmTeamSignOff(orgRow.name, orgRow.slug) : null,
    memberNames,
  };
}
