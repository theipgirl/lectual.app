import type { Role } from "@/lib/auth/roles";

/**
 * View as: an owner's READ-ONLY look at a teammate's view (spec docs/pge/2026-11-17-agentic-ip-os/spec-owner-view-as.md).
 * The pure rules: who may start one, what the database's answers mean, what the database net lets through, and which
 * paths the proxy lets through. No reads here. The session stays the owner's; only "whose view" changes.
 */

/** The hint cookie. It never decides anything: it only lets the proxy refuse a non-GET early (Layer c). */
export const VIEW_AS_COOKIE = "lx_view_as";
/** D1: 2 hours from Enter, on the database clock. The cookie lives as long. */
export const VIEW_AS_MAX_SECONDS = 2 * 60 * 60;

/** The three fixed paths (route handlers, never server actions: the proxy can only allow a path by name). */
export const VIEW_AS_ENTER_PATH = "/dashboard/view-as/enter/";
export const VIEW_AS_EXIT_PATH = "/dashboard/view-as/exit/";
export const SIGN_OUT_PATH = "/auth/sign-out/";
export const VIEW_AS_FIXED_PATHS = [VIEW_AS_ENTER_PATH, VIEW_AS_EXIT_PATH, SIGN_OUT_PATH] as const;
/** Where Exit lands, and where Enter's refusals go back to. */
export const TEAM_SETTINGS_PATH = "/dashboard/settings/team/";

/** The notice codes a redirect carries back (`?notice=`). */
export const PREVIEW_NOTICE = "preview";
export const VIEW_AS_NOTICES = ["preview", "view-as-not-allowed", "view-as-self", "view-as-gone", "view-as-not-ready", "view-as-failed", "view-as-exit-failed"] as const;
export type ViewAsNotice = (typeof VIEW_AS_NOTICES)[number];

/** What `owner_view_as_state()` said for this request. */
export type PreviewState =
  | { kind: "off" }
  | { kind: "not-set-up" }
  | { kind: "unknown" }
  | { kind: "on"; targetUserId: string; startedAt: string };

export const PREVIEW_OFF: PreviewState = { kind: "off" };

/** The flag the write block reads: a preview that is on, or one we couldn't check, refuses writes. */
export type PreviewFlag = "off" | "on" | "unknown";
export function flagOf(state: PreviewState): PreviewFlag {
  if (state.kind === "on") return "on";
  if (state.kind === "unknown") return "unknown";
  return "off";
}
export const refusesWrites = (flag: PreviewFlag): boolean => flag !== "off";

/** The bit of the firm session these rules need. */
export type OwnerFacts = {
  userId: string;
  orgId: string;
  /** The caller's REAL crm_org_member row in the active firm (null for Lectual staff standing in a firm they don't belong to). */
  member: { role: string; org_id: string } | null;
};

/**
 * Only a real owner: an owner crm_org_member row in THIS firm. Never the role claim, never `!actingAsStaff` alone. A platform
 * admin who is a real owner of this firm passes here (and nowhere else); one with no row or a non-owner row does not.
 */
export function isRealOwner(facts: OwnerFacts | null | undefined): boolean {
  return Boolean(facts && facts.member && facts.member.role === "owner" && facts.member.org_id === facts.orgId);
}

export type EnterRefusal = "not-allowed" | "self" | "gone";
/** The app's half of Enter's checks (the database re-checks all of it). `targetRole` null = no row in this firm. */
export function enterDecision(args: { facts: OwnerFacts | null; targetUserId: string; targetRole: Role | null }): { ok: true } | { ok: false; reason: EnterRefusal } {
  if (!isRealOwner(args.facts)) return { ok: false, reason: "not-allowed" };
  if (!UUID.test(args.targetUserId)) return { ok: false, reason: "gone" };
  if (args.targetUserId === args.facts!.userId) return { ok: false, reason: "self" };
  if (!args.targetRole) return { ok: false, reason: "gone" };
  return { ok: true };
}

/** Whether the Team page draws a "View as" button on a row: a real owner, any other current member. */
export function canOfferViewAs(facts: OwnerFacts | null, memberUserId: string): boolean {
  return isRealOwner(facts) && memberUserId !== facts!.userId;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** 0117 not applied: a missing function or table, judged by CODE, never by message text. */
export function isNotSetUpError(error: DbError): boolean {
  const code = error?.code ?? "";
  return code === "42883" || code === "PGRST202" || code === "42P01" || code === "PGRST205";
}

/**
 * 0117's refusals carry a stable prefix (lectual's convention, as src/lib/proposals/errors.ts maps 0089's). The codes 42501
 * and 23514 are shared by several of them, so the prefix tells them apart. `needs-guard` (0116's trigger missing) is read
 * as "not set up".
 */
export type ViewAsDbRefusal = "not-set-up" | "not-owner" | "self" | "target-gone" | "no-session" | "other";
export function classifyViewAsError(error: DbError): ViewAsDbRefusal {
  if (isNotSetUpError(error)) return "not-set-up";
  const msg = error?.message ?? "";
  if (msg.startsWith("view_as_needs_member_guard")) return "not-set-up";
  if (msg.startsWith("view_as_not_owner")) return "not-owner";
  if (msg.startsWith("view_as_self")) return "self";
  if (msg.startsWith("view_as_target_not_member")) return "target-gone";
  if (msg.startsWith("view_as_no_session")) return "no-session";
  return "other";
}

/** `owner_view_as_state()`'s answer -> the state. A malformed row is "unknown" (fail closed), never "off". */
export function stateFromRpc(result: { data: unknown; error: DbError }): PreviewState {
  if (result.error) {
    const why = classifyViewAsError(result.error);
    // Not set up, or no session claim (nothing can be previewed without one): not offered, off.
    if (why === "not-set-up" || why === "no-session") return { kind: "not-set-up" };
    return { kind: "unknown" };
  }
  const rows = Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data];
  if (rows.length === 0) return PREVIEW_OFF;
  const row = rows[0] as { target_user_id?: unknown; started_at?: unknown } | null;
  if (!row || typeof row.target_user_id !== "string" || !UUID.test(row.target_user_id) || typeof row.started_at !== "string") {
    return { kind: "unknown" };
  }
  return { kind: "on", targetUserId: row.target_user_id, startedAt: row.started_at };
}

