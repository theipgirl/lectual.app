import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ role: "owner" as string, runs: [] as unknown[], result: { connections: 1, created: 2, linked: 1, skipped: 3, failedFirms: 0, failedWrites: 0 } }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ rpc: async () => ({ data: state.role, error: null }) }) }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", org: { id: "org-from-session" }, user: { id: "u" } }) }));
vi.mock("@/lib/lawmatics/hired-sync", () => ({
  runHiredSync: async (a: unknown) => (state.runs.push(a), state.result),
}));

const { syncHiredMattersAction } = await import("@/app/dashboard/settings/integrations/lawmatics/actions");

function form(e: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(e)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.role = "owner";
  state.runs = [];
  state.result = { connections: 1, created: 2, linked: 1, skipped: 3, failedFirms: 0, failedWrites: 0 };
});

describe("syncHiredMattersAction", () => {
  it.each(["intake", "paralegal", "attorney", "viewer", "social_media"])("refuses %s without running", async (role) => {
    state.role = role;
    const r = await syncHiredMattersAction({}, form());
    expect(r.error).toBeTruthy();
    expect(state.runs).toHaveLength(0);
  });

  it("runs for the SESSION's org only, ignoring the form", async () => {
    const r = await syncHiredMattersAction({}, form({ orgId: "other", org_id: "other" }));
    expect(state.runs).toEqual([{ orgId: "org-from-session" }]);
    expect(r).toEqual({ ok: true, notice: "Added 2 matters, linked 1, 3 need a look." });
  });

  it("a failed read is a fixed sentence, never a success", async () => {
    state.result = { ...state.result, failedFirms: 1, created: 0 };
    const r = await syncHiredMattersAction({}, form());
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/nothing was added/i);
  });
});
