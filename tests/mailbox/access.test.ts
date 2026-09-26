import { describe, it, expect } from "vitest";
import { canManageScope, isScope } from "@/lib/mailbox/access";
import { ROLES } from "@/lib/auth/roles";
import { outcomeMessage } from "@/lib/mailbox/outcome";

describe("who may connect which mailbox (mirrors 0070 RLS)", () => {
  it("every role may manage its own personal mailbox", () => {
    for (const role of ROLES) expect(canManageScope(role, "personal")).toBe(true);
  });

  it("only owner, admin and senior_admin may manage firm mailboxes", () => {
    const allowed = ROLES.filter((r) => canManageScope(r, "firm"));
    expect([...allowed].sort()).toEqual(["admin", "owner", "senior_admin"]);
  });

  it("accepts only the two scopes the table allows", () => {
    expect(isScope("personal")).toBe(true);
    expect(isScope("firm")).toBe(true);
    expect(isScope("shared")).toBe(false);
  });
});

describe("callback outcome messages", () => {
  it("never echoes an unknown code from the URL", () => {
    expect(outcomeMessage("<script>alert(1)</script>")).toBeNull();
    expect(outcomeMessage(undefined)).toBeNull();
    expect(outcomeMessage("denied")).toMatch(/cancelled/);
  });
});
