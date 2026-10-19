import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("env", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("a missing required variable throws an EnvVarError naming it (never its value)", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { env, EnvVarError } = await import("@/lib/env");
    let caught: unknown;
    try {
      void env.SUPABASE_SERVICE_ROLE_KEY;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvVarError);
    expect(caught).toMatchObject({ name: "EnvVarError", key: "SUPABASE_SERVICE_ROLE_KEY", reason: "missing" });
  });

  it("an invalid value reports 'invalid' without echoing it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    const { env } = await import("@/lib/env");
    expect(() => env.NEXT_PUBLIC_SUPABASE_URL).toThrow(/NEXT_PUBLIC_SUPABASE_URL is invalid\./);
  });

  it("optional variables stay optional", async () => {
    const { env } = await import("@/lib/env");
    expect(() => env.VERCEL_URL).not.toThrow();
  });
});
