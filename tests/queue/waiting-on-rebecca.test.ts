import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitingOnRebecca, approvalLabel } from "@/components/leads/WaitingOnRebecca";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";

/** The lead page's "Waiting on Rebecca" panel, per state: a failed read is never "nothing waiting". */

const NOW = Date.parse("2026-10-19T16:00:00Z");
const render = (approvals: LeadPendingApprovals, leadId = "lead-1") =>
  renderToStaticMarkup(WaitingOnRebecca({ leadId, approvals, now: NOW }) as never);

describe("WaitingOnRebecca", () => {
  it("renders nothing when the firm has no queue", () => {
    expect(WaitingOnRebecca({ leadId: "lead-1", approvals: { status: "unconfigured" }, now: NOW })).toBeNull();
  });

  it("says what is waiting for approval can't be shown, never an empty queue", () => {
    const html = render({ status: "unavailable" });
    expect(html).toContain("Can&#x27;t show what&#x27;s waiting for approval right now. Refresh to try again.");
    expect(html).not.toContain("Nothing waiting");
  });

  it("renders nothing (no empty card) when the queue was read and had nothing for this lead", () => {
    const html = render({ status: "ok", byLead: { "lead-2": [{ queueId: "q-9", headline: "Other", kind: "other", createdAt: null }] } });
    expect(html).toBe("");
  });

  it("lists this lead's items with label, headline, age and a queue link", () => {
    const html = render({
      status: "ok",
      byLead: {
        "lead-1": [
          { queueId: "q-1", headline: "Heads-up: Dana consult", kind: "rebecca_brief", createdAt: "2026-10-19T13:00:00Z" },
          { queueId: "q-2", headline: "Prep email to Dana", kind: "client_draft", createdAt: "2026-10-17T13:00:00Z" },
          { queueId: "q-3", headline: "Internal note", kind: "other", createdAt: null },
        ],
      },
    });
    expect(html).toContain("Brief for the attorney");
    expect(html).toContain("Client email draft — needs approval");
    expect(html).toContain("Draft awaiting approval");
    expect(html).toContain("Heads-up: Dana consult");
    expect(html).toContain("queued 3 h ago");
    expect(html).toContain("queued 2 days ago");
    expect(html).toMatch(/href="\/dashboard\/queue\/q-1\/?"/);
    expect(html).toMatch(/href="\/dashboard\/queue\/q-3\/?"/);
  });

  it("labels each kind", () => {
    expect(approvalLabel("rebecca_brief")).toBe("Brief for the attorney");
    expect(approvalLabel("client_draft")).toBe("Client email draft — needs approval");
    expect(approvalLabel("other")).toBe("Draft awaiting approval");
  });
});
