import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seam (src/lib/mcp/request-client.ts): outside the connector route getScopedClient() builds the
 * cookie client exactly as before; inside runWithMcpClient it answers with the token client, whose
 * no-argument auth.getUser() verifies the token. No network: supabase-js and @supabase/ssr are mocked.
 */
const ssr = vi.hoisted(() => ({ createServerClient: vi.fn(), cookieStore: { getAll: vi.fn(() => [{ name: "sb", value: "v" }]), set: vi.fn() } }));
vi.mock("@supabase/ssr", () => ({ createServerClient: ssr.createServerClient }));
vi.mock("next/headers", () => ({ cookies: async () => ssr.cookieStore }));

import { getScopedClient } from "@/lib/db/scoped-client";
import { currentMcpClient, runWithMcpClient } from "@/lib/mcp/request-client";
import { activeOrgIdOf, bearerToken, verifyBearer, withTokenGetUser } from "@/lib/mcp/token-client";

const ORG = "11111111-1111-4111-8111-111111111111";
function jwt(payload: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(payload)}.signaturesignature`;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  ssr.createServerClient.mockReset().mockReturnValue({ kind: "cookie-client" });
});

describe("getScopedClient outside the connector route", () => {
  it("the store is empty and the cookie client is built with the same arguments as before", async () => {
    expect(currentMcpClient()).toBeUndefined();
    const client = await getScopedClient();
    expect(client).toEqual({ kind: "cookie-client" });
    expect(ssr.createServerClient).toHaveBeenCalledTimes(1);
    const [url, key, opts] = ssr.createServerClient.mock.calls[0];
    expect(url).toBe("https://abcdefgh.supabase.co");
    expect(key).toBe("anon");
    expect(Object.keys(opts)).toEqual(["cookies"]);
    expect(opts.cookies.getAll()).toEqual([{ name: "sb", value: "v" }]);
    opts.cookies.setAll([{ name: "a", value: "b", options: {} }]);
    expect(ssr.cookieStore.set).toHaveBeenCalledWith("a", "b", {});
  });

  it("the store is empty again after a run ends", async () => {
    const fake = { kind: "token-client" } as never;
    await runWithMcpClient(fake, async () => undefined);
    expect(currentMcpClient()).toBeUndefined();
    await getScopedClient();
    expect(ssr.createServerClient).toHaveBeenCalledTimes(1);
  });
});

describe("getScopedClient inside runWithMcpClient", () => {
  it("answers with the token client, across awaits, and never builds a cookie client", async () => {
    const fake = { kind: "token-client" } as never;
    const seen = await runWithMcpClient(fake, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getScopedClient();
    });
    expect(seen).toBe(fake);
    expect(ssr.createServerClient).not.toHaveBeenCalled();
  });

  it("two runs at once each see their own client", async () => {
    const a = { kind: "a" } as never;
    const b = { kind: "b" } as never;
    const [ra, rb] = await Promise.all([
      runWithMcpClient(a, async () => { await new Promise((r) => setTimeout(r, 5)); return getScopedClient(); }),
      runWithMcpClient(b, async () => getScopedClient()),
    ]);
    expect(ra).toBe(a);
    expect(rb).toBe(b);
  });
});

describe("the token client", () => {
  it("auth.getUser() with no argument verifies the token; an explicit one still wins", async () => {
    const getUser = vi.fn(async (t?: string) => ({ data: { user: { id: t } }, error: null }));
    const client = withTokenGetUser({ auth: { getUser } } as never, "TOKEN") as unknown as { auth: { getUser: (t?: string) => Promise<unknown> } };
    await client.auth.getUser();
    expect(getUser).toHaveBeenLastCalledWith("TOKEN");
    await client.auth.getUser("OTHER");
    expect(getUser).toHaveBeenLastCalledWith("OTHER");
  });

  it("reads only a Bearer header with a token-shaped value", () => {
    expect(bearerToken("Bearer abcdefghijklmnopqrstuvwxyz.a.b")).toBe("abcdefghijklmnopqrstuvwxyz.a.b");
    expect(bearerToken("Basic abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(bearerToken("Bearer short")).toBeNull();
    expect(bearerToken("Bearer has space inside the token value")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("reads active_org_id only as a uuid", () => {
    expect(activeOrgIdOf(jwt({ active_org_id: ORG }))).toBe(ORG);
    expect(activeOrgIdOf(jwt({ active_org_id: "not-a-uuid" }))).toBeNull();
    expect(activeOrgIdOf(jwt({}))).toBeNull();
    expect(activeOrgIdOf("garbage")).toBeNull();
  });

  it("verifyBearer asks Supabase FIRST and decodes the claim only after it accepted the token", async () => {
    const token = jwt({ active_org_id: ORG, sub: "u1" });
    const accept = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
    const caller = await verifyBearer(`Bearer ${token}`, () => ({ auth: { getUser: accept } }) as never);
    expect(accept).toHaveBeenCalledWith(token);
    expect(caller?.userId).toBe("u1");
    expect(caller?.orgId).toBe(ORG);

    const reject = vi.fn(async () => ({ data: { user: null }, error: { message: "bad jwt" } }));
    expect(await verifyBearer(`Bearer ${token}`, () => ({ auth: { getUser: reject } }) as never)).toBeNull();

    const throws = vi.fn(async () => { throw new Error("network"); });
    expect(await verifyBearer(`Bearer ${token}`, () => ({ auth: { getUser: throws } }) as never)).toBeNull();

    const noOrg = jwt({ sub: "u1" });
    expect(await verifyBearer(`Bearer ${noOrg}`, () => ({ auth: { getUser: accept } }) as never)).toBeNull();

    const never = vi.fn();
    expect(await verifyBearer(undefined, never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});
