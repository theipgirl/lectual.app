import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { notReadyYet } from "@/lib/ui/words";

// Ported from lectual tests/queue/queue-load.test.ts (the queueUnavailableCopy block), reworded to the glossary.
describe("queueUnavailableCopy: a different message for a different cause", () => {
  it("tells a firm with no queue key that approvals aren't switched on yet, with no setting names", async () => {
    const { queueUnavailableCopy } = await import("@/components/queue/QueueUnavailable");
    const copy = queueUnavailableCopy({ status: "unconfigured", reason: "org-key" });
    expect(copy.title).toBe("Approvals aren't switched on for your firm yet.");
    expect(`${copy.title} ${copy.body}`).not.toMatch(/QUEUE_API_URL|DASHBOARD_API_TOKEN|admin|agent workflows/i);
  });

  it("uses the glossary sentence when the queue service itself is not set up, never a setting name", async () => {
    const { queueUnavailableCopy } = await import("@/components/queue/QueueUnavailable");
    const copy = queueUnavailableCopy({ status: "unconfigured", reason: "env" });
    expect(copy.title).toBe("Approvals aren't switched on for your firm yet.");
    expect(copy.body).toBe(notReadyYet("Approvals"));
    expect(`${copy.title} ${copy.body}`).not.toMatch(/QUEUE_API_URL|DASHBOARD_API_TOKEN|ask an admin/i);
  });

  it("keeps the outage message distinct, and never implies nothing is waiting", async () => {
    const { queueUnavailableCopy } = await import("@/components/queue/QueueUnavailable");
    const copy = queueUnavailableCopy({ status: "unavailable" });
    expect(copy.title).toBe("Can't reach approvals right now.");
    expect(copy.body).toBe("Can't show what's waiting right now. Refresh to try again.");
    expect(copy.body).not.toMatch(/not the same as/i);
  });

  it("renders no environment-variable name for any state", async () => {
    const { QueueUnavailable } = await import("@/components/queue/QueueUnavailable");
    for (const props of [
      { status: "unconfigured", reason: "org-key" },
      { status: "unconfigured", reason: "env" },
      { status: "unavailable" },
    ] as const) {
      const html = renderToStaticMarkup(createElement(QueueUnavailable, props));
      expect(html).not.toMatch(/\b[A-Z][A-Z0-9]+_[A-Z0-9_]{2,}\b/);
    }
  });
});
