import { describe, it, expect, vi, beforeEach } from "vitest";

/** Who may connect Lawmatics, and where the org it's saved under comes from. */

const state = vi.hoisted(() => ({
  role: "owner" as string,
  root: Buffer.alloc(32, 1) as Buffer | null,
  verified: true,
  saves: [] as Array<{ orgId: string; userId: string; token: string }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({ rpc: async () => ({ data: state.role, error: null }) }),
}));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => state.root }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => ({ kind: "ok", org: { id: "org-from-session" }, user: { id: "user-from-session" } }),
}));
vi.mock("@/lib/lawmatics/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lawmatics/connection")>("@/lib/lawmatics/connection");
  return {
    ...actual,
    verifyLawmaticsToken: async () => (state.verified ? { ok: true } : { ok: false, reason: "Lawmatics didn't accept that token." }),
    saveLawmaticsToken: async (args: { orgId: string; userId: string; token: string }) => {
      state.saves.push({ orgId: args.orgId, userId: args.userId, token: args.token });
      return { ok: true };
    },
  };
});
vi.mock("server-only", () => ({}));

const { connectLawmaticsAction } = await import("@/app/dashboard/settings/integrations/lawmatics/actions");

const TOKEN = "lm_live_abcdefghijklmnopqrstuvwxyz0123";
function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.role = "owner";
  state.root = Buffer.alloc(32, 1);
  state.verified = true;
  state.saves = [];
});

describe("connectLawmaticsAction", () => {
  it.each(["intake", "paralegal", "attorney", "viewer"])("refuses %s", async (role) => {
    state.role = role;
    const res = await connectLawmaticsAction({}, form({ token: TOKEN }));
    expect(res.error).toMatch(/owners and admins/i);
    expect(state.saves).toHaveLength(0);
  });

  it("saves under the SESSION's org and user, whatever the form says", async () => {
    const res = await connectLawmaticsAction({}, form({ token: `  ${TOKEN} `, org_id: "someone-elses-org", orgId: "x" }));
    expect(res).toEqual({ ok: true });
    expect(state.saves).toEqual([{ orgId: "org-from-session", userId: "user-from-session", token: TOKEN }]);
  });

  it("stores nothing when Lawmatics refuses the token", async () => {
    state.verified = false;
    const res = await connectLawmaticsAction({}, form({ token: TOKEN }));
    expect(res.error).toMatch(/didn't accept/);
    expect(state.saves).toHaveLength(0);
  });

  it("stores nothing without an encryption key", async () => {
    state.root = null;
    const res = await connectLawmaticsAction({}, form({ token: TOKEN }));
    expect(res.error).toMatch(/encryption key/);
    expect(state.saves).toHaveLength(0);
  });
});
