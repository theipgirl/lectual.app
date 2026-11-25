import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/intake-forms/lawmatics-sync", () => ({ firmToken: async () => "tok" }));

const { defaultPrepDeps } = await import("@/lib/consult-prep/deps");

/** A fake service-role client: the member table, and `auth.admin.getUserById` that answers `{ data: { user: null }, error }` instead of throwing, as the real one does. */
function admin(members: Array<{ user_id: string; role: string }>, users: Record<string, { data: { user: { email?: string | null } | null }; error: unknown } | "throw">) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = async () => ({ data: members, error: null });
  return {
    from: () => chain,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = users[id];
          if (u === "throw") throw new Error("down");
          return u ?? { data: { user: null }, error: { message: "not found" } };
        },
      },
    },
  };
}
const depsFor = (a: unknown) => defaultPrepDeps({ admin: a as never, orgId: "org-1", signal: undefined as never, fetchImpl: undefined as never });

describe("who gets consult prep: a failed lookup is never 'no one' (F4)", () => {
  const members = [{ user_id: "u1", role: "attorney" }, { user_id: "u2", role: "owner" }];
  const ok = (email: string) => ({ data: { user: { email } }, error: null });

  it("resolves current members' addresses", async () => {
    expect(await depsFor(admin(members, { u1: ok("a@firm.example"), u2: ok("b@firm.example") })).memberAddresses(["u1", "u2"])).toEqual(["a@firm.example", "b@firm.example"]);
  });
  it("a lookup that answers an error (it does not throw) is unavailable: null", async () => {
    const d = depsFor(admin(members, { u1: ok("a@firm.example"), u2: { data: { user: null }, error: { message: "boom" } } }));
    expect(await d.memberAddresses(["u1", "u2"])).toBeNull();
  });
  it("a current member the directory has no user for is unavailable too", async () => {
    expect(await depsFor(admin(members, { u1: ok("a@firm.example"), u2: { data: { user: null }, error: null } })).memberAddresses(["u1", "u2"])).toBeNull();
  });
  it("a lookup that throws is unavailable", async () => {
    expect(await depsFor(admin(members, { u1: "throw", u2: ok("b@firm.example") })).memberAddresses(["u1", "u2"])).toBeNull();
  });
  it("only a setting with no ids is empty, and it asks nobody", async () => {
    expect(await depsFor(admin(members, {})).memberAddresses([])).toEqual([]);
  });
});

describe("who gets consult prep: only current staff members of THIS firm (S2c check)", () => {
  it("a viewer or social media member chosen in the note gets nothing, and the member read names the firm", async () => {
    const seen: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (col: string, v: unknown) => (seen.push([col, v]), chain);
    chain.in = async () => ({ data: [{ user_id: "u1", role: "attorney" }, { user_id: "u3", role: "viewer" }, { user_id: "u4", role: "social_media" }], error: null });
    const a = { from: () => chain, auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@firm.example` } }, error: null }) } } };
    expect(await depsFor(a).memberAddresses(["u1", "u3", "u4"])).toEqual(["u1@firm.example"]);
    expect(seen).toContainEqual(["org_id", "org-1"]);
  });
});

describe("S2c settings: the reply-to and the switch-over instant", () => {
  // The env module caches each value on first read, so each case loads a fresh copy.
  async function fresh(reply: string | undefined, cutover: string | undefined) {
    vi.resetModules();
    if (reply === undefined) delete process.env.CONSULT_PREP_REPLY_TO;
    else process.env.CONSULT_PREP_REPLY_TO = reply;
    if (cutover === undefined) delete process.env.CONSULT_PREP_CUTOVER_AT;
    else process.env.CONSULT_PREP_CUTOVER_AT = cutover;
    try {
      const m = await import("@/lib/consult-prep/deps");
      return m.defaultPrepDeps({ admin: admin([], {}) as never, orgId: "org-1", signal: undefined as never, fetchImpl: undefined as never });
    } finally {
      delete process.env.CONSULT_PREP_REPLY_TO;
      delete process.env.CONSULT_PREP_CUTOVER_AT;
    }
  }
  it("reads a bare reply-to and a zoned cutover instant", async () => {
    const d = await fresh(" Info@RPBLawFirm.com ", "2026-12-01T15:00:00-05:00");
    expect(d.mail.replyTo).toBe("info@rpblawfirm.com");
    expect(d.cutoverAtMs).toBe(Date.parse("2026-12-01T20:00:00Z"));
  });
  it("anything else is ignored: a display name, a list, a date with no zone", async () => {
    for (const [reply, cutover] of [["Info <info@rpblawfirm.com>", "2026-12-01T15:00:00"], ["a@x.com, b@x.com", "2026-12-01"], [undefined, undefined]] as const) {
      const d = await fresh(reply, cutover);
      expect(d.mail.replyTo).toBeNull();
      expect(d.cutoverAtMs).toBeNull();
    }
  });
});
