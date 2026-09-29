import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = new Date("2026-08-21T00:00:00.000Z");

function matterFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "matter-1",
    org_id: "org-1",
    lead_id: "lead-1",
    mark_text: "SUNBEAM",
    // One month before NOW — due for month 1 by default.
    filing_date: "2026-07-15",
    stage: { code: "18" },
    ...overrides,
  };
}

const leadFixture = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  business_name: null,
};

function baseMocks(overrides: {
  matter?: unknown;
  lead?: unknown;
  orgKey?: string | null;
  listQueueImpl?: (org: string, status: string) => Promise<unknown[]>;
  createDraftImpl?: () => Promise<{ id: string }>;
} = {}) {
  const requireMatterWriteRole = vi.fn(async () => "attorney");
  const getMatter = vi.fn(async () => (overrides.matter === undefined ? matterFixture() : overrides.matter));
  const getLead = vi.fn(async () => (overrides.lead === undefined ? leadFixture : overrides.lead));
  const activeQueueOrgKey = vi.fn(
    async () => (overrides.orgKey === undefined ? "rpb-law" : overrides.orgKey),
  );
  const listQueue = vi.fn(overrides.listQueueImpl ?? (async () => []));
  const createDraft = vi.fn(overrides.createDraftImpl ?? (async () => ({ id: "queue-1" })));

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/matters/matters", () => ({ getMatter, requireMatterWriteRole }));
  vi.doMock("@/lib/pipeline/leads", () => ({ getLead }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey }));
  vi.doMock("@/lib/queue/api", () => ({ listQueue, createDraft }));

  return { requireMatterWriteRole, getMatter, getLead, activeQueueOrgKey, listQueue, createDraft };
}

describe("queueMonthlyStatusUpdate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks the write role, drafts month 1, and queues a CLIENT_EMAIL", async () => {
    const { requireMatterWriteRole, createDraft } = baseMocks();
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    const result = await queueMonthlyStatusUpdate("matter-1");

    expect(requireMatterWriteRole).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        orgKey: "rpb-law",
        agent: "filing-followup",
        type: "CLIENT_EMAIL",
        matterId: "matter-1",
        recipient: "jane@example.com",
        subject: "A quick update on your trademark application",
        headline: "Monthly Status Update — Month 1 of ~5 — SUNBEAM",
      }),
    );
    expect(result).toEqual({ queueItemId: "queue-1" });
  });

  it("refuses when the matter isn't in the awaiting-registration stage", async () => {
    baseMocks({ matter: matterFixture({ stage: { code: "19A" } }) });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/awaiting trademark registration/i);
  });

  it("refuses when the matter has no mark on file", async () => {
    baseMocks({ matter: matterFixture({ mark_text: null }) });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/no mark on file/i);
  });

  it("refuses when the client has no email on file", async () => {
    baseMocks({ lead: { ...leadFixture, email: null } });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/no email on file/i);
  });

  it("refuses when it isn't due yet (filed less than a month ago)", async () => {
    baseMocks({ matter: matterFixture({ filing_date: "2026-08-05" }) });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/no update is due yet/i);
  });

  it("refuses when the current month is already queued or approved, and never double-queues", async () => {
    const { createDraft } = baseMocks({
      listQueueImpl: async (_org, status) =>
        status === "pending"
          ? [{ type: "CLIENT_EMAIL", matter_id: "matter-1", headline: "Monthly Status Update — Month 1 of ~5 — SUNBEAM" }]
          : [],
    });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/already queued or approved/i);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("advances to month 2 once month 1 is approved and enough time has passed", async () => {
    baseMocks({
      matter: matterFixture({ filing_date: "2026-06-01" }), // ~2.5 months elapsed
      listQueueImpl: async (_org, status) =>
        status === "approved"
          ? [{ type: "CLIENT_EMAIL", matter_id: "matter-1", headline: "Monthly Status Update — Month 1 of ~5 — SUNBEAM" }]
          : [],
    });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    const result = await queueMonthlyStatusUpdate("matter-1");
    expect(result).toEqual({ queueItemId: "queue-1" });
  });

  it("refuses (fails closed) when the approval queue can't be reached, rather than assuming nothing is queued", async () => {
    baseMocks({
      orgKey: "rpb-law",
      listQueueImpl: async () => {
        throw new Error("network error");
      },
    });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/couldn't be reached/i);
  });

  it("refuses when this firm has no approval queue configured", async () => {
    baseMocks({ orgKey: null });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("matter-1")).rejects.toThrow(/approval queue/i);
  });

  it("returns not-found when the matter is invisible under RLS", async () => {
    baseMocks({ matter: null });
    const { queueMonthlyStatusUpdate } = await import("@/lib/matters/filing-followup-action");

    await expect(queueMonthlyStatusUpdate("nope")).rejects.toThrow(/matter not found/i);
  });
});
