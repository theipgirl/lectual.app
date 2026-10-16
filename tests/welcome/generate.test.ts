import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * generateWelcomeEmail (src/lib/welcome/generate.ts) — the welcome-client
 * skill's trigger. Mirrors tests/documents/generate.test.ts's mocking shape:
 * every collaborator is mocked so this file verifies orchestration only
 * (role gate → trademark-only scope → idempotency gate → queue org check →
 * build → queue → record the activity row), not any one collaborator's own
 * behavior (covered by welcome-email.test.ts and the queue/api tests).
 */

function baseMocks(overrides: {
  matter?: unknown;
  lead?: unknown;
  orgKey?: string | null;
  alreadySent?: boolean;
  createDraftImpl?: () => Promise<{ id: string }>;
} = {}) {
  const requireMatterWriteRole = vi.fn(async () => "attorney");
  const getMatter = vi.fn(async () => overrides.matter ?? null);
  const getLead = vi.fn(async () => overrides.lead ?? null);
  const hasMatterActivityType = vi.fn(async () => overrides.alreadySent ?? false);
  const logActivity = vi.fn(async () => {});
  const activeQueueOrgKey = vi.fn(
    async () => (overrides.orgKey === undefined ? "rpb-law" : overrides.orgKey),
  );
  const createDraft = vi.fn(overrides.createDraftImpl ?? (async () => ({ id: "queue-1" })));

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/matters/matters", () => ({ getMatter, requireMatterWriteRole }));
  vi.doMock("@/lib/pipeline/leads", () => ({ getLead }));
  vi.doMock("@/lib/matters/activity", () => ({ hasMatterActivityType, logActivity }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey }));
  vi.doMock("@/lib/queue/api", () => ({ createDraft }));

  return { requireMatterWriteRole, getMatter, getLead, hasMatterActivityType, logActivity, createDraft };
}

const trademarkMatter = {
  id: "matter-1",
  org_id: "org-1",
  lead_id: "lead-1",
  type: "TM",
  mark_text: "SUNBEAM",
  matter_number: "TM-0042",
  owner_name: "Jane Doe",
};

const lead = {
  id: "lead-1",
  first_name: "Jane",
  last_name: "Doe",
  business_name: null,
  email: "jane@example.com",
};

describe("generateWelcomeEmail", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("checks the write role, queues a CLIENT_EMAIL draft, and records the welcome_email activity", async () => {
    const { requireMatterWriteRole, createDraft, logActivity } = baseMocks({
      matter: trademarkMatter,
      lead,
    });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    const result = await generateWelcomeEmail({ matterId: "matter-1" });

    expect(requireMatterWriteRole).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        orgKey: "rpb-law",
        agent: "welcome-client",
        type: "CLIENT_EMAIL",
        matterId: "matter-1",
        clientName: "Jane Doe",
      }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "welcome_email",
        matterId: "matter-1",
        payload: expect.objectContaining({ queueItemId: "queue-1" }),
      }),
    );
    expect(result).toEqual({ queueItemId: "queue-1" });
  });

  it("refuses on a non-trademark matter", async () => {
    baseMocks({ matter: { ...trademarkMatter, type: "CR" }, lead });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "matter-1" })).rejects.toThrow(/trademark matters/i);
  });

  it("refuses when a welcome email has already been queued for this matter", async () => {
    baseMocks({ matter: trademarkMatter, lead, alreadySent: true });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "matter-1" })).rejects.toThrow(/already been queued/i);
  });

  it("refuses when the firm has no approval queue configured", async () => {
    baseMocks({ matter: trademarkMatter, lead, orgKey: null });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "matter-1" })).rejects.toThrow(/approval queue/i);
  });

  it("returns not-found when the matter is invisible under RLS", async () => {
    baseMocks({ matter: null });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "nope" })).rejects.toThrow(/matter not found/i);
  });

  it("never queues nor logs when the trademark-only gate refuses first", async () => {
    const { createDraft, logActivity } = baseMocks({ matter: { ...trademarkMatter, type: "PATENT" }, lead });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "matter-1" })).rejects.toThrow();
    expect(createDraft).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("falls back to the matter's owner_name when there's no linked lead", async () => {
    const { createDraft } = baseMocks({ matter: { ...trademarkMatter, lead_id: null }, lead: null });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await generateWelcomeEmail({ matterId: "matter-1" });

    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ clientName: "Jane Doe" }));
  });

  it("does not record the activity row when the queue POST fails", async () => {
    const { logActivity } = baseMocks({
      matter: trademarkMatter,
      lead,
      createDraftImpl: async () => {
        throw new Error("Queue API 500: boom");
      },
    });
    const { generateWelcomeEmail } = await import("@/lib/welcome/generate");

    await expect(generateWelcomeEmail({ matterId: "matter-1" })).rejects.toThrow(/boom/);
    expect(logActivity).not.toHaveBeenCalled();
  });
});
