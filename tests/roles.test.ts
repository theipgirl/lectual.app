import { describe, it, expect } from "vitest";
import { hasRole, ROLES, requireRole, type Role } from "@/lib/auth/roles";

describe("roles", () => {
  it("owner satisfies any required role", () => {
    expect(hasRole("owner", "attorney")).toBe(true);
    expect(hasRole("owner", "viewer")).toBe(true);
  });
  it("viewer does not satisfy a higher role", () => {
    expect(hasRole("viewer", "attorney")).toBe(false);
  });
  it("exposes all 10 roles", () => {
    expect(ROLES).toHaveLength(10);
  });
  it("exact role match passes", () => {
    expect(hasRole("intake" as Role, "intake")).toBe(true);
  });
  it("requireRole throws when insufficient", () => {
    expect(() => requireRole("viewer", "owner")).toThrow(/Forbidden/);
    expect(() => requireRole("owner", "viewer")).not.toThrow();
  });

  // Regression: attorney historically sat at index 7 — below intake,
  // paralegal, law_clerk and social_media — making the practising attorney
  // the second-least-privileged person in her own firm. Every consumer had
  // worked around it with explicit role arrays, so the inversion never bit,
  // but it was a live trap for the first `hasRole(x, "attorney")` call site.
  it("attorney outranks the operational staff roles", () => {
    for (const lower of ["intake", "paralegal", "law_clerk", "social_media", "clerk", "viewer"] as const) {
      expect(hasRole("attorney", lower)).toBe(true);
      expect(hasRole(lower, "attorney")).toBe(false);
    }
  });

  it("attorney does NOT reach the senior_admin-gated admin surfaces", () => {
    // Settings/Automation/Import gate on "senior_admin"; the reorder must not
    // quietly widen those. Firm-brain access is granted via minRole
    // "attorney" in the Sidebar, not by lifting attorney into the admin tier.
    expect(hasRole("attorney", "senior_admin")).toBe(false);
  });

  it('minRole "attorney" admits exactly the queue-approval set', async () => {
    // Anything gated on hasRole(r, "attorney") must admit precisely the roles
    // authorized to approve client communications — no more, no fewer.
    const { QUEUE_APPROVE_ROLES } = await import("@/lib/queue/roles");
    const admitted = ROLES.filter((r) => hasRole(r, "attorney"));
    expect([...admitted].sort()).toEqual([...QUEUE_APPROVE_ROLES].sort());
  });

  it("keeps membership identical to the crm_role enum (order-independent)", () => {
    // The Postgres enum is unordered in practice — RLS uses explicit role
    // lists — but membership must match exactly.
    expect([...ROLES].sort()).toEqual(
      [
        "owner",
        "admin",
        "senior_admin",
        "intake",
        "paralegal",
        "law_clerk",
        "social_media",
        "attorney",
        "clerk",
        "viewer",
      ].sort(),
    );
  });
});
