import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Same ok/unconfigured/unavailable discipline as tests/queue/queue-load.test.ts,
 * applied to the filing-followup feature's own queue read: an unreachable
 * queue must degrade to "don't know what's queued", never to "nothing is
 * queued" — the latter is exactly what would let this feature double-queue a
 * client email for a month that already has a pending or approved draft.
 */

function mockQueue(orgKey: string | null, listQueueImpl: (org: string, status: string) => Promise<unknown[]>) {
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => orgKey) }));
  vi.doMock("@/lib/queue/api", () => ({ listQueue: vi.fn(listQueueImpl) }));
}

async function load() {
  return import("@/lib/matters/filing-followup-queue");
}

describe("loadFollowUpQueueState", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("groups CLIENT_EMAIL monthly-update drafts by matter, across pending AND approved", async () => {
    mockQueue("rpb-law", async (_org, status) =>
      status === "pending"
        ? [
            { type: "CLIENT_EMAIL", matter_id: "m-1", headline: "Monthly Status Update — Month 1 of ~5 — SUNBEAM" },
            { type: "CLIENT_EMAIL", matter_id: "m-2", headline: "Monthly Status Update — Month 1 of ~5 — MOONBEAM" },
          ]
        : [{ type: "CLIENT_EMAIL", matter_id: "m-1", headline: "Monthly Status Update — Month 2 of ~5 — SUNBEAM" }],
    );
    const { loadFollowUpQueueState, queuedMonthsLookupFor } = await load();

    const state = await loadFollowUpQueueState();
    expect(state.status).toBe("ok");
    const lookup = queuedMonthsLookupFor(state);
    expect(lookup?.get("m-1")).toEqual([1, 2]);
    expect(lookup?.get("m-2")).toEqual([1]);
  });

  it("ignores non-CLIENT_EMAIL drafts and drafts with no parseable month", async () => {
    mockQueue("rpb-law", async () => [
      { type: "OPINION_LETTER", matter_id: "m-1", headline: "Opinion letter DRAFT — Jane Doe — SUNBEAM" },
      { type: "CLIENT_EMAIL", matter_id: "m-1", headline: "Some unrelated client email" },
    ]);
    const { loadFollowUpQueueState, queuedMonthsLookupFor } = await load();

    const state = await loadFollowUpQueueState();
    const lookup = queuedMonthsLookupFor(state);
    expect(lookup?.get("m-1")).toBeUndefined();
  });

  it("reports 'unconfigured'/org-key when the org has no queue key, and reads nothing", async () => {
    const listQueue = vi.fn(async () => []);
    vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => null) }));
    vi.doMock("@/lib/queue/api", () => ({ listQueue }));
    const { loadFollowUpQueueState, queuedMonthsLookupFor } = await load();

    const state = await loadFollowUpQueueState();
    expect(state).toEqual({ status: "unconfigured", reason: "org-key" });
    expect(listQueue).not.toHaveBeenCalled();
    expect(queuedMonthsLookupFor(state)).toBeNull();
  });

  it("reports 'unconfigured'/env when the deployment has no queue env vars", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API not configured — set QUEUE_API_URL and DASHBOARD_API_TOKEN");
    });
    const { loadFollowUpQueueState } = await load();

    const state = await loadFollowUpQueueState();
    expect(state).toEqual({ status: "unconfigured", reason: "env" });
  });

  it("reports 'unavailable' on a real outage — never reads as 'nothing queued'", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API 503: Service Unavailable");
    });
    const { loadFollowUpQueueState, queuedMonthsLookupFor } = await load();

    const state = await loadFollowUpQueueState();
    expect(state).toEqual({ status: "unavailable" });
    expect(queuedMonthsLookupFor(state)).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("never throws — an outage here must not break the page it appears on", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("boom");
    });
    const { loadFollowUpQueueState } = await load();
    await expect(loadFollowUpQueueState()).resolves.toBeDefined();
  });
});
