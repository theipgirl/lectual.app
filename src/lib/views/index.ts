import type { Role } from "@/lib/auth/roles";
import type { NavItem, RailNode } from "@/lib/nav";
import { MORE_NAME } from "@/lib/ui/words";

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
  if (!firmHasRoleViews || actingAsStaff || !role) return "technician";
  if (pref.kind === "technician") return "technician";
  const asRole = pref.kind === "as" && canSwitchView(role, false) ? pref.role : role;
  const v = ROLE_VIEW[asRole];
  return v && LIVE_VIEWS.includes(v) ? v : "technician";
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
export const OWNER_BAR_LABEL: Record<string, string> = { "": "Today", queue: "Approvals", review: "Review", proposals: "Proposals", quotes: "Proposals" };

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
    return [slug === "queue" ? { ...item, href: DECK_PATH } : item];
  });
}

/** Rail shape for a view; null = today's RAIL_TREE. */
export function railTreeFor(view: ViewId): readonly (readonly RailNode[])[] | null {
  return view === "owner" ? OWNER_TREE : null;
}
