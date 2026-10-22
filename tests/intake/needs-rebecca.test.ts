import { describe, it, expect } from "vitest";
import type { LeadPendingApproval, LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import {
  approvalsShown,
  filterNeedsRebecca,
  leadsNeedingApproval,
  needsRebeccaLabel,
  needsRebeccaTitle,
  pendingFor,
} from "@/lib/intake/needs-rebecca";

function item(queueId: string, headline: string): LeadPendingApproval {
  return { queueId, headline, kind: "client_draft", createdAt: null };
}

const OK: LeadPendingApprovals = {
  status: "ok",
  byLead: {
    a: [item("q1", "Reply to Ada"), item("q2", "Engagement letter")],
    b: [],
    c: [item("q3", "Follow-up")],
  },
};
const UNAVAILABLE: LeadPendingApprovals = { status: "unavailable" };
const UNCONFIGURED: LeadPendingApprovals = { status: "unconfigured" };

const rows = ["a", "b", "c", "d"].map((id) => ({ lead: { id } }));
const ids = (list: Array<{ lead: { id: string } }>) => list.map((row) => row.lead.id);

describe("approvalsShown", () => {
  it("is true only for an ok read", () => {
    expect(approvalsShown(OK)).toBe(true);
    expect(approvalsShown(UNAVAILABLE)).toBe(false);
    expect(approvalsShown(UNCONFIGURED)).toBe(false);
    expect(approvalsShown(undefined)).toBe(false);
  });
});

describe("pendingFor", () => {
  it("returns a lead's pending drafts", () => {
    expect(pendingFor(OK, "a").map((p) => p.queueId)).toEqual(["q1", "q2"]);
  });

  it("returns [] for a lead with no entry or an empty list", () => {
    expect(pendingFor(OK, "d")).toEqual([]);
    expect(pendingFor(OK, "b")).toEqual([]);
  });

  it("returns [] whenever the queue wasn't read — never a phantom badge", () => {
    expect(pendingFor(UNAVAILABLE, "a")).toEqual([]);
    expect(pendingFor(UNCONFIGURED, "a")).toEqual([]);
    expect(pendingFor(undefined, "a")).toEqual([]);
  });
});

describe("leadsNeedingApproval", () => {
  it("collects leads with at least one pending draft, skipping empty lists", () => {
    expect(Array.from(leadsNeedingApproval(OK)).sort()).toEqual(["a", "c"]);
  });

  it("is empty when the queue wasn't read", () => {
    expect(leadsNeedingApproval(UNAVAILABLE).size).toBe(0);
    expect(leadsNeedingApproval(undefined).size).toBe(0);
  });
});

describe("filterNeedsRebecca", () => {
  it("keeps only leads with a pending draft when on and the read was ok", () => {
    expect(ids(filterNeedsRebecca(rows, OK, true))).toEqual(["a", "c"]);
  });

  it("returns every row when off", () => {
    expect(ids(filterNeedsRebecca(rows, OK, false))).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores the toggle when the queue wasn't read — unreachable must not look like nobody", () => {
    expect(ids(filterNeedsRebecca(rows, UNAVAILABLE, true))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterNeedsRebecca(rows, UNCONFIGURED, true))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterNeedsRebecca(rows, undefined, true))).toEqual(["a", "b", "c", "d"]);
  });

  it("can legitimately return nothing when the read was ok and nobody is waiting", () => {
    expect(filterNeedsRebecca(rows, { status: "ok", byLead: {} }, true)).toEqual([]);
  });
});

describe("badge copy", () => {
  it("labels with the count", () => {
    expect(needsRebeccaLabel(2)).toBe("Needs attorney · 2");
  });

  it("lists headlines one per line and names a blank one", () => {
    expect(needsRebeccaTitle([item("q1", "Reply to Ada"), item("q2", "  ")])).toBe(
      "Reply to Ada\nDraft waiting for review",
    );
  });
});
