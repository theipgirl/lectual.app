import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/roles";
import { canSeeBilling } from "@/lib/billing/can-see";

describe("canSeeBilling", () => {
  it("is true for the owner and no other role", () => {
    for (const role of ROLES) expect(canSeeBilling(role), role).toBe(role === "owner");
  });
  it("fails closed on unknown, empty and unreadable roles", () => {
    for (const v of ["Owner", "OWNER", "", "superuser", null, undefined, 1, {}]) expect(canSeeBilling(v)).toBe(false);
  });
});
