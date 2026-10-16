"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SettingsTab = { label: string; href: string };

/** The Settings side list. The current tab comes from the URL. */
export function SettingsNav({ tabs }: { tabs: SettingsTab[] }) {
  const path = usePathname() ?? "";
  return (
    <nav style={{ display: "grid", gap: 2 }}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="lx-fi" aria-current={path.startsWith(t.href.replace(/\/$/, "")) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
