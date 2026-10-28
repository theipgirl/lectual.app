import type { OrgModule } from "@/lib/org/modules";
import { hasRole, type Role } from "@/lib/auth/roles";
import { AI_TOOLS_GROUP, APPROVALS_NAME, ASSISTANTS_NAME, COPILOT_NAME, FIRM_NOTES_NAME, LEADS_GROUP, LEADS_NAME, SHORTCUTS_NAME } from "@/lib/ui/words";

/**
 * Sections of the workspace. One flat list of PAGES, read by the rail and the
 * section label. The rail's grouping lives in RAIL_TREE below and only ever
 * names slugs from this list. Hiding an entry is a courtesy; the page itself
 * re-checks `module` via orgHasModule() and calls notFound(). See AGENTS.md
 * "Gate the PAGE and the ACTION, not the nav".
 */
export type NavItem = {
  slug: string;
  label: string;
  /** Shorter name when shown under its parent in the rail ("Leads" under the Leads group). */
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
  /** `false` = designed but has no page yet: kept out of the rail and every list until it exists. */
  built?: false;
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
  // A camera: a recorded call.
  video: "M3 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM15 10l6-3.5v11L15 14",
} as const;

export const NAV: readonly NavItem[] = [
  { slug: "", label: "Today", href: "/dashboard/", icon: ICON.clock, step: 6 },
  { slug: "mail", label: "My Mail", href: "/dashboard/mail/", icon: ICON.env, module: "mailbox", step: 4 },
  { slug: "queue", label: APPROVALS_NAME, href: "/dashboard/queue/", icon: ICON.tray, step: 6 },
  { slug: "campaigns", label: "Campaigns", href: "/dashboard/campaigns/", icon: ICON.send, step: 6 },
  { slug: "sms", label: "SMS", href: "/dashboard/sms/", icon: ICON.sms, step: 7, built: false },
  // No module: each firm imports only from the Fathom / Zoom account it connected itself (lectual 0081).
  { slug: "meetings", label: "Meetings", href: "/dashboard/meetings/", icon: ICON.video, step: 7 },
  { slug: "calendar", label: "Calendar", href: "/dashboard/calendar/", icon: ICON.cal, step: 6 },
  { slug: "intake", label: LEADS_NAME, railLabel: LEADS_NAME, href: "/dashboard/intake/", also: ["/dashboard/leads/"], icon: ICON.users, step: 6 },
  { slug: "forms", label: "Intake forms", railLabel: "Forms", href: "/dashboard/forms/", icon: ICON.file, step: 7 },
  { slug: "quotes", label: "Quotes & proposals", href: "/dashboard/quotes/", icon: ICON.file, step: 7 },
  // The client trademark proposal (brand names x marks x classes, a named approver, a /p/<token> page). Opt-in per firm.
  { slug: "proposals", label: "Client proposals", railLabel: "Proposals", href: "/dashboard/proposals/", icon: ICON.send, module: "proposals", step: 7 },
  // One board from referral to registration (src/lib/lifecycle). No module: it reads only the firm's own leads and matters.
  { slug: "pipeline", label: "Pipeline", href: "/dashboard/pipeline/", icon: ICON.bars, step: 7 },
  { slug: "matters", label: "Matters", railLabel: "All matters", href: "/dashboard/matters/", icon: ICON.case, step: 6 },
  { slug: "documents", label: "Documents", href: "/dashboard/documents/", icon: ICON.file, step: 6 },
  { slug: "portals", label: "Client portals", href: "/dashboard/portals/", icon: ICON.users, step: 6, built: false },
  { slug: "copilot", label: COPILOT_NAME, href: "/dashboard/copilot/", icon: ICON.spark, step: 7 },
  { slug: "agents", label: ASSISTANTS_NAME, href: "/dashboard/agents/", icon: ICON.bolt, module: "agents", step: 5 },
  { slug: "skills", label: SHORTCUTS_NAME, href: "/dashboard/skills/", icon: ICON.cycle, module: "agent-toolkit", step: 7 },
  { slug: "brain", label: FIRM_NOTES_NAME, href: "/dashboard/brain/", icon: ICON.globe, step: 7 },
  { slug: "settings", label: "Settings", href: "/dashboard/settings/", icon: ICON.sliders, step: 3 },
];

