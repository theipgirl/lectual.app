import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Direct coverage for the approval queue's three-state load.
 *
 * This is the highest-consequence piece of UI logic in the product. Lectual's
 * promise is that nothing reaches a client without a human approving it; a
 * surface that reports "nothing is waiting for review" while the queue is
 * actually unreachable tells a firm they have no work to do while real drafts
 * sit unseen. Two-state loading (items-or-empty) makes that failure invisible,
 * and every page except the firm shell used to do exactly that.
 *
 * So the contract asserted here is narrow and deliberate: an empty array is
 * only ever produced when we genuinely reached the queue and it was empty.
 */

function mockQueue(orgKey: string | null, listQueueImpl: () => Promise<unknown[]>) {
  vi.doMock("@/lib/queue/org", () => ({
    activeQueueOrgKey: vi.fn(async () => orgKey),
  }));
  vi.doMock("@/lib/queue/api", () => ({ listQueue: vi.fn(listQueueImpl) }));
}

async function load() {
  const mod = await import("@/lib/queue/load");
  return mod;
}

describe("loadActiveQueue — three states, never two", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    // The outage path logs a breadcrumb on purpose; keep test output readable
    // while still asserting the behaviour that produces it.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reports 'ok' with the items when the queue is reachable", async () => {
    mockQueue("rpb-law", async () => [{ id: "q-1" }]);
    const { loadActiveQueue, isGenuinelyEmpty, pendingCountOrNull } = await load();

    const result = await loadActiveQueue();
    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(isGenuinelyEmpty(result)).toBe(false);
    expect(pendingCountOrNull(result)).toBe(1);
  });

  it("reports 'ok' for a genuinely empty queue — the ONLY honest empty", async () => {
    mockQueue("rpb-law", async () => []);
    const { loadActiveQueue, isGenuinelyEmpty, pendingCountOrNull } = await load();

    const result = await loadActiveQueue();
    expect(result.status).toBe("ok");
    expect(isGenuinelyEmpty(result)).toBe(true);
    expect(pendingCountOrNull(result)).toBe(0);
  });

  it("reports 'unconfigured' — not an empty queue — when the org has no queue key", async () => {
    const listQueue = vi.fn(async () => [{ id: "someone-elses" }]);
    vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => null) }));
    vi.doMock("@/lib/queue/api", () => ({ listQueue }));
    const { loadActiveQueue, isGenuinelyEmpty, pendingCountOrNull } = await load();

    const result = await loadActiveQueue();
    expect(result.status).toBe("unconfigured");
    // ...and says WHY, so the surface can tell this firm "approvals aren't
    // enabled yet" instead of sending them after env vars that are fine.
    expect(result.reason).toBe("org-key");
    // The queue lives outside RLS's reach, so an unkeyed org must not read at
    // all — never another firm's queue.
    expect(listQueue).not.toHaveBeenCalled();
    // And it must not read as "all caught up".
    expect(isGenuinelyEmpty(result)).toBe(false);
    expect(pendingCountOrNull(result)).toBeNull();
  });

  it("reports 'unconfigured' when the deployment has no queue env vars", async () => {
    // Raised by @/lib/queue/api's config(). Same "there is no queue here"
    // state as a keyless org: waiting will not fix it, so it must not share a
    // message with a transient outage.
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API not configured — set QUEUE_API_URL and DASHBOARD_API_TOKEN");
    });
    const { loadActiveQueue } = await load();

    const result = await loadActiveQueue();
    expect(result.status).toBe("unconfigured");
    // Distinct reason: this one really IS an admin/env fix, and it affects
    // firms that DO have a queue key.
    expect(result.reason).toBe("env");
  });

  it("carries no reason on the states where one would be meaningless", async () => {
    mockQueue("rpb-law", async () => []);
    const { loadActiveQueue } = await load();
    expect((await loadActiveQueue()).reason).toBeUndefined();

    vi.resetModules();
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API 503: Service Unavailable");
    });
    const { loadActiveQueue: load2 } = await load();
    const outage = await load2();
    expect(outage.status).toBe("unavailable");
    expect(outage.reason).toBeUndefined();
  });

  it("reports 'unavailable' on a real outage, and never claims zero pending", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API 503: Service Unavailable");
    });
    const { loadActiveQueue, isGenuinelyEmpty, pendingCountOrNull } = await load();

    const result = await loadActiveQueue();
    expect(result.status).toBe("unavailable");
    expect(isGenuinelyEmpty(result)).toBe(false);
    // A number here would be a lie — the caller must render its own copy.
    expect(pendingCountOrNull(result)).toBeNull();
  });

  it("never throws — a queue outage must not break the page it appears on", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("boom");
    });
    const { loadActiveQueue } = await load();
    await expect(loadActiveQueue()).resolves.toBeDefined();
  });

  it("leaves an outage diagnosable rather than silent", async () => {
    mockQueue("rpb-law", async () => {
      throw new Error("Queue API 503: Service Unavailable");
    });
    const { loadActiveQueue } = await load();

    await loadActiveQueue();
    expect(errorSpy).toHaveBeenCalled();
  });
});

/**
 * The copy each non-ok state produces. This is asserted rather than eyeballed
 * because the wrong message here has a real cost: Cabanis Law has no
 * crm_org.queue_org_key (approvals simply aren't switched on for them), and
 * the old single "unconfigured" message told them to ask an admin to set
 * QUEUE_API_URL and DASHBOARD_API_TOKEN — env vars that were already set
 * correctly. They'd have been chasing a bug that didn't exist.
 */

// The `queueUnavailableCopy` suite from lectual ports with the queue page
// (step 6) — it tests that page's component, not this loader.
