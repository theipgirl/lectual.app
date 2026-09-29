import { describe, it, expect } from "vitest";

// Ported from lectual tests/queue/queue-load.test.ts (the queueUnavailableCopy block).
describe("queueUnavailableCopy — a different message for a different cause", () => {
  it("tells a firm with no queue key that approvals aren't enabled yet, with no env instructions", async () => {
    const { queueUnavailableCopy } = await import(
      "@/components/queue/QueueUnavailable"
    );
    const copy = queueUnavailableCopy({ status: "unconfigured", reason: "org-key" });
    expect(copy.title).toBe("Approvals aren't enabled for this firm yet.");
    expect(`${copy.title} ${copy.body}`).not.toMatch(/QUEUE_API_URL|DASHBOARD_API_TOKEN|admin/i);
  });

  it("keeps the admin/env instructions for a deployment that really is missing its env vars", async () => {
    const { queueUnavailableCopy } = await import(
      "@/components/queue/QueueUnavailable"
    );
    const copy = queueUnavailableCopy({ status: "unconfigured", reason: "env" });
    expect(copy.body).toContain("QUEUE_API_URL");
    expect(copy.body).toContain("DASHBOARD_API_TOKEN");
  });

  it("keeps the outage message distinct, and never implies nothing is waiting", async () => {
    const { queueUnavailableCopy } = await import(
      "@/components/queue/QueueUnavailable"
    );
    const copy = queueUnavailableCopy({ status: "unavailable" });
    expect(copy.title).toBe("Couldn't reach the approval queue right now.");
    expect(copy.body).toContain("not the same as nothing waiting");
  });
});
