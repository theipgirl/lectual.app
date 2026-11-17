import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Each cron route: a tick outside its New York hour answers 200 { skipped } and touches nothing; a tick inside works. */
const admin = vi.fn(() => ({}));
const runHiredSync = vi.fn(async () => ({ connections: 0, created: 0, linked: 0, skipped: 0, failedFirms: 0, leadsMoved: 0, leadMovesFailed: 0 }));
const runMeetingImports = vi.fn(async () => ({ connections: 0, ok: 0, failed: 0, inserted: 0 }));
const runMailboxSync = vi.fn(async () => ({ orgs: 0, connections: 0, ok: 0, failed: 0, outcomes: [] }));
const runAfterSync = vi.fn(async () => undefined);
const runAllAgents = vi.fn(async () => []);
const deps = vi.fn(() => ({}));
const rootKey = vi.fn(() => "root");

vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s3cret" } }));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: admin }));
vi.mock("@/lib/lawmatics/hired-sync", () => ({ runHiredSync }));
vi.mock("@/lib/meetings/import", () => ({ runMeetingImports }));
vi.mock("@/lib/meetings/config", () => ({ zoomClientCredentials: () => null }));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: rootKey, providerCredentials: {} }));
vi.mock("@/lib/mailbox/sync", () => ({ runMailboxSync }));
vi.mock("@/lib/agents/stage-keeper/after-sync", () => ({ runStageKeeperAfterSync: runAfterSync }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: deps }));
vi.mock("@/lib/agents/runner", () => ({ runAllAgents }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));

const ROUTES = [
  { job: "lawmatics-matters", intended: "2026-07-15T08:08:00Z", work: runHiredSync },
  { job: "meetings-import", intended: "2026-07-15T08:38:00Z", work: runMeetingImports },
  { job: "mailbox-sync", intended: "2026-07-15T08:53:00Z", work: runMailboxSync },
  { job: "agents", intended: "2026-07-15T09:23:00Z", work: runAllAgents },
] as const;

const LOAD: Record<string, () => Promise<{ GET: (r: never) => Promise<Response> }>> = {
  "lawmatics-matters": () => import("@/app/api/cron/lawmatics-matters/route") as never,
  "meetings-import": () => import("@/app/api/cron/meetings-import/route") as never,
  "mailbox-sync": () => import("@/app/api/cron/mailbox-sync/route") as never,
  agents: () => import("@/app/api/cron/agents/route") as never,
};

const call = async (job: string) => {
  const { GET } = await LOAD[job]();
  return GET(new Request(`https://x/api/cron/${job}/`, { headers: { authorization: "Bearer s3cret" } }) as never);
};

describe("cron routes and the New York hour guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  for (const r of ROUTES) {
    it(`${r.job}: a tick in the wrong hour is 200 { skipped } and calls no client factory or worker`, async () => {
      // 2026-07-15 is EDT: the winter entry's hour (one UTC hour later) is the wrong one.
      vi.setSystemTime(new Date(Math.floor(new Date(r.intended).getTime() / 3_600_000) * 3_600_000 + 3_600_000 + 3_599_000));
      const res = await call(r.job);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ skipped: "not this hour" });
      for (const fn of [admin, deps, rootKey, runHiredSync, runMeetingImports, runMailboxSync, runAfterSync, runAllAgents]) expect(fn).not.toHaveBeenCalled();
    });

    it(`${r.job}: a tick in its hour (even at :59) goes on to work`, async () => {
      // the last second of the intended UTC hour (the latest a jittered tick can land)
      vi.setSystemTime(new Date(Math.floor(new Date(r.intended).getTime() / 3_600_000) * 3_600_000 + 3_599_000));
      const res = await call(r.job);
      expect(res.status).toBe(200);
      expect(await res.json()).not.toEqual({ skipped: "not this hour" });
      expect(r.work).toHaveBeenCalled();
    });

    it(`${r.job}: auth still comes first (wrong secret in the wrong hour is 401, not a skip)`, async () => {
      vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
      const { GET } = await LOAD[r.job]();
      const res = await GET(new Request("https://x/", { headers: { authorization: "Bearer nope" } }) as never);
      expect(res.status).toBe(401);
    });
  }
});
