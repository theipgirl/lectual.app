import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The per-firm Lawmatics connection (lectual 0059). The properties that
 * matter: the token is read back only by the row the caller's own RLS read
 * returned (id AND org_id), a firm with no connection gets no client, and a
 * pasted token is checked before anything is stored.
 */

const root = randomBytes(32);
const state = vi.hoisted(() => ({
  scopedRow: null as null | { id: string; org_id: string; status: string },
  adminFilters: [] as Array<[string, unknown]>,
  sealed: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => root }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: state.scopedRow, error: null }) }),
    }),
  }),
}));
vi.mock("@/lib/db/admin", () => ({
  getAdminClient: () => {
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        state.adminFilters.push([c, v]);
        return q;
      },
      maybeSingle: async () => ({ data: { token_enc: state.sealed }, error: null }),
    };
    return { from: () => q };
  },
}));

const { sealToken } = await import("@/lib/mailbox/crypto");
const { checkTokenShape, firmLawmaticsClient, tokenHint, verifyLawmaticsToken, LawmaticsNotConnectedError } = await import(
  "@/lib/lawmatics/connection"
);

const TOKEN = "lm_live_abcdefghijklmnopqrstuvwxyz0123";

beforeEach(() => {
  state.scopedRow = null;
  state.adminFilters = [];
  state.sealed = sealToken(root, TOKEN);
});

describe("checkTokenShape / tokenHint", () => {
  it("trims, and rejects empty, spaced or implausible tokens before any request", () => {
    expect(checkTokenShape(`  ${TOKEN}\n`)).toEqual({ ok: true, token: TOKEN });
    expect(checkTokenShape("").ok).toBe(false);
    expect(checkTokenShape("abc def ghi jkl mno pqr stu").ok).toBe(false);
    expect(checkTokenShape("short").ok).toBe(false);
  });
  it("shows only the last four characters", () => {
    expect(tokenHint(TOKEN)).toBe("…0123");
  });
});

describe("verifyLawmaticsToken", () => {
  const respond = (status: number) =>
    vi.fn(async () => ({ ok: status < 400, status, statusText: "", text: async () => "{}", json: async () => ({ data: [] }) }));

  it("accepts a token Lawmatics answers with 200, using one read-only GET", async () => {
    const fetchImpl = respond(200);
    expect(await verifyLawmaticsToken(TOKEN, { fetchImpl })).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method?: string; headers?: Record<string, string> }];
    expect(url).toContain("/prospects");
    expect(init?.method ?? "GET").toBe("GET");
  });
  it("says the token was refused on 401/403, and says Lawmatics was unreachable otherwise", async () => {
    expect(await verifyLawmaticsToken(TOKEN, { fetchImpl: respond(401) })).toMatchObject({ ok: false, reason: expect.stringMatching(/didn't accept/) });
    expect(await verifyLawmaticsToken(TOKEN, { fetchImpl: respond(503) })).toMatchObject({ ok: false, reason: expect.stringMatching(/couldn't reach/) });
  });
});

describe("firmLawmaticsClient", () => {
  it("refuses a firm with no connection, or a rejected one", async () => {
    await expect(firmLawmaticsClient()).rejects.toBeInstanceOf(LawmaticsNotConnectedError);
    state.scopedRow = { id: "c1", org_id: "org-a", status: "invalid" };
    await expect(firmLawmaticsClient()).rejects.toBeInstanceOf(LawmaticsNotConnectedError);
    expect(state.adminFilters).toHaveLength(0);
  });

  it("reads the token by the RLS-visible row's id AND org_id, and sends it as the bearer", async () => {
    state.scopedRow = { id: "c1", org_id: "org-a", status: "active" };
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, statusText: "", text: async () => "{}", json: async () => ({ data: [] }) }));
    const client = await firmLawmaticsClient(fetchImpl);
    expect(state.adminFilters).toEqual([
      ["id", "c1"],
      ["org_id", "org-a"],
    ]);
    await client.get("/prospects");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(JSON.stringify(init.headers)).toContain(TOKEN);
  });
});
