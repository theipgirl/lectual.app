import { redirect } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import { canSeeSetup } from "@/lib/setup/roles";
import { INTEGRATIONS_PATH, SETUP_PATH } from "@/lib/setup/routes";

export const dynamic = "force-dynamic";

/**
 * The Settings rail link. Until every setup item is done, the admin tier lands
 * on the setup checklist (a "couldn't check" item counts as not done); after
 * that, and for every other role, it goes to Integrations as it always has.
 * The setup page has a "Go to Integrations" link, so a firm whose remaining
 * items are Lectual's to switch on is never stuck behind this.
 */
export default async function SettingsIndex() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !canSeeSetup(session.role)) redirect(INTEGRATIONS_PATH);

  const checklist = setupChecklist(await loadSetupState());
  redirect(checklist.complete ? INTEGRATIONS_PATH : SETUP_PATH);
}
