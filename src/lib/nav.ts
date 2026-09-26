import type { OrgModule } from "@/lib/org/modules";
import { hasRole, type Role } from "@/lib/auth/roles";

/**
 * The rail. One list, read by the rail (to draw doors) and by the section
 * pages (to decide whether a door exists at all). Hiding an entry is a
 * courtesy; the page itself re-checks `module` via orgHasModule() and calls
 * notFound() — see AGENTS.md "Gate the PAGE and the ACTION, not the nav".
 */
export type NavItem = {
  slug: string;
  label: string;
  href: string;
  /** SVG path data, drawn at 24×24 with a 1.6 stroke. */
  icon: string;
  group: "work" | "clients" | "system";
  /** Firm must hold this module or the section does not exist for it. */
  module?: OrgModule;
  /** Caller must be at least this privileged. */
  minRole?: Role;
  /** Build step that delivers the real page (docs/MVP-PLAN.md). */
  step: number;
};

export const NAV: readonly NavItem[] = [
  { slug: "", label: "Today", href: "/dashboard/", group: "work", step: 6,
    icon: "M4 11l8-7 8 7M6 10v10h12V10" },
  { slug: "leads", label: "Leads", href: "/dashboard/leads/", group: "work", step: 6,
    icon: "M4 7h16M4 12h10M4 17h6M17 14l3 3-3 3" },
  { slug: "matters", label: "Matters", href: "/dashboard/matters/", group: "work", step: 6,
    icon: "M4 6h16M4 12h16M4 18h10" },
  { slug: "queue", label: "Queue", href: "/dashboard/queue/", group: "work", step: 6,
    icon: "M4 5h16v10H4zM8 19h8" },
  { slug: "mail", label: "My Mail", href: "/dashboard/mail/", group: "work", module: "mailbox", step: 4,
    icon: "M3 6h18v12H3zM3 7l9 6 9-6" },
  { slug: "calendar", label: "Calendar", href: "/dashboard/calendar/", group: "work", step: 6,
    icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { slug: "documents", label: "Documents", href: "/dashboard/documents/", group: "clients", step: 6,
    icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { slug: "portals", label: "Client portals", href: "/dashboard/portals/", group: "clients", step: 6,
    icon: "M12 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" },
  { slug: "campaigns", label: "Campaigns", href: "/dashboard/campaigns/", group: "clients", step: 6,
    icon: "M4 10v4l11 5V5zM15 9a3 3 0 0 1 0 6M7 14l1.5 5" },
  { slug: "agents", label: "Agents", href: "/dashboard/agents/", group: "system", module: "agents", step: 5,
    icon: "M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" },
  { slug: "settings", label: "Settings", href: "/dashboard/settings/", group: "system", step: 3,
    icon: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" },
];

/** Whether `item` exists for a firm holding `modules`, viewed by `role`. Fails closed. */
export function navItemAllowed(item: NavItem, modules: readonly string[], role: Role): boolean {
  if (item.module && !modules.includes(item.module)) return false;
  if (item.minRole && !hasRole(role, item.minRole)) return false;
  return true;
}

export function visibleNav(modules: readonly string[], role: Role): NavItem[] {
  return NAV.filter((item) => navItemAllowed(item, modules, role));
}

export function navItemBySlug(slug: string): NavItem | undefined {
  return NAV.find((item) => item.slug === slug);
}
