import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptedProposalRow, signedTrademark } from "../loe/signed-fixtures";

/**
 * View as, the named read-only allowlist (spec Layer a). Each allowlisted action, run IN A PREVIEW (flag on) through the real
 * scoped client and its database net, with the network replaced by a spy, sends only reads: GET / HEAD, or POST only to
 * mint a signed download link or to the view-as log. Each is fed realistic rows, so the action runs its real path to the end. No token refresh (no request to an OAuth token endpoint), no write.
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
const MATTER = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";
const OTHER_LEAD = "55555555-5555-4555-8555-555555555555";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const CONTACT = "99999999-9999-4999-8999-999999999999";

/** Realistic rows for each table the real paths read: a firm, a matter and contacts, two leads, a found SIGNED proposal. */
function rowsFor(path: string): unknown {
  const table = path.replace(/^\/rest\/v1\//, "");
  switch (table) {
    case "rpc/current_org_role":
      return "owner";
    case "rpc/current_org_id":
      return "00000000-0000-4000-8000-0000000000a1";
    case "crm_org":
      return [{ id: "00000000-0000-4000-8000-0000000000a1", name: "Example Firm", slug: "ex", modules: ["proposals", "document-center"] }];
    case "crm_org_profile":
      return [{ display_name: "Example Firm", time_zone: "America/New_York" }];
    case "crm_contact":
      return [{ id: CONTACT, first_name: "Ana", last_name: "Ruiz", business_name: null, email: "ana@example.com", phone: null, company_name: null }];
    case "crm_matter_contact":
      return [{ contact_id: CONTACT }];
    case "crm_lead":
      return [
        { id: LEAD, first_name: "Ana", last_name: "Ruiz", business_name: "Acme", mark_text: "ACME", email: "ana@example.com", referral_source: null, created_at: "2026-11-01T00:00:00Z", current_stage_id: null },
        { id: OTHER_LEAD, first_name: "Ana", last_name: "Ruiz", business_name: "Acme", mark_text: "ACME", email: "ana@example.com", referral_source: null, created_at: "2026-11-02T00:00:00Z", current_stage_id: null },
      ];
    case "crm_matter":
      return [{ id: MATTER }];
    case "client_proposal":
      return [acceptedProposalRow(signedTrademark(), { id: PROPOSAL })];
    default:
      return [];
  }
}

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    sent.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), path: url.pathname });
    if (url.pathname.startsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200, headers: { "content-type": "application/json" } });
    const accept = new Headers(init?.headers).get("accept") ?? "";
    let body = rowsFor(url.pathname);
    // Honour an id filter, as PostgREST would.
    const idEq = url.searchParams.get("id")?.match(/^eq\.(.+)$/)?.[1];
    if (idEq && Array.isArray(body)) body = body.filter((r) => (r as { id?: string }).id === idEq);
    // A single row asked for (.single() / .maybeSingle()): PostgREST answers the object.
    if (accept.includes("vnd.pgrst.object") && Array.isArray(body)) body = body[0] ?? null;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});

function onlyReads() {
  const writes = sent.filter((s) => !READ_ONLY.has(s.method) && !s.path.startsWith("/storage/v1/object/sign/") && !/\/rest\/v1\/rpc\/owner_view_as_(state|end)$/.test(s.path));
  expect(writes).toEqual([]);
  expect(sent.filter((s) => /\/token\b|oauth/i.test(s.path))).toEqual([]);
}

describe("each allowlisted action makes only reads in a preview", () => {
  it("searchContactsAction", async () => {
    const { searchContactsAction } = await import("@/app/dashboard/matters/[id]/actions");
    const fd = new FormData();
    fd.set("matterId", MATTER);
    fd.set("q", "Ana");
    const out = await searchContactsAction({}, fd);
    // The real path: the role read, the contact search and the link read all ran and found the contact.
    expect(out.hits?.map((h) => h.id)).toEqual([CONTACT]);
    onlyReads();
  });

  it("loadCompareAction", async () => {
    const { loadCompareAction } = await import("@/app/dashboard/intake/actions");
    const out = (await loadCompareAction(LEAD, OTHER_LEAD)) as { ok: boolean };
    expect(out.ok).toBe(true);
    onlyReads();
  });

  it("pickHubRecordsAction", async () => {
    const { pickHubRecordsAction } = await import("@/lib/onboarding/hub-actions");
    expect(await pickHubRecordsAction()).toEqual({ lead: { status: "ok", id: LEAD }, matter: { status: "ok", id: MATTER } });
    onlyReads();
  });

  it("downloadSignedLetterStaffAction", async () => {
    const { downloadSignedLetterStaffAction } = await import("@/app/dashboard/proposals/[id]/signed-letter-actions");
    const out = await downloadSignedLetterStaffAction(PROPOSAL);
    // A found, signed proposal: the PDF is really built.
    expect(out.ok).toBe(true);
    expect(sent.some((s) => s.path === "/rest/v1/client_proposal")).toBe(true);
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
