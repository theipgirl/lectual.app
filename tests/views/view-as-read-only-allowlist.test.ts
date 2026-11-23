import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * View as, the named read-only allowlist (spec Layer a). Each allowlisted action, run IN A PREVIEW (flag on) through the real
 * scoped client and its database net, with the network replaced by a spy, sends only reads: GET / HEAD, or POST only to
 * mint a signed download link or to the view-as log. No token refresh (no request to an OAuth token endpoint), no write.
 * previewReconcileAction is NOT on the list: in a preview it is refused before its body runs.
 */
vi.mock("@/lib/views/view-as-flag", () => ({ previewFlag: async () => "on", readPreviewState: async () => ({ kind: "on", targetUserId: "22222222-2222-4222-8222-222222222222", startedAt: "2026-11-23T10:00:00Z" }) }));
/** A signed-in owner's session cookie (a made-up token; the network is a spy), so the actions get past "signed out". */
function sessionCookie() {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "11111111-1111-4111-8111-111111111111", exp, role: "authenticated", session_id: "77777777-7777-4777-8777-777777777777" })}.sig`;
  const session = { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user: { id: "11111111-1111-4111-8111-111111111111" } };
  return [{ name: "sb-supabase-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` }];
}
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => sessionCookie(), get: () => undefined, set: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

const sent: { method: string; path: string }[] = [];
const READ_ONLY = new Set(["GET", "HEAD"]);

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    sent.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), path: url.pathname });
    // An empty, well-formed answer for every read: the action finds nothing and stops.
    if (url.pathname.startsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});

function onlyReads() {
  const writes = sent.filter((s) => !READ_ONLY.has(s.method) && !s.path.startsWith("/storage/v1/object/sign/") && !/\/rest\/v1\/rpc\/owner_view_as_(state|end)$/.test(s.path));
  expect(writes).toEqual([]);
  expect(sent.filter((s) => /\/token\b|oauth/i.test(s.path))).toEqual([]);
}

const MATTER = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";

describe("each allowlisted action makes only reads in a preview", () => {
  it("searchContactsAction", async () => {
    const { searchContactsAction } = await import("@/app/dashboard/matters/[id]/actions");
    const fd = new FormData();
    fd.set("matterId", MATTER);
    fd.set("q", "Ana");
    await searchContactsAction({}, fd);
    expect(sent.length).toBeGreaterThan(0); // it really read, through the netted client
    onlyReads();
  });

  it("loadCompareAction", async () => {
    const { loadCompareAction } = await import("@/app/dashboard/intake/actions");
    await loadCompareAction(LEAD, "55555555-5555-4555-8555-555555555555");
    expect(sent.length).toBeGreaterThan(0); // it really read, through the netted client
    onlyReads();
  });

  it("pickHubRecordsAction", async () => {
    const { pickHubRecordsAction } = await import("@/lib/onboarding/hub-actions");
    await pickHubRecordsAction();
    expect(sent.length).toBeGreaterThan(0); // it really read, through the netted client
    onlyReads();
  });

  it("downloadSignedLetterStaffAction", async () => {
    const { downloadSignedLetterStaffAction } = await import("@/app/dashboard/proposals/[id]/signed-letter-actions");
    await downloadSignedLetterStaffAction("66666666-6666-4666-8666-666666666666").catch(() => null);
    onlyReads();
  });

  it("downloadReviewLetterAction and downloadSignedLetterAction (public pages)", async () => {
    const { downloadReviewLetterAction, downloadSignedLetterAction } = await import("@/app/p/[token]/actions");
    const token = "a".repeat(40);
    await downloadReviewLetterAction(token, {}, {}, {});
    await downloadSignedLetterAction(token);
    onlyReads();
  });
});

describe("previewReconcileAction is refused, not allowlisted", () => {
  it("returns the read-only sentence and sends nothing", async () => {
    const { previewReconcileAction } = await import("@/app/dashboard/intake/reconcile/actions");
    const out = (await (previewReconcileAction as (...a: unknown[]) => Promise<unknown>)({}, new FormData())) as { error?: string };
    expect(out.error).toBe("This is a read-only preview. Nothing was changed.");
    expect(sent).toEqual([]);
  });
});
