import type { Role } from "@/lib/auth/roles";
import type { NavItem, RailNode } from "@/lib/nav";
import { APPROVALS_NAME, MORE_NAME, PROPOSALS_NAME, REVIEW_SHORT_NAME } from "@/lib/ui/words";

/**
 * Views decide what is DRAWN (rail, phone bar, Today, account menu) and nothing else. Every page and every action
 * keeps its own role and feature gate, so a view can never widen what anyone may see or do. Pure: no reads here.
 *
 * The per-firm switch is the `role-views` module (a rollout switch kept out of Settings -> Features). With it off,
 * every firm sees today's shell (the technician view), byte for byte.
 */
export const VIEW_IDS = ["technician", "owner", "attorney", "matters-team", "intake", "office", "marketing", "read-only"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

/** The view each role would get. Only views in LIVE_VIEWS are ever drawn; every other role keeps today's shell. */
export const ROLE_VIEW: Record<Role, ViewId> = {
  owner: "owner",
  admin: "office",
  senior_admin: "office",
  attorney: "attorney",
  intake: "intake",
  paralegal: "matters-team",
  law_clerk: "matters-team",
  clerk: "matters-team",
  social_media: "marketing",
  viewer: "read-only",
};

/** Views that are built. Phase 1: the owner view only. */
export const LIVE_VIEWS: readonly ViewId[] = ["owner"];

export const isLiveView = (v: ViewId): boolean => v === "technician" || LIVE_VIEWS.includes(v);

/** The person's own choice, `user_metadata.lectual_view`. Self-service; it decides only what is drawn. */
export type ViewPref = { kind: "auto" } | { kind: "technician" } | { kind: "as"; role: Role };

export const VIEW_PREF_KEY = "lectual_view";

const ROLE_SET = new Set<string>(Object.keys(ROLE_VIEW));

/** `technician` | `auto` | `as:<role>`. Anything else (missing, malformed, unknown role) reads as auto. */
export function parseViewPref(raw: unknown): ViewPref {
  if (raw === "technician") return { kind: "technician" };
  if (typeof raw === "string" && raw.startsWith("as:")) {
    const role = raw.slice(3);
    if (ROLE_SET.has(role)) return { kind: "as", role: role as Role };
  }
  return { kind: "auto" };
}

export function viewPrefValue(pref: ViewPref): string {
  return pref.kind === "as" ? `as:${pref.role}` : pref.kind;
}

/** Who may use the switch and "Preview a view" in the account menu. Lectual staff acting in a firm can too. */
export const VIEW_SWITCH_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];
export function canSwitchView(role: Role | null | undefined, actingAsStaff: boolean): boolean {
  return actingAsStaff || (!!role && VIEW_SWITCH_ROLES.includes(role));
}

/**
 * The view to draw. Fails closed to the technician view (today's shell):
 *  - the firm's switch is off;
 *  - Lectual staff acting inside a firm they do not belong to;
 *  - the person chose the technician view;
 *  - the role's view is not live yet.
 * A preview (`as:<role>`) is honoured only for a person who may preview (canSwitchView).
 */
export function viewFor(args: { role: Role | null | undefined; pref: ViewPref; firmHasRoleViews: boolean; actingAsStaff: boolean }): ViewId {
  const { role, pref, firmHasRoleViews, actingAsStaff } = args;
  if (!firmHasRoleViews) return "technician";
  if (pref.kind === "technician") return "technician";
  // Lectual staff inside a firm see today's shell, unless they chose to preview a view themselves.
  if (actingAsStaff) return pref.kind === "as" ? liveViewOf(pref.role) : "technician";
  if (!role) return "technician";
  const asRole = pref.kind === "as" && canSwitchView(role, false) ? pref.role : role;
  return liveViewOf(asRole);
}

/** The role's view when it is live, else the technician view. */
export function liveViewOf(role: Role): ViewId {
  const v = ROLE_VIEW[role];
  return v && LIVE_VIEWS.includes(v) ? v : "technician";
}

/** The roles a person may preview from the account menu: those whose view is live. */
export function previewableRoles(): Role[] {
  return (Object.keys(ROLE_VIEW) as Role[]).filter((r) => LIVE_VIEWS.includes(ROLE_VIEW[r]));
}

/**
 * Whether a value may be saved as this person's preference. `technician` and `auto` always; `as:<role>` only for a
 * person who may preview (canSwitchView) and only for a role whose view is live. Anything else is refused.
 */
export function prefAllowed(raw: unknown, role: Role | null | undefined, actingAsStaff: boolean): ViewPref | null {
  if (raw === "technician") return { kind: "technician" };
  if (raw === "auto") return { kind: "auto" };
  if (typeof raw !== "string" || !raw.startsWith("as:")) return null;
  const pref = parseViewPref(raw);
  if (pref.kind !== "as" || !canSwitchView(role, actingAsStaff)) return null;
  return previewableRoles().includes(pref.role) ? pref : null;
}

