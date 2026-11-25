import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({}) }));
vi.mock("@/lib/firm/session", () => ({ loadFirmSessionCore: async () => ({ kind: "signed-out" }) }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: async () => [] }));

import { enterViewAs, exitViewAs, signOutRoute, type ViewAsRouteDeps } from "@/lib/views/view-as-routes";
import { VIEW_AS_COOKIE } from "@/lib/views/view-as-rules";

const ORIGIN = "https://app.example.test";
const ORG = "00000000-0000-4000-8000-0000000000a1";
const ME = "11111111-1111-4111-8111-111111111111";
const TEAMMATE = "22222222-2222-4222-8222-222222222222";

function post(pathname: string, body: Record<string, string> = {}, origin: string | null = ORIGIN, referer?: string) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (origin) headers.origin = origin;
  if (referer) headers.referer = referer;
  return new NextRequest(`${ORIGIN}${pathname}`, { method: "POST", headers, body: new URLSearchParams(body).toString() });
}

const okSession = (memberRole: string | null, extra: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  user: { id: ME },
  member: memberRole ? { role: memberRole, org_id: ORG } : null,
  org: { id: ORG, name: "Firm", slug: "f", modules: [] },
  role: (memberRole ?? "owner") as never,
  isPlatformAdmin: false,
  actingAsStaff: memberRole === null,
  switchableFirms: [],
  displayName: "Owner",
  ...extra,
});

function deps(over: Partial<ViewAsRouteDeps> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const d: ViewAsRouteDeps = {
    loadSession: (async () => okSession("owner")) as never,
    listMembers: async () => [{ userId: ME, role: "owner" }, { userId: TEAMMATE, role: "paralegal" }],
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { error: null };
    },
    signOut: vi.fn(async () => undefined),
    ...over,
  };
  return { d, calls };
}
const loc = (r: Response) => r.headers.get("location") ?? "";

