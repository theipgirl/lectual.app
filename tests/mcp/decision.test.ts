import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/oauth/decision/ re-checks everything itself (the page is not the gate). Supabase,
 * the session and the firm's switch are mocked; nothing here reaches a network.
 */
const ID = "authz_0123456789";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

const state = vi.hoisted(() => ({
  session: { kind: "ok" } as Record<string, unknown>,
  moduleOn: true,
  details: null as unknown,
  approve: vi.fn(),
  deny: vi.fn(),
  getDetails: vi.fn(),
}));

vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => state.session }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => m === "claude-connector" && state.moduleOn }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    auth: { oauth: { getAuthorizationDetails: state.getDetails, approveAuthorization: state.approve, denyAuthorization: state.deny } },
  }),
}));

import { POST } from "@/app/api/oauth/decision/route";
import { runDecision } from "@/lib/mcp/decision";

const okSession = { kind: "ok", user: { id: "u1" }, org: { id: "o1", name: "Hartwell IP", slug: "h", modules: [] }, displayName: "Ada" };

function post(body: Record<string, string>, origin: string | null = "https://app.lectual.app") {
  const headers = new Headers({ host: "app.lectual.app", "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  return new Request("https://app.lectual.app/api/oauth/decision/", { method: "POST", headers, body: new URLSearchParams(body).toString() });
}

beforeEach(() => {
  state.session = okSession;
  state.moduleOn = true;
  state.getDetails.mockReset().mockResolvedValue({ data: { authorization_id: ID, redirect_uri: CLAUDE, user: { id: "u1", email: "a@b" }, client: {}, scope: "" }, error: null });
  state.approve.mockReset().mockResolvedValue({ data: { redirect_url: `${CLAUDE}?code=c&state=s` }, error: null });
  state.deny.mockReset().mockResolvedValue({ data: { redirect_url: `${CLAUDE}?error=access_denied` }, error: null });
});

async function location(res: Response) {
  expect(res.status).toBe(303);
  return res.headers.get("location");
}

describe("POST /api/oauth/decision/", () => {
  it("approves when everything holds and sends the browser to Claude", async () => {
    expect(await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }))))).toBe(`${CLAUDE}?code=c&state=s`);
    expect(state.approve).toHaveBeenCalledWith(ID, { skipBrowserRedirect: true });
  });

  it("deny goes back to Claude with its error", async () => {
    expect(await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "deny" }))))).toBe(`${CLAUDE}?error=access_denied`);
    expect(state.approve).not.toHaveBeenCalled();
  });

  const refusals: Array<[string, () => void, string]> = [
    ["the firm lacks the connector", () => { state.moduleOn = false; }, `/oauth/consent/?authorization_id=${ID}`],
    ["the person has no firm", () => { state.session = { kind: "no-access" }; }, `/oauth/consent/?authorization_id=${ID}`],
    [
      "the client's redirect is not Claude's",
      () => state.getDetails.mockResolvedValue({ data: { authorization_id: ID, redirect_uri: "https://evil.example/cb", user: { id: "u1" } }, error: null }),
      `/oauth/consent/?authorization_id=${ID}`,
    ],
    ["Supabase can't read the request", () => state.getDetails.mockResolvedValue({ data: null, error: { message: "x" } }), `/oauth/consent/?authorization_id=${ID}`],
    ["signed out", () => { state.session = { kind: "signed-out" }; }, `/sign-in/?next=${encodeURIComponent(`/oauth/consent/?authorization_id=${ID}`)}`],
  ];
  for (const [name, arrange, back] of refusals) {
    it(`approves nothing when ${name}`, async () => {
      arrange();
        const loc = await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }))));
      expect(loc).toBe(`https://app.lectual.app${back}`);
      expect(state.approve).not.toHaveBeenCalled();
      expect(state.deny).not.toHaveBeenCalled();
    });
  }

  it("approves nothing from another site or with no Origin", async () => {
    for (const origin of ["https://evil.example", null]) {
        await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }, origin)));
    }
    expect(state.getDetails).not.toHaveBeenCalled();
    expect(state.approve).not.toHaveBeenCalled();
  });

  it("approves nothing for a malformed id or decision", async () => {
    expect(await location(await POST(new NextRequest(post({ authorization_id: "../x", decision: "allow" }))))).toBe("https://app.lectual.app/oauth/consent/");
    await POST(new NextRequest(post({ authorization_id: ID, decision: "yes" })));
    expect(state.approve).not.toHaveBeenCalled();
  });

  it("already consented: redirects only after the same checks, without approving again", async () => {
    state.getDetails.mockResolvedValue({ data: { redirect_url: `${CLAUDE}?code=old` }, error: null });
    expect(await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }))))).toBe(`${CLAUDE}?code=old`);
    state.moduleOn = false;
    expect(await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }))))).toBe(`https://app.lectual.app/oauth/consent/?authorization_id=${ID}`);
    expect(state.approve).not.toHaveBeenCalled();
  });

  it("an approval answer pointing anywhere but Claude is not followed", async () => {
    state.approve.mockResolvedValue({ data: { redirect_url: "https://evil.example/cb?code=c" }, error: null });
    expect(await location(await POST(new NextRequest(post({ authorization_id: ID, decision: "allow" }))))).toBe(`https://app.lectual.app/oauth/consent/?authorization_id=${ID}&failed=1`);
  });
});

describe("runDecision", () => {
  it("a throwing evaluate or approve approves nothing visible and goes back to the page", async () => {
    const deps = { evaluate: async () => { throw new Error("x"); }, approve: vi.fn(), deny: vi.fn(), allowedRedirects: [CLAUDE] };
    expect(await runDecision({ origin: "https://h", host: "h", authorizationId: ID, decision: "allow" }, deps)).toBe(`/oauth/consent/?authorization_id=${ID}`);
    expect(deps.approve).not.toHaveBeenCalled();
    const deps2 = {
      evaluate: async () => ({ kind: "ask" as const, authorizationId: ID, firmName: "F", you: "Y" }),
      approve: async () => { throw new Error("x"); },
      deny: vi.fn(),
      allowedRedirects: [CLAUDE],
    };
    expect(await runDecision({ origin: "https://h", host: "h", authorizationId: ID, decision: "allow" }, deps2)).toBe(`/oauth/consent/?authorization_id=${ID}&failed=1`);
  });
});