/** The approval deck, the owner view's Approvals. */
export const DECK_PATH = "/dashboard/queue/deck/";

/** The sections the owner view draws, in the order the owner rail lists them. */
export const OWNER_SLUGS = ["", "queue", "review", "proposals", "quotes", "intake", "matters", "calendar"] as const;

/** The owner rail: Today, Approvals, Weekly review, Proposals, then More (Leads, Matters, Calendar). No Settings row, no Reports row. */
export const OWNER_TREE: readonly (readonly RailNode[])[] = [
  [{ slug: "" }, { slug: "queue" }, { slug: "review" }, { slug: "proposals" }, { slug: "quotes" }],
  [{ label: MORE_NAME, icon: "M5 12h.01M12 12h.01M19 12h.01", kids: ["intake", "matters", "calendar"] }],
];

/** The owner phone bar, before More: Today, Approvals, Review, Proposals. */
export const OWNER_BAR = ["", "queue", "review", "proposals", "quotes"] as const;
export const OWNER_BAR_LABEL: Record<string, string> = { "": "Today", queue: APPROVALS_NAME, review: REVIEW_SHORT_NAME, proposals: PROPOSALS_NAME, quotes: PROPOSALS_NAME };

/** The owner phone bar's More sheet. */
export const OWNER_MORE_GROUPS: readonly { label: string; slugs: readonly string[] }[] = [{ label: MORE_NAME, slugs: ["intake", "matters", "calendar"] }];

/**
 * What the rail, phone bar and tour are handed, from what `visibleNav` already allowed. A filter only: it never adds
 * a section the firm or role cannot see. The technician view returns the list unchanged (same array).
 * In the owner view, Approvals opens the deck.
 */
export function drawnNav(items: NavItem[], view: ViewId): NavItem[] {
  if (view === "technician" || !isLiveView(view)) return items;
  const bySlug = new Map(items.map((i) => [i.slug, i]));
  return OWNER_SLUGS.flatMap((slug) => {
    const item = bySlug.get(slug);
    if (!item) return [];
    // The deck is the owner's Approvals; the list and each item's page still belong to the section.
    return [slug === "queue" ? { ...item, href: DECK_PATH, also: [...(item.also ?? []), "/dashboard/queue/"] } : item];
  });
}

/** Rail shape for a view; null = today's RAIL_TREE. */
export function railTreeFor(view: ViewId): readonly (readonly RailNode[])[] | null {
  return view === "owner" ? OWNER_TREE : null;
}

/**
 * Everything the shell needs to draw a view. The technician view is today's shell: no tree, bar or groups (the nav
 * functions' defaults), Settings and Reports rows in the rail, the section label in the top bar.
 */
export type ShellSpec = {
  view: ViewId;
  tree: readonly (readonly RailNode[])[] | undefined;
  bar: { slugs: readonly string[]; labels: Record<string, string> } | undefined;
  moreGroups: readonly { label: string; slugs: readonly string[] }[] | undefined;
  showSettings: boolean;
  showReports: boolean;
  /** Settings is a link in the account menu (the owner rail has no Settings row). */
  settingsInMenu: boolean;
  /** The owner's colours and compact top bar. */
  variant: "owner" | undefined;
};

export function shellFor(view: ViewId): ShellSpec {
  if (view === "owner") {
    return {
      view,
      tree: OWNER_TREE,
      bar: { slugs: OWNER_BAR, labels: OWNER_BAR_LABEL },
      moreGroups: OWNER_MORE_GROUPS,
      showSettings: false,
      showReports: false,
      settingsInMenu: true,
      variant: "owner",
    };
  }
  return { view: "technician", tree: undefined, bar: undefined, moreGroups: undefined, showSettings: true, showReports: true, settingsInMenu: false, variant: undefined };
}

/** What the account menu's View group draws. Absent when the person may not switch or the firm's switch is off. */
export type ViewMenu = {
  /** The saved preference: `technician` | `auto` | `as:<role>`. */
  pref: string;
  /** The person's own role has a live view (today: an owner), so the on/off switch is offered. */
  ownViewLive: boolean;
  /** The view drawn right now is the person's own live view (the switch reads "on"). */
  ownViewOn: boolean;
  /** Roles whose view is live and may be previewed (never the person's own). */
  previewRoles: Role[];
};

export function viewMenuFor(args: { role: Role | null | undefined; pref: ViewPref; firmHasRoleViews: boolean; actingAsStaff: boolean; view: ViewId }): ViewMenu | undefined {
  const { role, pref, firmHasRoleViews, actingAsStaff, view } = args;
  if (!firmHasRoleViews || !canSwitchView(role, actingAsStaff)) return undefined;
  const own = !actingAsStaff && role ? liveViewOf(role) : "technician";
  const ownViewLive = own !== "technician";
  return {
    pref: viewPrefValue(pref),
    ownViewLive,
    ownViewOn: ownViewLive && pref.kind !== "as" && view === own,
    previewRoles: previewableRoles().filter((r) => actingAsStaff || r !== role),
  };
}