describe("Enter", () => {
  it("a real owner enters a teammate's view: one start call, the hint cookie, then Today", async () => {
    const { d, calls } = deps();
    const r = await enterViewAs(post("/dashboard/view-as/enter/", { targetUserId: TEAMMATE }), d);
    expect(r.status).toBe(303);
    expect(new URL(loc(r)).pathname).toBe("/dashboard/");
    expect(calls).toEqual([{ fn: "owner_view_as_start", args: { p_target: TEAMMATE } }]);
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toContain(`${VIEW_AS_COOKIE}=1`);
    expect(set.toLowerCase()).toContain("httponly");
    expect(set.toLowerCase()).toContain("samesite=lax");
    expect(set.toLowerCase()).toContain("secure");
  });

  it("refuses staff (no row), every non-owner, self and a non-member, each with its notice, calling nothing", async () => {
    const cases: [Partial<ViewAsRouteDeps>, string, string][] = [
      [{ loadSession: (async () => okSession(null)) as never }, TEAMMATE, "view-as-not-allowed"],
      [{ loadSession: (async () => okSession("admin")) as never }, TEAMMATE, "view-as-not-allowed"],
      [{ loadSession: (async () => okSession("senior_admin")) as never }, TEAMMATE, "view-as-not-allowed"],
      [{}, ME, "view-as-self"],
      [{}, "33333333-3333-4333-8333-333333333333", "view-as-gone"],
    ];
    for (const [over, target, notice] of cases) {
      const { d, calls } = deps(over);
      const r = await enterViewAs(post("/dashboard/view-as/enter/", { targetUserId: target }), d);
      expect(loc(r), notice).toContain(`notice=${notice}`);
      expect(calls).toEqual([]);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("a missing 0117 or a missing 0116 guard reads 'not switched on yet'; no cookie", async () => {
    for (const error of [{ code: "PGRST202", message: "" }, { code: "42883", message: "" }, { code: "42501", message: "view_as_needs_member_guard: x" }]) {
      const { d } = deps({ rpc: async () => ({ error }) });
      const r = await enterViewAs(post("/dashboard/view-as/enter/", { targetUserId: TEAMMATE }), d);
      expect(loc(r)).toContain("notice=view-as-not-ready");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("entering while previewing switches teammate: one start call (the database writes the switch exit)", async () => {
    const { d, calls } = deps();
    await enterViewAs(post("/dashboard/view-as/enter/", { targetUserId: TEAMMATE }), d);
    expect(calls.map((c) => c.fn)).toEqual(["owner_view_as_start"]);
  });

  it("a cross-site POST is refused", async () => {
    const { d, calls } = deps();
    const r = await enterViewAs(post("/dashboard/view-as/enter/", { targetUserId: TEAMMATE }, "https://evil.example"), d);
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("Exit", () => {
  it("writes exit/exit, clears the cookie, lands on Team", async () => {
    const { d, calls } = deps();
    const r = await exitViewAs(post("/dashboard/view-as/exit/"), d);
    expect(calls).toEqual([{ fn: "owner_view_as_end", args: { p_reason: "exit" } }]);
    expect(new URL(loc(r)).pathname).toBe("/dashboard/settings/team/");
    expect(r.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${VIEW_AS_COOKIE}=;`));
  });

  it("with the database down the preview stays on: the cookie is kept and the page says try again or sign out", async () => {
    const { d } = deps({ rpc: async () => ({ error: { code: "08006", message: "" } }) });
    const r = await exitViewAs(post("/dashboard/view-as/exit/", {}, ORIGIN, `${ORIGIN}/dashboard/matters/`), d);
    expect(loc(r)).toContain("/dashboard/matters/?notice=view-as-exit-failed");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});

describe("Sign out", () => {
  it("ends the preview first, then signs out everywhere, clears the cookie", async () => {
    const order: string[] = [];
    const { d } = deps({
      rpc: async (fn, args) => {
        order.push(`${fn}:${String(args.p_reason)}`);
        return { error: null };
      },
      signOut: async () => {
        order.push("signOut");
      },
    });
    const r = await signOutRoute(post("/auth/sign-out/"), d);
    expect(order).toEqual(["owner_view_as_end:sign_out", "signOut"]);
    expect(loc(r)).toContain("/sign-in/?next=/dashboard");
    expect(r.headers.get("set-cookie") ?? "").toContain(`${VIEW_AS_COOKIE}=;`);
  });

  it("signs out even when ending the preview fails", async () => {
    const signOut = vi.fn(async () => undefined);
    const { d } = deps({ rpc: async () => Promise.reject(new Error("down")), signOut });
    const r = await signOutRoute(post("/auth/sign-out/"), d);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(303);
  });
});

describe("same-site checks behind a proxy", () => {
  const behindProxy = (origin: string | null, referer?: string, proto = "https") => {
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", host: "internal:3000", "x-forwarded-host": "app.example.test", "x-forwarded-proto": proto };
    if (origin !== null) headers.origin = origin;
    if (referer) headers.referer = referer;
    return new NextRequest("http://internal:3000/dashboard/view-as/exit/", { method: "POST", headers, body: "" });
  };

  it("an Origin naming the forwarded host and protocol passes (Vercel)", async () => {
    const { d, calls } = deps();
    const r = await exitViewAs(behindProxy("https://app.example.test"), d);
    expect(r.status).toBe(303);
    expect(calls).toHaveLength(1);
  });

  it("http vs https is a different origin", async () => {
    const { d, calls } = deps();
    expect((await exitViewAs(behindProxy("http://app.example.test"), d)).status).toBe(403);
    expect((await exitViewAs(behindProxy("http://app.example.test", undefined, "http"), d)).status).toBe(303);
    expect(calls).toHaveLength(1);
  });

  it("Origin: null falls back to the Referer; neither is refused", async () => {
    const { d } = deps();
    expect((await exitViewAs(behindProxy("null", "https://app.example.test/dashboard/"), d)).status).toBe(303);
    expect((await exitViewAs(behindProxy("null"), d)).status).toBe(403);
    expect((await enterViewAs(behindProxy(null), d)).status).toBe(403);
  });

  it("sign-out is never blocked by the origin check: a failed check skips only the log write, then signs out and clears the cookie", async () => {
    const signOut = vi.fn(async () => undefined);
    const { d, calls } = deps({ signOut });
    const r = await signOutRoute(post("/auth/sign-out/", {}, "https://evil.example"), d);
    expect(r.status).toBe(303);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(r.headers.get("set-cookie") ?? "").toContain(`${VIEW_AS_COOKIE}=;`);
    const r2 = await signOutRoute(behindProxy("null"), d);
    expect(r2.status).toBe(303);
  });
});