/** A rail row: a page on its own, or a parent that groups pages. */
export type RailNode =
  | { slug: string }
  | {
      label: string;
      icon: string;
      /** The section's Summary view (/dashboard/reports/<report>/), a tab beside its list. */
      report: ReportKey;
      /** Which child's page is the section's main list: the parent opens it. Absent = the first visible child. */
      link?: string;
      kids: readonly string[];
    };

/**
 * The rail's shape, from design/Rail.dc.html. Groups are separated by a
 * spacer. Settings is not here: the rail pins it to the bottom.
 */
export const RAIL_TREE: readonly (readonly RailNode[])[] = [
  [
    { slug: "" },
    // Approvals is a daily destination, so it sits at the top level (Sprint 32).
    { slug: "queue" },
    { label: "Communication", icon: ICON.chat, report: "communication", kids: ["mail", "meetings", "campaigns", "sms"] },
    { slug: "calendar" },
  ],
  [
    { label: LEADS_GROUP, icon: ICON.tray, report: "intake", link: "intake", kids: ["intake", "forms"] },
    { slug: "quotes" },
    { slug: "proposals" },
    { label: "Active matters", icon: ICON.case, report: "matters", link: "matters", kids: ["matters", "pipeline", "documents", "portals"] },
  ],
  [{ label: AI_TOOLS_GROUP, icon: ICON.shield, report: "ipos", kids: ["copilot", "agents", "skills", "brain"] }],
];

/**
 * Each parent section has a Summary view of itself (the prototype's
 * isReport pages): KPIs for the period, what is waiting on the firm, and a
 * link to each child with its count. It is a tab beside the section's list
 * (`SectionTabs`), not what the rail row opens. There is no separate Reports section.
 */
export const REPORTS = {
  communication: { label: "Communication", href: "/dashboard/reports/communication/" },
  intake: { label: LEADS_GROUP, href: "/dashboard/reports/intake/" },
  matters: { label: "Active matters", href: "/dashboard/reports/matters/" },
  ipos: { label: AI_TOOLS_GROUP, href: "/dashboard/reports/ipos/" },
} as const;
export type ReportKey = keyof typeof REPORTS;

export function isReportKey(value: unknown): value is ReportKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REPORTS, value);
}

/**
 * Cookie the rail's pinned state lives in. Read by the dashboard layout so the
 * first paint is already the right width. It lives here, not in the (client)
 * Rail, because a server component cannot read a value exported from a
 * "use client" module.
 */
export const RAIL_PIN_COOKIE = "lx_rail";

/**
 * The rail is open unless the person collapsed it: a missing cookie (a new
 * visitor) is open, and only an explicit "collapsed" closes it.
 */
export function railIsPinned(cookieValue: string | null | undefined): boolean {
  return cookieValue !== "collapsed";
}

/** Whether `item` exists for a firm holding `modules`, viewed by `role`. Fails closed; an unbuilt section never exists. */
export function navItemAllowed(item: NavItem, modules: readonly string[], role: Role): boolean {
  if (item.built === false) return false;
  if (item.module && !modules.includes(item.module)) return false;
  if (item.minRole && !hasRole(role, item.minRole)) return false;
  return true;
}

export function visibleNav(modules: readonly string[], role: Role): NavItem[] {
  const allowed = NAV.filter((item) => navItemAllowed(item, modules, role));
  // One proposals surface: the older quotes entry steps aside once Client proposals is shown.
  return allowed.some((item) => item.slug === "proposals") ? allowed.filter((item) => item.slug !== "quotes") : allowed;
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
 * no visible children disappears; a parent opens its list child (or its first
 * visible child) and shows that list's count.
 */
export function railGroups(visible: readonly NavItem[], pathname: string): RailEntry[][] {
  const bySlug = new Map(visible.filter((item) => item.built !== false).map((item) => [item.slug, item]));
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
      const report = REPORTS[node.report];
      // The parent opens its list; with no list child of its own, its first visible child.
      const listKid = (node.link && kids.find((k) => k.key === node.link)) || kids[0];
      const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
      return [
        {
          key: node.label,
          label: node.label,
          icon: node.icon,
          href: listKid.href,
          active: path.startsWith(report.href),
          childActive: kids.some((k) => k.active),
          countKey: node.link ?? null,
          kids,
        },
      ];
    }),
  ).filter((group) => group.length > 0);
}

