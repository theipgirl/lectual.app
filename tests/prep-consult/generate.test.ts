import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * queuePrepConsultDrafts (src/lib/prep-consult/generate.ts) — the
 * prep-consult skill's staff-triggered orchestration. Mirrors
 * tests/welcome/generate.test.ts's mocking shape: every collaborator is
 * mocked so this file verifies orchestration only (role gate → validation →
 * lead lookup → queue-org check → build both drafts → queue HEADS-UP
 * (BRIEFING) → queue CLIENT-PREP (CLIENT_EMAIL) → log activity for each),
 * not any one collaborator's own behavior (covered by drafts.test.ts and the
 * queue/api tests).
 */

function baseMocks(overrides: {
  role?: string;
  lead?: unknown;
  orgKey?: string | null;
  createDraftImpl?: (input: unknown) => Promise<{ id: string }>;
  headsUp?: { headline: string; summary: string; subject: string; draftBody: string };
  clientPrep?: { headline: string; summary: string; subject: string; draftBody: string };
} = {}) {
  const resolveCurrentRole = vi.fn(async () => overrides.role ?? "attorney");
  const getLead = vi.fn(async () => overrides.lead ?? null);
  const logActivitySafe = vi.fn(async () => {});
  const activeQueueOrgKey = vi.fn(
    async () => (overrides.orgKey === undefined ? "rpb-law" : overrides.orgKey),
  );
  let call = 0;
  const createDraft = vi.fn(
    overrides.createDraftImpl ??
      (async () => {
        call += 1;
        return { id: `queue-${call}` };
      }),
  );
  const buildHeadsUpDraft = vi.fn(
    async () =>
      overrides.headsUp ?? {
        headline: "Consult heads-up — Jane Doe (Trademark)",
        summary: "summary",
        subject: "Consult booked — Jane Doe (Trademark)",
        draftBody: "heads-up body",
      },
  );
  const buildClientPrepDraft = vi.fn(
    async () =>
      overrides.clientPrep ?? {
        headline: "Consult prep email DRAFT — Jane Doe (Trademark)",
        summary: "summary",
        subject: "Preparing for your strategy session — Jane Doe",
        draftBody: "client prep body",
      },
  );

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/pipeline", () => ({
    getLead,
    resolveCurrentRole,
    CAN_WRITE_LEAD: [
      "owner",
      "admin",
      "senior_admin",
      "intake",
      "paralegal",
      "law_clerk",
      "attorney",
      "clerk",
    ],
  }));
  vi.doMock("@/lib/matters/activity", () => ({ logActivitySafe }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey }));
  vi.doMock("@/lib/queue/api", () => ({ createDraft }));
  vi.doMock("@/lib/prep-consult/drafts", () => ({ buildHeadsUpDraft, buildClientPrepDraft }));

  return {
    resolveCurrentRole,
    getLead,
    logActivitySafe,
    activeQueueOrgKey,
    createDraft,
    buildHeadsUpDraft,
    buildClientPrepDraft,
  };
}

const lead = {
  id: "lead-1",
  org_id: "org-1",
  first_name: "Jane",
  last_name: "Doe",
  business_name: null,
  email: "jane@example.com",
};

const input = {
  leadId: "lead-1",
  practiceArea: "Trademark",
  inquiryDescription: "I want to protect my coffee brand name.",
  sessionWhen: "Thursday at 2pm ET",
  zoomLink: "https://zoom.us/j/1",
};

describe("queuePrepConsultDrafts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("queues the heads-up as BRIEFING (no recipient) and the client-prep as CLIENT_EMAIL (with recipient), and logs both", async () => {
    const { createDraft, logActivitySafe, resolveCurrentRole } = baseMocks({ lead });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    const result = await queuePrepConsultDrafts(input);

    expect(resolveCurrentRole).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledTimes(2);

    const headsUpCall = createDraft.mock.calls[0]![0] as Record<string, unknown>;
    expect(headsUpCall).toMatchObject({
      orgKey: "rpb-law",
      agent: "prep-consult",
      type: "BRIEFING",
      clientName: "Jane Doe",
    });
    expect(headsUpCall.recipient).toBeUndefined();

    const clientPrepCall = createDraft.mock.calls[1]![0] as Record<string, unknown>;
    expect(clientPrepCall).toMatchObject({
      orgKey: "rpb-law",
      agent: "prep-consult",
      type: "CLIENT_EMAIL",
      clientName: "Jane Doe",
      recipient: "jane@example.com",
    });

    expect(logActivitySafe).toHaveBeenCalledTimes(2);
    expect(logActivitySafe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "queue_drafted",
        leadId: "lead-1",
        payload: expect.objectContaining({ agent: "prep-consult", kind: "heads_up", queueItemId: "queue-1" }),
      }),
    );
    expect(logActivitySafe).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "queue_drafted",
        leadId: "lead-1",
        payload: expect.objectContaining({
          agent: "prep-consult",
          kind: "client_prep",
          queueItemId: "queue-2",
        }),
      }),
    );

    expect(result).toEqual({ headsUpQueueItemId: "queue-1", clientPrepQueueItemId: "queue-2" });
  });

  it("refuses a role not in CAN_WRITE_LEAD before touching the lead or the queue", async () => {
    const { getLead, createDraft } = baseMocks({ lead, role: "viewer" });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts(input)).rejects.toThrow(/permission/i);
    expect(getLead).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("refuses a blank practice area", async () => {
    baseMocks({ lead });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts({ ...input, practiceArea: "  " })).rejects.toThrow(
      /practice area/i,
    );
  });

  it("refuses a blank inquiry description — never invents what the client is asking for", async () => {
    baseMocks({ lead });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts({ ...input, inquiryDescription: "   " })).rejects.toThrow(
      /never invents/i,
    );
  });

  it("returns not-found when the lead is invisible under RLS", async () => {
    baseMocks({ lead: null });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts(input)).rejects.toThrow(/lead not found/i);
  });

  it("refuses when the firm has no approval queue configured", async () => {
    baseMocks({ lead, orgKey: null });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts(input)).rejects.toThrow(/approval queue/i);
  });

  it("never builds or queues a draft when validation fails first", async () => {
    const { createDraft, buildHeadsUpDraft, buildClientPrepDraft } = baseMocks({ lead });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts({ ...input, practiceArea: "" })).rejects.toThrow();
    expect(buildHeadsUpDraft).not.toHaveBeenCalled();
    expect(buildClientPrepDraft).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("builds both drafts before queuing either, so a build failure never orphans a queued draft", async () => {
    const { createDraft } = baseMocks({ lead });
    vi.doMock("@/lib/prep-consult/drafts", () => ({
      buildHeadsUpDraft: vi.fn(async () => ({
        headline: "h",
        summary: "s",
        subject: "s",
        draftBody: "b",
      })),
      buildClientPrepDraft: vi.fn(async () => {
        throw new Error("model refused");
      }),
    }));
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await expect(queuePrepConsultDrafts(input)).rejects.toThrow(/model refused/);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("uses business_name over the individual's name in clientName when both are on file", async () => {
    const { createDraft } = baseMocks({ lead: { ...lead, business_name: "Doe Coffee Co." } });
    const { queuePrepConsultDrafts } = await import("@/lib/prep-consult/generate");

    await queuePrepConsultDrafts(input);

    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ clientName: "Doe Coffee Co." }));
  });
});
