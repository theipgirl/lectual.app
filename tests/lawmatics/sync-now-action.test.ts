import { describe, it, expect, vi, beforeEach } from "vitest";
import { emptySummary, type DailySyncSummary } from "@/lib/lawmatics/daily-sync";

const state = vi.hoisted(() => ({
  role: "owner" as string | null,
  roleError: false,
  session: "ok" as "ok" | "signed-out",
  runs: [] as unknown[],
  result: null as unknown,
  throws: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({ rpc: async () => (state.roleError ? { data: null, error: { code: "x" } } : { data: state.role, error: null }) }),
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => (state.session === "ok" ? { kind: "ok", org: { id: "org-from-session" }, user: { id: "u" } } : { kind: "signed-out" }),
}));
vi.mock("@/lib/lawmatics/daily-sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/lawmatics/daily-sync")>()),
  runLawmaticsDailySync: async (a: unknown) => {
    state.runs.push(a);
    if (state.throws) throw new Error("connection read failed");
    return state.result;
  },
}));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));

const { syncLawmaticsAction } = await import("@/app/dashboard/settings/integrations/lawmatics/actions");

function summary(over: (s: DailySyncSummary) => void = () => {}): DailySyncSummary {
  const s = emptySummary("full");
  s.connections = 1;
  s.hired.ran = 1;
  s.prospects.ran = 1;
  s.consults.ran = 1;
  s.prospects.created = 3;
  s.prospects.linked = 1;
  s.prospects.cameBack = 1;
  s.prospects.needALook = 2;
  s.consults.written = 4;
  s.consults.removed = 1;
  over(s);
  return s;
}

beforeEach(() => {
  state.role = "owner";
  state.roleError = false;
  state.session = "ok";
  state.runs = [];
  state.result = summary();
  state.throws = false;
});

describe("Sync from Lawmatics now (35, 36)", () => {
  it.each(["owner", "admin", "senior_admin"])("%s runs it for the SESSION's own firm only, ignoring the form", async (role) => {
    state.role = role;
    const fd = new FormData();
    fd.set("orgId", "other-firm");
    fd.set("org_id", "other-firm");
    const r = await syncLawmaticsAction({}, fd);
    expect(state.runs).toEqual([{ orgId: "org-from-session", mode: "full", budgetMs: 240_000 }]);
    expect(r).toEqual({ ok: true, notice: "Added 3 leads, linked 1, 1 came back, 2 need a look. 4 consults updated, 1 removed. Added 0 matters, linked 0." });
  });

  it.each(["intake", "paralegal", "attorney", "law_clerk", "clerk", "viewer", "social_media", "nonsense", null])("%s gets a fixed sentence and the runner is never called", async (role) => {
    state.role = role;
    const r = await syncLawmaticsAction({}, new FormData());
    expect(r.error).toMatch(/can sync from Lawmatics/);
    expect(state.runs).toHaveLength(0);
  });

  it("an unreadable role and a signed-out caller: a fixed sentence, no run", async () => {
    state.roleError = true;
    expect((await syncLawmaticsAction({}, new FormData())).error).toMatch(/can sync from Lawmatics/);
    state.roleError = false;
    state.session = "signed-out";
    expect((await syncLawmaticsAction({}, new FormData())).error).toBe("Sign in again to sync from Lawmatics.");
    expect(state.runs).toHaveLength(0);
  });

  it("a refused key, out of time, a failed step, no connection and a throw each have their own sentence", async () => {
    state.result = summary((s) => void (s.reauthNeeded = 1));
    expect((await syncLawmaticsAction({}, new FormData())).error).toBe("Lawmatics no longer accepts your firm's key. Reconnect it above.");
    state.result = summary((s) => void (s.outOfTime = 1));
    expect((await syncLawmaticsAction({}, new FormData())).error).toBe("Lawmatics took too long. Try again shortly.");
    state.result = summary((s) => void (s.consults.failed = 1));
    const failed = await syncLawmaticsAction({}, new FormData());
    expect(failed.error).toBe("We couldn't read Lawmatics for consults, so nothing was changed there. Try again shortly.");
    expect(failed.notice).toMatch(/^Added 3 leads/);
    state.result = summary((s) => void ((s.tokenUnreadable = 1), (s.failedFirms = 1)));
    const key = await syncLawmaticsAction({}, new FormData());
    expect(key.ok).toBeUndefined();
    expect(key.error).toBe("We couldn't open your firm's Lawmatics key, so nothing was synced. Reconnect it above, or try again shortly.");
    state.result = summary((s) => void (s.connections = 0));
    expect((await syncLawmaticsAction({}, new FormData())).error).toBe("Lawmatics isn't connected for your firm.");
    state.throws = true;
    expect((await syncLawmaticsAction({}, new FormData())).error).toBe("We couldn't sync from Lawmatics just now. Try again shortly.");
  });

  it("the result line is counts only, and says when more wait for the next run", async () => {
    state.result = summary((s) => void (s.prospects.overCap = 7));
    const r = await syncLawmaticsAction({}, new FormData());
    expect(r.notice).toContain("7 more wait for the next run.");
    expect(r.notice).not.toMatch(/@|https?:/);
  });
});
