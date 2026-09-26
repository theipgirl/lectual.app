import Link from "next/link";
import { activeOrgModules } from "@/lib/org/modules";

type Tab = { label: string; href: string | null; module?: string };

// Only Integrations (mailboxes) is live; the rest land with later steps and are
// shown (not linked) so the section's shape matches the design.
const TABS: Tab[] = [
  { label: "Integrations", href: "/dashboard/settings/integrations/" },
  { label: "Agents", href: null, module: "agents" },
  { label: "Team & roles", href: null },
  { label: "Firm profile", href: null },
  { label: "Modules", href: null },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const modules = await activeOrgModules();
  const tabs = TABS.filter((t) => !t.module || modules.includes(t.module));

  return (
    <div className="lx-split">
      <aside className="lx-side" aria-label="Settings">
        <div className="lx-label">Settings</div>
        <nav style={{ display: "grid", gap: 2 }}>
          {tabs.map((t) =>
            t.href ? (
              // Integrations is the only live tab, so it is always the current one.
              <Link key={t.label} href={t.href} className="lx-fi" aria-current="page">
                {t.label}
              </Link>
            ) : (
              <span key={t.label} className="lx-fi" aria-disabled="true" style={{ opacity: 0.55 }}>
                {t.label}
                <span className="lx-fi-n">soon</span>
              </span>
            ),
          )}
        </nav>
        <p className="lx-note" style={{ margin: 0 }}>
          Firm-wide settings need Senior admin or above. Your own mailbox is always yours to
          connect.
        </p>
      </aside>
      <div className="lx-col">{children}</div>
    </div>
  );
}
