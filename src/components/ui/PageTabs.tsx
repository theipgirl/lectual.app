import Link from "next/link";

export type PageTab = { href: string; label: string; current: boolean; scroll?: boolean; count?: React.ReactNode };

/** The one strip of page tabs (links, so the address says which tab is open). The chosen tab is underlined in burgundy. */
export function PageTabs({ label, tabs, className }: { label: string; tabs: PageTab[]; className?: string }) {
  return (
    <nav className={`lx-tabs${className ? ` ${className}` : ""}`} aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.href + tab.label} href={tab.href} scroll={tab.scroll} aria-current={tab.current ? "page" : undefined}>
          {tab.label}
          {tab.count !== undefined && tab.count !== null && tab.count !== false ? <span className="lx-tabs-count">{tab.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