/** Enter's refusal / failure -> the notice code the Team page reads back. */
export function enterNotice(reason: EnterRefusal | ViewAsDbRefusal): ViewAsNotice {
  switch (reason) {
    case "not-allowed":
    case "not-owner":
    case "no-session":
      return "view-as-not-allowed";
    case "self":
      return "view-as-self";
    case "gone":
    case "target-gone":
      return "view-as-gone";
    case "not-set-up":
      return "view-as-not-ready";
    default:
      return "view-as-failed";
  }
}

// ── Layer b: the database net inside getScopedClient() ────────────────────────────────────────────────────────────

/** The log functions: they write only the view-as log, so they pass the net (Enter's switch needs `start`). */
export const VIEW_AS_RPCS = ["owner_view_as_state", "owner_view_as_end", "owner_view_as_start"] as const;

/**
 * Whether the net must ask the preview flag before sending this request. Reads (GET / HEAD), minting a signed DOWNLOAD
 * link, the three log functions and auth's own refresh / logout pass without asking. Every other call to the REST API or
 * storage, and `PUT /auth/v1/user` (updateUser), asks. Pure: method and path only.
 */
export function netMustAsk(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  if (pathname.startsWith("/rest/v1/")) {
    const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(pathname);
    if (rpc && (VIEW_AS_RPCS as readonly string[]).includes(rpc[1])) return false;
    return true;
  }
  if (pathname.startsWith("/storage/v1/")) {
    // createSignedUrl(s): POST /storage/v1/object/sign/<bucket>/... is a read. The UPLOAD sign (/object/upload/sign/) is not.
    if (pathname.startsWith("/storage/v1/object/sign/")) return false;
    return true;
  }
  if (pathname.startsWith("/auth/v1/")) {
    return m === "PUT" && /^\/auth\/v1\/user\/?$/.test(pathname);
  }
  return false;
}

// ── Layer c: the proxy (a quick refusal only) ─────────────────────────────────────────────────────────────────────

/** Paths with no signed-in caller, or public token pages: never refused by the proxy. */
const PROXY_PUBLIC_API = /^\/api\/(cron|webhooks|worksheet)(\/|$)/;
const PUBLIC_TOKEN_PAGE = /^\/(p|q|i|r)\//;
/** The OAuth connect / callback GETs: a token is minted or saved there. */
const OAUTH_GETS = [/^\/api\/mailbox\/(connect|callback)\//, /^\/api\/meetings\/zoom\/(connect|callback)\/?$/, /^\/api\/lawpay\/(connect|callback)\/?$/];

/** With the hint cookie present: does the proxy answer 409 here? It never reads the preview state. */
export function proxyRefuses(method: string, pathname: string): boolean {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if ((VIEW_AS_FIXED_PATHS as readonly string[]).includes(path)) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return OAUTH_GETS.some((re) => re.test(pathname));
  if (PUBLIC_TOKEN_PAGE.test(pathname)) return false;
  if (pathname.startsWith("/dashboard")) return true;
  if (pathname.startsWith("/api/")) return !PROXY_PUBLIC_API.test(pathname);
  return false;
}

/** A same-site POST: the Origin (or, failing that, the Referer) names this host. */
export function sameOrigin(requestUrl: string, origin: string | null, referer: string | null): boolean {
  const own = new URL(requestUrl).origin;
  const from = origin ?? (referer ? safeOrigin(referer) : null);
  return from !== null && from === own;
}
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Where a refused redirect-style action goes: the page it came from (same origin only), with `?notice=preview`. */
export function noticeBackPath(referer: string | null, requestOrigin: string | null, notice: ViewAsNotice = PREVIEW_NOTICE): string {
  let base = "/dashboard/";
  if (referer) {
    try {
      const u = new URL(referer);
      if ((!requestOrigin || u.origin === requestOrigin) && u.pathname.startsWith("/dashboard")) base = u.pathname + u.search;
    } catch {
      // keep the default
    }
  }
  const u = new URL(base, "http://x");
  u.searchParams.set("notice", notice);
  return u.pathname + u.search;
}

/** The viewer while previewing: the teammate's id, role and name from the member directory. */
export type ViewerIdentity = { userId: string; role: Role; displayName: string };

/** Who the view is drawn for. `target` is the directory's row for the state's target (null = none or unreadable). */
export function viewerOf(args: {
  self: ViewerIdentity;
  state: PreviewState;
  target: ViewerIdentity | null;
}): { viewAs: null | { targetUserId: string; targetRole: Role; targetName: string; startedAt: string }; viewer: ViewerIdentity } {
  const { self, state, target } = args;
  if (state.kind !== "on" || !target || target.userId !== state.targetUserId || target.userId === self.userId) {
    return { viewAs: null, viewer: self };
  }
  return {
    viewAs: { targetUserId: target.userId, targetRole: target.role, targetName: target.displayName, startedAt: state.startedAt },
    viewer: target,
  };
}
