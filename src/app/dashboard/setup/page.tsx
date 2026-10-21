import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import { canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import { GoToIntegrationsLink, SetupChecklistView } from "@/components/setup/SetupChecklistView";

export const dynamic = "force-dynamic";

/**
 * Setup. Owner, admin and senior admin only: every other role, a member with
 * no role and a signed-out visitor get the not-found page, which says nothing
 * about what this page is. The page only reads; the "Set up" links go to pages
 * that already exist and do their own role checks.
 */
export default async function SetupPage() {
  const session = await resolveFirmSession({ signInNext: SETUP_PATH });
  if (session.kind !== "ok" || !canSeeSetup(session.role)) notFound();

  const checklist = setupChecklist(await loadSetupState());

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Setup</div>
          <h1 className="lx-h1">Get your firm set up</h1>
          <p className="lx-sub">
            Ten things that make Lectual work for your firm. Each one is checked against what is actually saved, not what
            someone ticked.
          </p>
        </div>
        <GoToIntegrationsLink />
      </div>
      <SetupChecklistView checklist={checklist} />
    </>
  );
}