/** The count a rail or bar item shows: the queue's three states, then section counts. Absent = nothing (never a false 0). */
export function railCountFor(
  key: string | null,
  queueStatus: "ok" | "unconfigured" | "unavailable",
  pendingCount: number,
  counts: Partial<Record<string, number>>,
): string | null {
  if (!key) return null;
  if (key === "queue") {
    if (queueStatus === "unavailable") return "!";
    return queueStatus === "ok" && pendingCount > 0 ? String(pendingCount > 99 ? "99+" : pendingCount) : null;
  }
  const n = counts[key];
  return n === undefined || n === 0 ? null : String(n > 999 ? "999+" : n);
}

/** The phone bar's own buttons, in order; "More" follows them. */
export const MOBILE_BAR = ["intake", "queue", "mail", "matters"] as const;

/** Short names for the phone bar, where the rail's longer ones would not fit under an icon. */
const MOBILE_LABEL: Record<string, string> = { intake: LEADS_NAME, queue: APPROVALS_NAME, mail: "Mail", matters: "Matters" };

export type MobileBarItem = { slug: string; label: string; icon: string; href: string; active: boolean; countKey: string };

/** The bar's buttons that exist for this firm and role. Mail drops out without the mailbox module. */
export function mobileBarItems(visible: readonly NavItem[], pathname: string): MobileBarItem[] {
  const bySlug = new Map(visible.filter((i) => i.built !== false).map((i) => [i.slug, i]));
  return MOBILE_BAR.flatMap((slug) => {
    const item = bySlug.get(slug);
    return item ? [{ slug, label: MOBILE_LABEL[slug] ?? item.label, icon: item.icon, href: item.href, active: isNavActive(pathname, item), countKey: slug }] : [];
  });
}

/** The More sheet, grouped as the rail groups its sections. Group labels are the rail's. */
const MORE_GROUPS: readonly { label: string; slugs: readonly string[] }[] = [
  { label: "Workspace", slugs: ["", "calendar"] },
  { label: "Communication", slugs: ["meetings", "campaigns"] },
  { label: LEADS_GROUP, slugs: ["forms", "quotes", "proposals"] },
  { label: "Active matters", slugs: ["pipeline", "documents"] },
  { label: AI_TOOLS_GROUP, slugs: ["copilot", "agents", "skills", "brain"] },
  { label: "Firm", slugs: ["settings"] },
];

export type MoreSection = { label: string; items: { slug: string; label: string; href: string; active: boolean }[] };

/** Everything the bar does not carry, filtered through the same visibility the rail uses (fails closed); empty groups vanish. */
export function moreSections(visible: readonly NavItem[], pathname: string): MoreSection[] {
  const bySlug = new Map(visible.filter((i) => i.built !== false).map((i) => [i.slug, i]));
  return MORE_GROUPS.map((group) => ({
    label: group.label,
    items: group.slugs.flatMap((slug) => {
      const item = bySlug.get(slug);
      return item ? [{ slug, label: item.label, href: item.href, active: isNavActive(pathname, item) }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

/**
 * Where a section's List tab goes, for the Summary page's List | Summary
 * strip. Communication and AI tools have no list of their own, so the tab
 * opens their first page (Mail when the firm has the mailbox module, else
 * Meetings; Copilot), exactly as their rail parent row does.
 */
export function reportListHref(key: ReportKey, opts: { hasMailbox: boolean }): string {
  switch (key) {
    case "communication":
      return opts.hasMailbox ? "/dashboard/mail/" : "/dashboard/meetings/";
    case "intake":
      return "/dashboard/intake/";
    case "matters":
      return "/dashboard/matters/";
    case "ipos":
      return "/dashboard/copilot/";
  }
}

/** The name of a section's list tab: the page it opens. */
export function reportListLabel(key: ReportKey, opts: { hasMailbox: boolean }): string {
  switch (key) {
    case "communication":
      return opts.hasMailbox ? "Mail" : "Meetings";
    case "intake":
      return LEADS_NAME;
    case "matters":
      return "Matters";
    case "ipos":
      return COPILOT_NAME;
  }
}
