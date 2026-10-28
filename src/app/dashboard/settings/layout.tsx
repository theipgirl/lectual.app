import { activeOrgModules } from "@/lib/org/modules";
import { ASSISTANTS_NAME, FEATURES_NAME } from "@/lib/ui/words";
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

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const modules = await activeOrgModules();
  const tabs = TABS.filter((t) => !t.module || modules.includes(t.module)).map(({ label, href }) => ({ label, href }));

  return (
    <div className="lx-split">
      <aside className="lx-side" aria-label="Settings">
        <div className="lx-label">Settings</div>
        <SettingsNav tabs={tabs} />
        <p className="lx-note" style={{ margin: 0 }}>
          Firm-wide settings need Senior admin or above. Your own mailbox is always yours to connect.
        </p>
      </aside>
      <div className="lx-col">{children}</div>
    </div>
  );
}
