import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadFirmSessionCore } from "@/lib/firm/session";
import { listMemberDirectory } from "@/lib/members/directory";
import type { Role } from "@/lib/auth/roles";
import { signInRedirect } from "@/lib/auth/return-path";
import { env } from "@/lib/env";
import {
  SIGN_OUT_PATH,
  TEAM_SETTINGS_PATH,
  UUID,
  VIEW_AS_COOKIE,
  VIEW_AS_MAX_SECONDS,
  classifyViewAsError,
  enterDecision,
  enterNotice,
  noticeBackPath,
  requestOrigins,
  sameOrigin,
  type ViewAsNotice,
} from "@/lib/views/view-as-rules";

/**
 * The three fixed paths (spec Scope item 2): Enter, Exit and sign-out. Route handlers, not server actions, so the proxy can
 * let them through by path. Each re-reads the session, checks the request is a same-site POST and answers with a 303
 * redirect. They decide with the SESSION, never the viewer. Dependencies are injectable for tests.
 */
export type ViewAsRouteDeps = {
  loadSession: typeof loadFirmSessionCore;
  listMembers: () => Promise<{ userId: string; role: Role }[]>;
  rpc: (fn: "owner_view_as_start" | "owner_view_as_end", args: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>;
  signOut: () => Promise<unknown>;
};

export const liveViewAsDeps: ViewAsRouteDeps = {
  loadSession: loadFirmSessionCore,
  listMembers: async () => (await listMemberDirectory()).map((m) => ({ userId: m.userId, role: m.role })),
  rpc: async (fn, args) => {
    const supabase = await getScopedClient();
    const { error } = await (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }> }).rpc(fn, args);
    return { error };
  },
  signOut: async () => (await getScopedClient()).auth.signOut({ scope: "global" }),
};

const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

function to(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.url), 303);
}
function teamWith(req: NextRequest, notice: ViewAsNotice): NextResponse {
  return to(req, `${TEAM_SETTINGS_PATH}?notice=${notice}`);
}
function siteUrlOrNull(): string | null {
  try {
    return env.SITE_URL ?? null;
  } catch {
    return null;
  }
}

function notSameSite(req: NextRequest): boolean {
  const allowed = requestOrigins({
    url: req.url,
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    forwardedProto: req.headers.get("x-forwarded-proto"),
    siteUrl: siteUrlOrNull(),
  });
  return !sameOrigin(allowed, req.headers.get("origin"), req.headers.get("referer"));
}
const forbidden = () => new NextResponse(null, { status: 403 });

/** POST /dashboard/view-as/enter/ — body: targetUserId. Entering while previewing switches teammate (the database logs `switch`). */
export async function enterViewAs(req: NextRequest, deps: ViewAsRouteDeps = liveViewAsDeps): Promise<NextResponse> {
  if (notSameSite(req)) return forbidden();
  const form = await req.formData().catch(() => null);
  const targetUserId = String(form?.get("targetUserId") ?? "").trim();

  const core = await deps.loadSession().catch(() => null);
  if (!core) return teamWith(req, "view-as-failed");
  if (core.kind === "signed-out") return to(req, signInRedirect(TEAM_SETTINGS_PATH));
  if (core.kind !== "ok") return teamWith(req, "view-as-not-allowed");
  const facts = { userId: core.user.id, orgId: core.org.id, member: core.member };

  let targetRole: Role | null = null;
  if (UUID.test(targetUserId)) {
    try {
      targetRole = (await deps.listMembers()).find((m) => m.userId === targetUserId)?.role ?? null;
    } catch {
      return teamWith(req, "view-as-failed");
    }
  }
  const decision = enterDecision({ facts, targetUserId, targetRole });
  if (!decision.ok) return teamWith(req, enterNotice(decision.reason));

  const { error } = await deps.rpc("owner_view_as_start", { p_target: targetUserId }).catch(() => ({ error: { code: "fetch", message: "" } }));
  if (error) return teamWith(req, enterNotice(classifyViewAsError(error)));

  const res = to(req, "/dashboard/");
  res.cookies.set(VIEW_AS_COOKIE, "1", { ...cookieOptions, maxAge: VIEW_AS_MAX_SECONDS });
  return res;
}

/**
 * POST /dashboard/view-as/exit/. The database is the sole authority: if the end can't be written the preview is NOT over,
 * so the cookie is kept and the page says VIEW_AS_EXIT_FAILED ("try again, or sign out"). When there is nothing to end
 * (not set up, no owner row, no open preview) the cookie goes and Exit lands on Team as usual.
 */
export async function exitViewAs(req: NextRequest, deps: ViewAsRouteDeps = liveViewAsDeps): Promise<NextResponse> {
  if (notSameSite(req)) return forbidden();
  const { error } = await deps.rpc("owner_view_as_end", { p_reason: "exit" }).catch(() => ({ error: { code: "fetch", message: "" } }));
  if (error) {
    const why = classifyViewAsError(error);
    if (why !== "not-set-up" && why !== "not-owner" && why !== "no-session") {
      return to(req, noticeBackPath(req.headers.get("referer"), new URL(req.url).origin, "view-as-exit-failed"));
    }
  }
  const res = to(req, TEAM_SETTINGS_PATH);
  res.cookies.set(VIEW_AS_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}

/**
 * POST /auth/sign-out/ (replaces signOutAction). Ends any preview first, best effort (a failure never blocks signing out:
 * the row's sign-in is gone, so the next state read closes it as session_ended), then signs out everywhere, as before.
 * No origin check: signing out is low-risk and must never be blocked (a proxy that rewrites the host must not keep
 * someone signed in).
 */
export async function signOutRoute(req: NextRequest, deps: ViewAsRouteDeps = liveViewAsDeps): Promise<NextResponse> {
  await deps.rpc("owner_view_as_end", { p_reason: "sign_out" }).catch(() => null);
  await deps.signOut().catch(() => null);
  const res = to(req, "/sign-in/?next=/dashboard");
  res.cookies.set(VIEW_AS_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}

export { SIGN_OUT_PATH };
