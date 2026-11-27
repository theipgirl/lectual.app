import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ROW_CHECK_FAILED, OWNER_ROW_NEEDS_OWNER } from "@/lib/ui/words";

/**
 * Touching an owner row needs the caller's OWN owner membership row (mirrors the lectual 0116 proposal). A Lectual staff member acting
 * inside a firm has an owner role claim but no crm_org_member row: removing an owner is refused BEFORE revoke_member_sessions runs, so the
 * owner is never signed out of every session ahead of a delete the database would refuse. Invented ids only.
 */

const CALLER = "00000000-0000-4000-8000-0000000000c1";
const OWNER_A = "00000000-0000-4000-8000-0000000000a1";
const OWNER_B = "00000000-0000-4000-8000-0000000000a2";
const PARA = "00000000-0000-4000-8000-0000000000a3";

const h = vi.hoisted(() => ({
  claim: "owner" as string,
  members: new Map<string, string>(),
  failCallerRead: false,
  rpcs: [] as string[],
  deletes: [] as string[],
  updates: [] as [string, string][],
}));

function fake() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: CALLER } }, error: null }) },
    rpc: async (name: string) => {
      h.rpcs.push(name);
      if (name === "current_org_role") return { data: h.claim, error: null };
      return { data: 1, error: null };
    },
    from: (table: string) => {
      if (table !== "crm_org_member") throw new Error(`unexpected table ${table}`);
      return {
        select: (_cols: string, opts?: { head?: boolean }) => {
          const eqs: [string, unknown][] = [];
          const q = {
            eq: (c: string, v: unknown) => (eqs.push([c, v]), q),
            maybeSingle: async () => one(eqs),
            single: async () => one(eqs),
            then: (resolve: (v: unknown) => unknown) =>
              resolve(opts?.head ? { count: [...h.members.values()].filter((r) => r === (eqs.find(([c]) => c === "role")?.[1] ?? r)).length, error: null } : { data: [], error: null }),
          };
          return q;
        },
        delete: () => ({ eq: async (_c: string, v: string) => (h.deletes.push(v), h.members.delete(v), { error: null }) }),
        update: (patch: { role: string }) => ({
          eq: (_c: string, v: string) => ({ select: () => ({ single: async () => (h.updates.push([v, patch.role]), { data: { user_id: v, role: patch.role }, error: null }) }) }),
        }),
      };
    },
  };
}
function one(eqs: [string, unknown][]) {
  const id = eqs.find(([c]) => c === "user_id")?.[1] as string;
  if (id === CALLER && h.failCallerRead) return { data: null, error: { code: "57014", message: "timeout" } };
  const role = h.members.get(id);
  return { data: role ? { role } : null, error: null };
}

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => fake() }));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example.test" }));

beforeEach(() => {
  h.claim = "owner";
  h.members = new Map([[OWNER_A, "owner"], [OWNER_B, "owner"], [PARA, "paralegal"]]);
  h.failCallerRead = false;
  h.rpcs = [];
  h.deletes = [];
  h.updates = [];
});

describe("removeMember: an owner row needs an owner membership row", () => {
  it("a platform admin (owner claim, no membership row) removing an owner is refused; revoke_member_sessions is never called", async () => {
    const { removeMember } = await import("@/lib/settings/members");
    await expect(removeMember(OWNER_A)).rejects.toThrow(OWNER_ROW_NEEDS_OWNER);
    expect(h.rpcs).not.toContain("revoke_member_sessions");
    expect(h.deletes).toEqual([]);
  });

  it("a real owner can still remove a second owner (sessions revoked, then the delete)", async () => {
    h.members.set(CALLER, "owner");
    const { removeMember } = await import("@/lib/settings/members");
    expect(await removeMember(OWNER_B)).toEqual({ userId: OWNER_B });
    expect(h.rpcs).toContain("revoke_member_sessions");
    expect(h.deletes).toEqual([OWNER_B]);
  });

  it("a failed read of the caller's own row is a refusal; nobody is signed out", async () => {
    h.members.set(CALLER, "owner");
    h.failCallerRead = true;
    const { removeMember } = await import("@/lib/settings/members");
    await expect(removeMember(OWNER_A)).rejects.toThrow(OWNER_ROW_CHECK_FAILED);
    expect(h.rpcs).not.toContain("revoke_member_sessions");
    expect(h.deletes).toEqual([]);
  });

  it("removing a non-owner is unchanged: no own-row check is needed", async () => {
    h.claim = "admin";
    h.failCallerRead = true; // would refuse if it were asked
    const { removeMember } = await import("@/lib/settings/members");
    expect(await removeMember(PARA)).toEqual({ userId: PARA });
    expect(h.rpcs).toContain("revoke_member_sessions");
  });
});

describe("setMemberRole: the same rule when the target is an owner or would become one", () => {
  it("a platform admin demoting an owner is refused, nothing written", async () => {
    const { setMemberRole } = await import("@/lib/settings/admin");
    await expect(setMemberRole(OWNER_A, "admin")).rejects.toThrow(OWNER_ROW_NEEDS_OWNER);
    expect(h.updates).toEqual([]);
  });

  it("a platform admin making a paralegal owner is refused", async () => {
    const { setMemberRole } = await import("@/lib/settings/admin");
    await expect(setMemberRole(PARA, "owner")).rejects.toThrow(OWNER_ROW_NEEDS_OWNER);
    expect(h.updates).toEqual([]);
  });

  it("a real owner can demote a second owner", async () => {
    h.members.set(CALLER, "owner");
    const { setMemberRole } = await import("@/lib/settings/admin");
    await setMemberRole(OWNER_B, "admin");
    expect(h.updates).toEqual([[OWNER_B, "admin"]]);
  });

  it("a failed read of the caller's own row is a refusal", async () => {
    h.members.set(CALLER, "owner");
    h.failCallerRead = true;
    const { setMemberRole } = await import("@/lib/settings/admin");
    await expect(setMemberRole(OWNER_A, "admin")).rejects.toThrow(OWNER_ROW_CHECK_FAILED);
    expect(h.updates).toEqual([]);
  });

  it("an admin re-roling a paralegal is unaffected (no own-row read)", async () => {
    h.claim = "admin";
    h.failCallerRead = true; // would refuse if it were asked
    const { setMemberRole } = await import("@/lib/settings/admin");
    await setMemberRole(PARA, "clerk");
    expect(h.updates).toEqual([[PARA, "clerk"]]);
  });
});
