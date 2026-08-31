import { afterEach, describe, expect, it } from "vitest";
import { ROLES, hasRole, requireRole } from "@/lib/auth/roles";
// Imports "server-only" — reaching it at all proves the vitest alias stub works.
import { optionalEnv, requireEnv } from "@/lib/env";

describe("roles", () => {
  it("orders attorney above the support roles", () => {
    expect(ROLES.indexOf("attorney")).toBeLessThan(ROLES.indexOf("paralegal"));
    expect(hasRole("attorney", "paralegal")).toBe(true);
    expect(hasRole("paralegal", "attorney")).toBe(false);
  });

  it("owner outranks everyone", () => {
    for (const role of ROLES) expect(hasRole("owner", role)).toBe(true);
  });

  it("requireRole throws when under-privileged", () => {
    expect(() => requireRole("viewer", "attorney")).toThrow(/Forbidden/);
    expect(() => requireRole("owner", "attorney")).not.toThrow();
  });
});

describe("env", () => {
  const KEY = "NEXT_PUBLIC_SITE_URL";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns undefined rather than throwing for an optional read", () => {
    expect(optionalEnv(KEY)).toBeUndefined();
  });

  it("names the missing variable in the error", () => {
    // requireEnv caches on success, so assert the failure path on a var this
    // test file controls and never sets to a truthy value elsewhere.
    expect(() => requireEnv(KEY)).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});
