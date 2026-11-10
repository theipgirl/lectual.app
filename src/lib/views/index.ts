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

/**
 * A Lectual staff member's preview while acting inside a firm. Firm members have no preference at all: their view
 * comes from their role alone, and a `lectual_view` left on their account by an earlier build is never read.
 */
export type ViewPref = { kind: "technician" } | { kind: "as"; role: Role };

export const NO_PREVIEW: ViewPref = { kind: "technician" };

/**
 * Where a staff preview is kept: `user_metadata.lectual_view_preview = { <org id>: "as:<role>" }`, on the staff
 * member's OWN account, keyed by the firm it was chosen in, so it never follows them into another firm. Only
 * `as:<role>` values are stored; going back to the technician view removes that firm's key.
 */
export const VIEW_PREVIEW_KEY = "lectual_view_preview";

/** How many firms' previews one account keeps; the oldest are dropped first. */
export const VIEW_PREVIEW_MAX = 50;

const ROLE_SET = new Set<string>(Object.keys(ROLE_VIEW));
const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `technician` | `as:<role>`. Anything else (missing, malformed, unknown role) reads as technician. */
export function parseViewPref(raw: unknown): ViewPref {
  if (typeof raw === "string" && raw.startsWith("as:")) {
    const role = raw.slice(3);
    if (ROLE_SET.has(role)) return { kind: "as", role: role as Role };
  }
  return NO_PREVIEW;
}

export function viewPrefValue(pref: ViewPref): string {
  return pref.kind === "as" ? `as:${pref.role}` : "technician";
}

/** The stored map, cleaned: only org-id keys with a previewable `as:<role>` value, at most VIEW_PREVIEW_MAX (newest kept). */
export function parsePreviewMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(([k, v]) => {
    if (!ORG_ID.test(k)) return false;
    const pref = parseViewPref(v);
    return pref.kind === "as" && previewableRoles().includes(pref.role);
  }) as [string, string][];
  return Object.fromEntries(entries.slice(-VIEW_PREVIEW_MAX));
}

/** The preview a staff member chose for THIS firm (read off their metadata); technician when none. */
export function previewFor(metadata: unknown, orgId: string): ViewPref {
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[VIEW_PREVIEW_KEY] : undefined;
  const value = parsePreviewMap(raw)[orgId];
  return value ? parseViewPref(value) : NO_PREVIEW;
}

/** The map after saving `pref` for `orgId`: other firms' entries kept, this firm's set or (technician) removed. */
export function withPreview(raw: unknown, orgId: string, pref: ViewPref): Record<string, string> {
  const map = parsePreviewMap(raw);
  delete map[orgId];
  if (pref.kind === "as") map[orgId] = viewPrefValue(pref);
  const entries = Object.entries(map);
  return Object.fromEntries(entries.slice(-VIEW_PREVIEW_MAX));
}

/**
 * Who sees the view switch: ONLY Lectual staff acting inside a firm, and only when that firm has role views. Firm
 * members (owner included) never switch; their view follows their role.
 */
export function canSwitchView(args: { actingAsStaff: boolean; firmHasRoleViews: boolean }): boolean {
  return args.actingAsStaff && args.firmHasRoleViews;
}

/**
 * The view to draw. Fails closed to the technician view (today's shell):
 *  - the firm's switch is off;
 *  - Lectual staff acting inside a firm, unless they chose a preview for THIS firm (a live view only);
 *  - a firm member whose role's view is not live yet, or whose role cannot be read.
 * A firm member's view is their role's, whatever `preview` says.
 */
export function viewFor(args: { role: Role | null | undefined; preview: ViewPref; firmHasRoleViews: boolean; actingAsStaff: boolean }): ViewId {
  const { role, preview, firmHasRoleViews, actingAsStaff } = args;
  if (!firmHasRoleViews) return "technician";
  if (actingAsStaff) {
    return preview.kind === "as" && previewableRoles().includes(preview.role) ? liveViewOf(preview.role) : "technician";
  }
  return role ? liveViewOf(role) : "technician";
}

/** The role's view when it is live, else the technician view. */
export function liveViewOf(role: Role): ViewId {
  const v = ROLE_VIEW[role];
  return v && LIVE_VIEWS.includes(v) ? v : "technician";
}

/** The roles a staff member may preview from the account menu: those whose view is live. */
export function previewableRoles(): Role[] {
  return (Object.keys(ROLE_VIEW) as Role[]).filter((r) => LIVE_VIEWS.includes(ROLE_VIEW[r]));
}

/** Whether a value may be saved as a staff preview: `technician`, or `as:<role>` for a role whose view is live. */
export function prefAllowed(raw: unknown): ViewPref | null {
  if (raw === "technician") return NO_PREVIEW;
  if (typeof raw !== "string" || !raw.startsWith("as:")) return null;
  const pref = parseViewPref(raw);
  return pref.kind === "as" && previewableRoles().includes(pref.role) ? pref : null;
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

/** What the account menu's View group draws. Absent unless the person may switch (Lectual staff in a firm with role views). */
export type ViewMenu = {
  /** The preview drawn for this firm right now: `technician` | `as:<role>`. */
  pref: string;
  /** Roles whose view is live and may be previewed. */
  previewRoles: Role[];
};

export function viewMenuFor(args: { preview: ViewPref; firmHasRoleViews: boolean; actingAsStaff: boolean }): ViewMenu | undefined {
  const { preview, firmHasRoleViews, actingAsStaff } = args;
  if (!canSwitchView({ actingAsStaff, firmHasRoleViews })) return undefined;
  const roles = previewableRoles();
  const live = preview.kind === "as" && roles.includes(preview.role) ? preview : NO_PREVIEW;
  return { pref: viewPrefValue(live), previewRoles: roles };
}
