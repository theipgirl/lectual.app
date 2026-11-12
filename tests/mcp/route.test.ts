import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/mcp/ end to end, with no network: the token check is mocked to a verified caller whose client
 * is a fake. Everything after it is real: the seam, resolveFirmSession, orgHasModule, the gate and
 * the `whoami` tool. Cookies throw, which proves nothing on this path reads them.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  caller: null as null | { orgId: string },
  modules: ["claude-connector", "proposals"] as string[],
  member: true,
  logs: [] as string[],
  fromCalls: [] as string[],
}));

function fakeClient() {
  const rowFor = (table: string) =>
    table === "crm_org_member"
      ? state.member ? { role: "attorney", org_id: ORG } : null
      : table === "crm_org"
        ? { id: ORG, name: "Hartwell IP", slug: "hartwell", modules: state.modules }
        : null;
  const builder = (table: string) => {
    const b = { eq: () => b, maybeSingle: async () => ({ data: rowFor(table), error: null }) };
    return b;
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "ada@example.com", user_metadata: { full_name: "Ada Lovelace" } } }, error: null }) },
    from: (table: string) => {
      state.fromCalls.push(table);
      return { select: () => builder(table) };
    },
    rpc: async (name: string) => ({ data: name === "is_platform_admin" ? false : null, error: null }),
  };
}

vi.mock("@/lib/mcp/token-client", () => ({
  verifyBearer: async (header: string | null) =>
    header === "Bearer good" && state.caller ? { client: fakeClient(), userId: "u1", orgId: state.caller.orgId } : null,
}));
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.lectual.app" }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("cookies must not be read on the connector path");
  },
}));

import { POST, GET, maxDuration, runtime } from "@/app/api/mcp/route";
import { MCP_TOOL_REFUSED } from "@/lib/ui/words";

function rpc(method: string, params: Record<string, unknown> = {}, auth = "Bearer good") {
  return new Request("https://app.lectual.app/api/mcp/", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callWhoami(): Promise<{ text: string; isError?: boolean }> {
  const res = await POST(rpc("tools/call", { name: "whoami", arguments: {} }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { text: body.result.content[0].text, isError: body.result.isError };
}

beforeEach(() => {
  state.caller = { orgId: ORG };
  state.modules = ["claude-connector", "proposals"];
  state.member = true;
  state.logs = [];
  state.fromCalls = [];
  vi.spyOn(console, "info").mockImplementation((line: string) => {
    state.logs.push(line);
  });
});

describe("/api/mcp/", () => {
  it("is node, 60 seconds", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(60);
  });

  it("no token or a bad one: 401 with the resource-metadata pointer", async () => {
    for (const res of [await POST(rpc("tools/list", {}, "")), await POST(rpc("tools/list", {}, "Bearer bad")), await GET(new Request("https://app.lectual.app/api/mcp/"))]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://app.lectual.app/.well-known/oauth-protected-resource/api/mcp/"');
    }
    state.caller = null;
    expect((await POST(rpc("tools/list"))).status).toBe(401);
  });

  it("lists whoami only", async () => {
    const res = await POST(rpc("tools/list"));
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);
  });

  it("whoami answers through the seam, beginning with the firm's name", async () => {
    const { text, isError } = await callWhoami();
    expect(isError).toBeUndefined();
    expect(text.startsWith("Hartwell IP: ")).toBe(true);
    expect(text).toContain("Ada Lovelace (Attorney)");
    expect(text).toContain("Client proposals: on.");
    expect(text).toContain("Litigation: off.");
    expect(state.fromCalls).toContain("crm_org");
  });

  it("logs the tool, org, outcome and duration only", async () => {
    await callWhoami();
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0]).toMatch(new RegExp(`^\\[mcp\\] tool=whoami org=${ORG} outcome=ok ms=\\d+$`));
    expect(state.logs[0]).not.toContain("Hartwell");
  });

  it("refuses with one sentence when the firm lacks the connector", async () => {
    state.modules = ["proposals"];
    expect(await callWhoami()).toEqual({ text: MCP_TOOL_REFUSED, isError: true });
    expect(state.logs[0]).toContain("outcome=refused");
  });

  it("refuses when the person has no firm", async () => {
    state.member = false;
    expect(await callWhoami()).toEqual({ text: MCP_TOOL_REFUSED, isError: true });
  });

  it("refuses when the token's firm and the session's firm disagree", async () => {
    state.caller = { orgId: OTHER };
    expect(await callWhoami()).toEqual({ text: MCP_TOOL_REFUSED, isError: true });
  });
});
