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
