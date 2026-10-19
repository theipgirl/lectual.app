import { describe, it, expect } from "vitest";

import { isSignedInFirmMember, type StaffViewClient } from "@/lib/proposals/staff-view";

function client(opts: { user: { id: string } | null; member?: { role: string; org_id: string } | null; error?: unknown; throws?: boolean }) {
  const reads: Array<[string, string]> = [];
  const c: StaffViewClient = {
    auth: {
      getUser: async () => {
        if (opts.throws) throw new Error("auth down");
        return { data: { user: opts.user } };
      },
    },
    from: () => ({
      select: () => ({
        eq: (c1: string, v1: string) => {
          reads.push([c1, v1]);
          return {
            eq: (c2: string, v2: string) => {
              reads.push([c2, v2]);
              return { maybeSingle: async () => ({ data: opts.member ?? null, error: opts.error ?? null }) };
            },
          };
        },
      }),
    }),
  };
  return { c, reads };
}

describe("isSignedInFirmMember", () => {
  it("is true for a signed-in member of the proposal's firm, asking about that firm only", async () => {
    const { c, reads } = client({ user: { id: "u1" }, member: { role: "paralegal", org_id: "org-1" } });
    expect(await isSignedInFirmMember("org-1", c)).toBe(true);
    expect(reads).toEqual([["user_id", "u1"], ["org_id", "org-1"]]);
  });

  it("is false with no session (the client), and does not look up a membership", async () => {
    const { c, reads } = client({ user: null });
    expect(await isSignedInFirmMember("org-1", c)).toBe(false);
    expect(reads).toEqual([]);
  });

  it("is false for a signed-in user who is not a member of this firm", async () => {
    expect(await isSignedInFirmMember("org-1", client({ user: { id: "u2" }, member: null }).c)).toBe(false);
    expect(await isSignedInFirmMember("org-1", client({ user: { id: "u2" }, member: { role: "owner", org_id: "org-OTHER" } }).c)).toBe(false);
  });

  it("fails toward recording the view: errors answer false", async () => {
    expect(await isSignedInFirmMember("org-1", client({ user: { id: "u1" }, member: { role: "owner", org_id: "org-1" }, error: { code: "XX" } }).c)).toBe(false);
    expect(await isSignedInFirmMember("org-1", client({ user: null, throws: true }).c)).toBe(false);
  });
});
