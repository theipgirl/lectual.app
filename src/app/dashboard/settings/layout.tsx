import { activeOrgModules } from "@/lib/org/modules";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import { ADMIN_TIER_PHRASE, canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import { ASSISTANTS_NAME, FEATURES_NAME, SETUP_NAME } from "@/lib/ui/words";
import { SettingsNav, type SettingsTab } from "@/components/settings/SettingsNav";

type Tab = SettingsTab & { module?: string };

// Agents lives on the rail (it's also a daily surface); the tab points there.
const TABS: Tab[] = [
  { label: "Integrations", href: "/dashboard/settings/integrations/" },
  { label: ASSISTANTS_NAME, href: "/dashboard/agents/", module: "agents" },
  { label: "Team & roles", href: "/dashboard/settings/team/" },
  { label: "Firm profile", href: "/dashboard/settings/firm/" },
  { label: "Service library", href: "/dashboard/settings/services/" },
  { label: "Client proposals", href: "/dashboard/settings/proposals/", module: "proposals" },
  { label: FEATURES_NAME, href: "/dashboard/settings/modules/" },
];

/**
 * Setup is a tab for the admin tier only, with its own "N of M". The page
 * re-checks the role itself; this tab is a courtesy. A progress that cannot
 * be read leaves the tab without a number rather than inventing one.
 */
async function setupTab(): Promise<Tab[]> {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !canSeeSetup(session.role)) return [];
  try {
    const checklist = setupChecklist(await loadSetupState());
    return [{ label: SETUP_NAME, href: SETUP_PATH, detail: `${checklist.doneCount} of ${checklist.total}` }];
  } catch {
    return [{ label: SETUP_NAME, href: SETUP_PATH }];
  }
}

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [modules, setup] = await Promise.all([activeOrgModules(), setupTab()]);
  const tabs = [...setup, ...TABS.filter((t) => !t.module || modules.includes(t.module))].map(({ label, href, detail }) => ({ label, href, detail }));

  return (
    <div className="lx-split">
      <aside className="lx-side" aria-label="Settings">
        <div className="lx-label">Settings</div>
        <SettingsNav tabs={tabs} />
        <p className="lx-note" style={{ margin: 0 }}>
          {`Firm-wide settings need ${ADMIN_TIER_PHRASE}. Your own mailbox is always yours to connect.`}
        </p>
      </aside>
      <div className="lx-col">{children}</div>
    </div>
  );
}
