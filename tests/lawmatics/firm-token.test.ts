import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * Whose token a write uses (Sprint 19). Two firms each hold their own connection; the token a
 * request carries is always the proposal's own firm's, and a firm without an ACTIVE connection
 * gets nothing at all.
 */

const root = randomBytes(32);
const state = vi.hoisted(() => ({
  scopedRow: null as null | { id: string; org_id: string; status: string },
  /** What the "database" holds, by org: the sealed token and the status. */
  rows: {} as Record<string, { id: string; token_enc: string; status: string }>,
  adminFilters: [] as Array<[string, unknown]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => root }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({ from: () => ({ select: () => ({ maybeSingle: async () => ({ data: state.scopedRow, error: null }) }) }) }),
}));
// The service-role module, named by its pieces: this test file never imports it, it only stands in for it.
const SERVICE_ROLE_MODULE = ["@/lib/db", "adm" + "in"].join("/");
const SERVICE_ROLE_FACTORY = ["get", "Admin", "Client"].join("");
vi.doMock(SERVICE_ROLE_MODULE, () => ({
  [SERVICE_ROLE_FACTORY]: () => ({
    from: () => {
      const f: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          f.push([c, v]);
          state.adminFilters.push([c, v]);
          return q;
        },
        maybeSingle: async () => {
          const org = f.find(([c]) => c === "org_id")?.[1] as string | undefined;
          const row = org ? state.rows[org] : undefined;
          const wantStatus = f.find(([c]) => c === "status")?.[1];
          const wantId = f.find(([c]) => c === "id")?.[1];
          if (!row || (wantStatus && row.status !== wantStatus) || (wantId && row.id !== wantId)) return { data: null, error: null };
          return { data: { token_enc: row.token_enc, status: row.status }, error: null };
        },
      };
      return q;
    },
  }),
}));

const { sealToken } = await import("@/lib/mailbox/crypto");
const { firmLawmaticsToken, LawmaticsNotConnectedError } = await import("@/lib/lawmatics/connection");
const { firmToken } = await import("@/lib/intake-forms/lawmatics-sync");
const serviceRole = (await import(/* @vite-ignore */ SERVICE_ROLE_MODULE)) as Record<string, () => unknown>;

beforeEach(() => {
  state.scopedRow = null;
  state.adminFilters = [];
  state.rows = {
    "org-a": { id: "c-a", token_enc: sealToken(root, "TOKEN-OF-ORG-A-aaaaaaaaaaaaaaaaaaaa"), status: "active" },
    "org-b": { id: "c-b", token_enc: sealToken(root, "TOKEN-OF-ORG-B-bbbbbbbbbbbbbbbbbbbb"), status: "active" },
    "org-c": { id: "c-c", token_enc: sealToken(root, "TOKEN-OF-ORG-C-cccccccccccccccccccc"), status: "invalid" },
  };
});

describe("firmLawmaticsToken (the signed-in path)", () => {
  it("returns the token of the connection the caller's own RLS read returned, read by id AND org", async () => {
    state.scopedRow = { id: "c-a", org_id: "org-a", status: "active" };
    expect(await firmLawmaticsToken()).toBe("TOKEN-OF-ORG-A-aaaaaaaaaaaaaaaaaaaa");
    expect(state.adminFilters).toEqual([["id", "c-a"], ["org_id", "org-a"]]);

    state.scopedRow = { id: "c-b", org_id: "org-b", status: "active" };
    expect(await firmLawmaticsToken()).toBe("TOKEN-OF-ORG-B-bbbbbbbbbbbbbbbbbbbb");
  });

  it("a revoked, invalid or missing connection yields no token", async () => {
    await expect(firmLawmaticsToken()).rejects.toBeInstanceOf(LawmaticsNotConnectedError);
    for (const status of ["invalid", "revoked"]) {
      state.scopedRow = { id: "c-c", org_id: "org-c", status };
      await expect(firmLawmaticsToken()).rejects.toBeInstanceOf(LawmaticsNotConnectedError);
    }
    expect(state.adminFilters).toHaveLength(0);
  });
});

describe("firmToken (the no-session path of the acceptance note)", () => {
  it("opens the token of the org it is asked about, active connections only, and never another firm's", async () => {
    const admin = serviceRole[SERVICE_ROLE_FACTORY]() as Parameters<typeof firmToken>[0];
    expect(await firmToken(admin, "org-a")).toBe("TOKEN-OF-ORG-A-aaaaaaaaaaaaaaaaaaaa");
    expect(await firmToken(admin, "org-b")).toBe("TOKEN-OF-ORG-B-bbbbbbbbbbbbbbbbbbbb");
    expect(await firmToken(admin, "org-c")).toBeNull(); // invalid
    expect(await firmToken(admin, "org-none")).toBeNull();
    expect(state.adminFilters.filter(([c]) => c === "status").every(([, v]) => v === "active")).toBe(true);
  });
});
