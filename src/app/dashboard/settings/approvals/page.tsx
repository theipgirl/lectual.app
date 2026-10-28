import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { currentRole } from "@/lib/auth/current-role";
import { orgHasModule } from "@/lib/org/modules";
import { canSeeSetup } from "@/lib/setup/roles";
import { pageTitle } from "@/lib/ui/page-title";
import { APPROVALS_NAME, notReadyYet } from "@/lib/ui/words";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { KIND_INFO, QUEUE_KINDS, eligibleOwners, memberName } from "@/lib/queue/routing";
import { ApprovalRoutingForm, type RoutingRow } from "@/components/queue/ApprovalRoutingForm";

export const metadata: Metadata = { title: pageTitle(`${APPROVALS_NAME} settings`) };

export const dynamic = "force-dynamic";

/**
 * Settings -> Approvals: who each kind of approval is for. Admin tier only (anyone else gets notFound; the action
 * re-checks). Stored in the proposals settings row, so a firm without that feature sees a plain sentence and no form.
 */
export default async function ApprovalSettingsPage() {
  if (!canSeeSetup(await currentRole())) notFound();

  const head = (
    <div>
      <div className="lx-label">Settings</div>
      <h1 className="lx-h1">{APPROVALS_NAME}</h1>
      <p className="lx-sub">
        Choose who handles each kind of approval. For example, routine follow-ups can go to a team member so the attorney only sees legal emails. With nothing chosen, the usual approvers see everything. Nothing is ever sent by approving: a person still sends it.
      </p>
    </div>
  );

  if (!(await orgHasModule("proposals"))) {
    return (
      <>
        {head}
        <p className="lx-note" style={{ margin: 0 }}>
          {notReadyYet("Approval assignments")}
        </p>
      </>
    );
  }

  const loaded = await loadApprovalRouting();
  if (loaded.status !== "ok") {
    return (
      <>
        {head}
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load the approval settings. Refresh to try again.
        </div>
      </>
    );
  }

  const rows: RoutingRow[] = QUEUE_KINDS.map((kind) => ({
    kind,
    label: KIND_INFO[kind].label,
    help: KIND_INFO[kind].help,
    attorneyOnly: KIND_INFO[kind].attorneyOnly,
    current: loaded.routing[kind] ?? "",
    options: eligibleOwners(kind, loaded.members).map((m) => ({ userId: m.userId, name: memberName(m), role: m.role })),
  }));

  return (
    <>
      {head}
      {loaded.dropped > 0 && (
        <p role="status" className="lx-note" style={{ margin: 0 }}>
          {loaded.dropped === 1 ? "One saved assignment" : `${loaded.dropped} saved assignments`} no longer name a valid person and {loaded.dropped === 1 ? "is" : "are"} ignored. Those go to the usual approvers until you save.
        </p>
      )}
      <ApprovalRoutingForm rows={rows} />
    </>
  );
}
