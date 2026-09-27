import type { OrgModule } from "@/lib/org/modules";
import { hasRole, type Role } from "@/lib/auth/roles";

/**
 * Sections of the workspace. One flat list of PAGES, read by the rail, the
 * section label and the catch-all section page (to decide whether a door
 * exists at all). The rail's grouping lives in RAIL_TREE below and only ever
 * names slugs from this list. Hiding an entry is a courtesy; the page itself
 * re-checks `module` via orgHasModule() and calls notFound(). See AGENTS.md
 * "Gate the PAGE and the ACTION, not the nav".
 */
export type NavItem = {
  slug: string;
  label: string;
  /** Shorter name when shown under its parent in the rail ("PNC" under Intake). */
  railLabel?: string;
  href: string;
  /** SVG path data, drawn at 24×24 with a 1.5 stroke (design/Rail.dc.html). */
  icon: string;
  /** Firm must hold this module or the section does not exist for it. */
  module?: OrgModule;
  /** Caller must be at least this privileged. */
  minRole?: Role;
  /** Other path prefixes that belong to this section (a lead's page is part of Intake). */
  also?: readonly string[];
  /** Build step that delivers the real page (docs/MVP-PLAN.md); 7 = after the MVP plan. */
  step: number;
};

/** Icons from design/Rail.dc.html. */
export const ICON = {
  clock: "M12 8v4l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z",
  chat: "M21 12a8 8 0 1 1-3.4-6.5L21 4l-1 4.5A7.9 7.9 0 0 1 21 12zM8 12h.01M12 12h.01M16 12h.01",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  env: "M3 6h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 6l9 7 9-7",
  sms: "M4 5h16v10H9l-5 4z",
  cal: "M4 6h16v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 6V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1M8 3v4M16 3v4M4 11h16",
  tray: "M3 13l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 13h5l1 3h6l1-3h5",
  file: "M6 3h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 3v5h5",
  case: "M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8zM8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  users: "M16 14a4 4 0 1 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M5 21c0-2.8 3.1-5 7-5s7 2.2 7 5",
  shield: "M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z",
  spark: "M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6zM18 14l.9 2.5L21 17l-2.1.5L18 20l-.9-2.5L15 17l2.1-.5z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  cycle: "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c3 3.6 3 14.4 0 18M12 3c-3 3.6-3 14.4 0 18",
  bars: "M4 20V11M10 20V4M16 20v-6M21 20H3",
  sliders: "M4 6h12M18 6h2M4 12h2M8 12h12M4 18h12M18 18h2M16 4v4M6 10v4M16 16v4",
} as const;

export const NAV: readonly NavItem[] = [
  { slug: "", label: "Today", href: "/dashboard/", icon: ICON.clock, step: 6 },
  { slug: "mail", label: "My Mail", href: "/dashboard/mail/", icon: ICON.env, module: "mailbox", step: 4 },
  { slug: "queue", label: "Queue", href: "/dashboard/queue/", icon: ICON.tray, step: 6 },
  { slug: "campaigns", label: "Campaigns", href: "/dashboard/campaigns/", icon: ICON.send, step: 6 },
  { slug: "sms", label: "SMS", href: "/dashboard/sms/", icon: ICON.sms, step: 7 },
  { slug: "calendar", label: "Calendar", href: "/dashboard/calendar/", icon: ICON.cal, step: 6 },
  { slug: "intake", label: "Intake", railLabel: "PNC", href: "/dashboard/intake/", also: ["/dashboard/leads/"], icon: ICON.users, step: 6 },
  { slug: "forms", label: "Intake forms", railLabel: "Forms", href: "/dashboard/forms/", icon: ICON.file, step: 7 },
  { slug: "quotes", label: "Quotes & proposals", href: "/dashboard/quotes/", icon: ICON.file, step: 7 },
  { slug: "matters", label: "Matters", railLabel: "All matters", href: "/dashboard/matters/", icon: ICON.case, step: 6 },
  { slug: "documents", label: "Documents", href: "/dashboard/documents/", icon: ICON.file, step: 6 },
  { slug: "portals", label: "Client portals", href: "/dashboard/portals/", icon: ICON.users, step: 6 },
  { slug: "copilot", label: "AI copilot", href: "/dashboard/copilot/", icon: ICON.spark, step: 7 },
  { slug: "agents", label: "Agents", href: "/dashboard/agents/", icon: ICON.bolt, module: "agents", step: 5 },
  { slug: "skills", label: "Skills", href: "/dashboard/skills/", icon: ICON.cycle, step: 7 },
  { slug: "brain", label: "Firm brain", href: "/dashboard/brain/", icon: ICON.globe, step: 7 },
  { slug: "reports", label: "Reports", href: "/dashboard/reports/", icon: ICON.bars, step: 7 },
  { slug: "settings", label: "Settings", href: "/dashboard/settings/", icon: ICON.sliders, step: 3 },
];

