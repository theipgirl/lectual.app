import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const getScopedClient = vi.fn();
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: (...a: unknown[]) => getScopedClient(...a) }));
vi.mock("@/lib/db/admin", () => {
  throw new Error("the admin client must never be loaded by the tour action");
});

import { markTourSeenAction, markWelcomeSeenAction } from "@/lib/onboarding/actions";
import { TOUR_VERSION } from "@/lib/onboarding/tour";

function client(opts: { user?: object | null; getUserError?: object; updateError?: object }) {
  const updateUser = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? null : opts.user }, error: opts.getUserError ?? null });
  getScopedClient.mockResolvedValue({ auth: { getUser, updateUser } });
  return { getUser, updateUser };
}

const USER = { id: "u1", user_metadata: { full_name: "Ada", firm_name: "Hartwell", other: { a: 1 } } };

beforeEach(() => {
  getScopedClient.mockReset();
});

describe("markTourSeenAction", () => {
  it.each(["finished", "skipped"] as const)("writes %s on the caller's own account and keeps other keys", async (outcome) => {
    const { getUser, updateUser } = client({ user: USER });
    const result = await markTourSeenAction(outcome);
    expect(result).toEqual({ ok: true });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledTimes(1);
    const data = updateUser.mock.calls[0][0].data;
    expect(data.full_name).toBe("Ada");
    expect(data.firm_name).toBe("Hartwell");
    expect(data.other).toEqual({ a: 1 });
    expect(data.lectual_tour.version).toBe(TOUR_VERSION);
    expect(data.lectual_tour.outcome).toBe(outcome);
    expect(new Date(data.lectual_tour.seen_at).toISOString()).toBe(data.lectual_tour.seen_at);
  });

  it("refuses a signed-out caller without writing", async () => {
    const { updateUser } = client({ user: null });
    const result = await markTourSeenAction("finished");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not signed in/i) });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each(["done", "", undefined, null, {}, ["finished"], 1])("rejects the outcome %j before building a client", async (bad) => {
    const result = await markTourSeenAction(bad);
    expect(result.ok).toBe(false);
    expect(getScopedClient).not.toHaveBeenCalled();
  });

  it("returns a fixed sentence when updateUser or getUser fails", async () => {
    client({ user: USER, updateError: { message: "relation auth.users secret" } });
    const a = await markTourSeenAction("finished");
    expect(a.ok).toBe(false);
    expect(JSON.stringify(a)).not.toContain("secret");

    client({ user: USER, getUserError: { message: "jwt secret" } });
    const b = await markTourSeenAction("finished");
    expect(b.ok).toBe(false);
    expect(JSON.stringify(b)).not.toContain("secret");
  });

  it("returns a failure result when the client itself throws", async () => {
    getScopedClient.mockImplementation(() => {
      throw new Error("secret cookie");
    });
    const r = await markTourSeenAction("skipped");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("takes exactly one argument: no user id, no org id", () => {
    expect(markTourSeenAction.length).toBe(1);
  });
});

describe("source gates", () => {
  const files = ["src/lib/onboarding/actions.ts", "src/lib/onboarding/tour.ts", "src/lib/onboarding/engine.ts", "src/components/onboarding/OnboardingTour.tsx"];
  it.each(files)("%s has no admin client, service role or logging", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/db\/admin|getAdminClient|service_role|SUPABASE_SERVICE|dangerouslySetInnerHTML|console\./);
  });
  it("the action reads no role or module from metadata", () => {
    const src = readFileSync("src/lib/onboarding/actions.ts", "utf8");
    expect(src).not.toMatch(/role|modules/i);
  });
});

describe("markWelcomeSeenAction", () => {
  const TOURED = { id: "u1", user_metadata: { full_name: "Ada", lectual_tour: { version: 1, seen_at: "2026-01-01T00:00:00.000Z", outcome: "finished" } } };
  it.each(["finished", "skipped"] as const)("writes lectual_welcome (%s), leaves lectual_tour and other keys as they were", async (outcome) => {
    const { updateUser } = client({ user: TOURED });
    expect(await markWelcomeSeenAction(outcome)).toEqual({ ok: true });
    const data = updateUser.mock.calls[0][0].data;
    expect(data.lectual_tour).toEqual(TOURED.user_metadata.lectual_tour);
    expect(data.full_name).toBe("Ada");
    expect(data.lectual_welcome.version).toBe(1);
    expect(data.lectual_welcome.outcome).toBe(outcome);
  });
  it("refuses signed-out, a bad outcome, and a failed save with fixed sentences", async () => {
    const out = client({ user: null });
    expect(await markWelcomeSeenAction("finished")).toEqual({ ok: false, error: expect.stringMatching(/not signed in/i) });
    expect(out.updateUser).not.toHaveBeenCalled();
    getScopedClient.mockReset();
    expect((await markWelcomeSeenAction("nope")).ok).toBe(false);
    expect(getScopedClient).not.toHaveBeenCalled();
    client({ user: TOURED, updateError: { message: "secret" } });
    expect(JSON.stringify(await markWelcomeSeenAction("finished"))).not.toContain("secret");
  });
});
