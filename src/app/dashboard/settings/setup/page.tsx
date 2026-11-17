import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import { canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import { GoToIntegrationsLink, SetupChecklistView } from "@/components/setup/SetupChecklistView";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { SETUP_NAME } from "@/lib/ui/words";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: pageTitle(SETUP_NAME) };

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
      <PageHeader
        title={SETUP_NAME}
        tour="setup-head"
        sub={
          <>
            What makes Lectual work for your firm. Each step is checked against what is actually saved, not what someone
            ticked. Steps only Lectual can switch on are marked, and they don&apos;t count against you.
          </>
        }
        actions={<GoToIntegrationsLink />}
      />
      <SetupChecklistView checklist={checklist} />
    </>
  );
}