/** A rail row: a page on its own, or a parent that groups pages. */
export type RailNode =
  | { slug: string }
  | {
      label: string;
      icon: string;
      /** Page the parent opens; else its first visible child. */
      link?: string;
      /** Whose count the parent shows (defaults to `link`). */
      countFrom?: string;
      kids: readonly string[];
    };

/**
 * The rail's shape, from design/Rail.dc.html. Groups are separated by a
 * spacer. Settings is not here: the rail pins it to the bottom.
 */
export const RAIL_TREE: readonly (readonly RailNode[])[] = [
  [{ slug: "" }, { label: "Communication", icon: ICON.chat, countFrom: "queue", kids: ["mail", "queue", "campaigns", "sms"] }, { slug: "calendar" }],
  [
    { label: "Intake", icon: ICON.tray, link: "intake", kids: ["intake", "forms"] },
    { slug: "quotes" },
    { label: "Active matters", icon: ICON.case, link: "matters", kids: ["matters", "documents", "portals"] },
  ],
  [{ label: "IP.OS", icon: ICON.shield, kids: ["copilot", "agents", "skills", "brain"] }],
  [{ slug: "reports" }],
];

/**
 * Cookie the rail's pinned state lives in. Read by the dashboard layout so the
 * first paint is already the right width. It lives here, not in the (client)
 * Rail, because a server component cannot read a value exported from a
 * "use client" module.
 */
export const RAIL_PIN_COOKIE = "lx_rail";

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

/** Whether `pathname` is inside `item`'s section. */
export function isNavActive(pathname: string, item: NavItem): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (item.slug === "") return path === "/dashboard/";
  return path.startsWith(item.href) || (item.also ?? []).some((prefix) => path.startsWith(prefix));
}

export type RailEntry = {
  key: string;
  label: string;
  icon: string;
  href: string;
  active: boolean;
  /** A child is the current page (the parent is drawn "open", not selected). */
  childActive: boolean;
  countKey: string | null;
  kids: { key: string; label: string; icon: string; href: string; active: boolean; countKey: string }[];
};

/**
 * RAIL_TREE resolved against what this firm and role may see. A parent with
 * no visible children disappears; a parent's count is its own page's count,
 * or its first counted child's.
 */
export function railGroups(visible: readonly NavItem[], pathname: string): RailEntry[][] {
  const bySlug = new Map(visible.map((item) => [item.slug, item]));
  return RAIL_TREE.map((group) =>
    group.flatMap((node): RailEntry[] => {
      if ("slug" in node) {
        const item = bySlug.get(node.slug);
        if (!item) return [];
        return [{ key: item.slug || "today", label: item.label, icon: item.icon, href: item.href, active: isNavActive(pathname, item), childActive: false, countKey: item.slug, kids: [] }];
      }
      const kids = node.kids.flatMap((slug) => {
        const item = bySlug.get(slug);
        return item ? [{ key: item.slug, label: item.railLabel ?? item.label, icon: item.icon, href: item.href, active: isNavActive(pathname, item), countKey: item.slug }] : [];
      });
      if (kids.length === 0) return [];
      const linked = node.link ? kids.find((k) => k.key === node.link) : undefined;
      return [
        {
          key: node.label,
          label: node.label,
          icon: node.icon,
          href: (linked ?? kids[0]).href,
          active: false,
          childActive: kids.some((k) => k.active),
          countKey: node.countFrom ?? node.link ?? null,
          kids,
        },
      ];
    }),
  ).filter((group) => group.length > 0);
}
