"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SettingsTab = { label: string; href: string; /** Small text after the label, such as "3 of 8". */ detail?: string };

/**
 * The Settings side list; under 900px it lies down as a strip that scrolls
 * sideways (see .lx-side in globals.css). The current tab comes from the URL.
 */
export function SettingsNav({ tabs }: { tabs: SettingsTab[] }) {
  const path = usePathname() ?? "";
  return (
    <nav className="lx-settings-nav" aria-label="Settings sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="lx-fi" aria-current={path.startsWith(t.href.replace(/\/$/, "")) ? "page" : undefined}>
          {t.label}
          {t.detail && <span className="lx-settings-detail">{t.detail}</span>}
        </Link>
      ))}
    </nav>
  );
}
