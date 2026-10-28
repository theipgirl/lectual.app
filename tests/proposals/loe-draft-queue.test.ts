import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTrademarkLoeDraft } from "@/lib/documents/loe";
import { loeInputFromAcceptedProposal } from "@/lib/proposals/loe-adapter";
import { acceptedSnapshot, CONCIERGE } from "./accepted-fixture";

/**
 * The REAL generateTrademarkLoe over the existing document and queue mocks (the way
 * tests/documents/generate.test.ts drives it): an accepted proposal's adapter output goes into the
 * ordinary LOE queue path as an ENGAGEMENT_LETTER, and the draft row carries the proposal's id.
 */

const matter = { id: "matter-1", org_id: "org-1", mark_text: "Prosperall", lead_id: "lead-1", owner_name: "Sevetri Wilson" };
const PROPOSAL = "44444444-4444-4444-8444-444444444444";

function mocks(opts: { orgKey?: string | null; createDraftThrows?: boolean } = {}) {
  const createDocumentDraft = vi.fn(async (_s: unknown, input: { matterId: string; orgId: string; docType: string; payload: Record<string, unknown> }) => ({
    id: "draft-1",
    org_id: input.orgId,
    matter_id: input.matterId,
    doc_type: input.docType,
    queue_item_id: null,
    status: "queued",
    payload: input.payload,
  }));
  const attachQueueItemId = vi.fn(async () => {});
  const deleteDocumentDraft = vi.fn(async () => {});
  const createDraft = vi.fn(async (...args: [Record<string, unknown>]) => {
    void args;
    if (opts.createDraftThrows) throw new Error("queue down");
    return { id: "queue-1" };
  });

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/matters/matters", () => ({ getMatter: vi.fn(async () => matter) }));
  vi.doMock("@/lib/pipeline/leads", () => ({ getLead: vi.fn(async () => null) }));
  vi.doMock("@/lib/matters/client-name", () => ({ resolveMatterClientName: vi.fn(async () => ({ name: "Sevetri Wilson", source: "owner_name" })) }));
  vi.doMock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => (opts.orgKey === undefined ? "rpb-law" : opts.orgKey)) }));
  vi.doMock("@/lib/queue/api", () => ({ createDraft }));
  vi.doMock("@/lib/documents/store", () => ({ requireDocumentWriteRole: vi.fn(async () => "owner"), createDocumentDraft, attachQueueItemId, deleteDocumentDraft }));
  vi.doMock("@/lib/documents/extract", () => ({ extractTextFromUpload: vi.fn() }));
  vi.doMock("@/lib/documents/opinion-letter", () => ({ buildOpinionLetterDraft: vi.fn() }));
  vi.doMock("@/lib/documents/trademark-clearance", () => ({ buildTrademarkClearanceDraft: vi.fn() }));
  return { createDocumentDraft, createDraft, attachQueueItemId, deleteDocumentDraft };
}

function adapted() {
  const r = loeInputFromAcceptedProposal(acceptedSnapshot({ classes: 2 }), { packages: [CONCIERGE], todayIso: "2026-10-22" });
  if (!r.ok) throw new Error("refused");
  return r.input;
}

describe("an accepted proposal's LOE through the real queue path", () => {
  beforeEach(() => vi.resetModules());

  it("queues an ENGAGEMENT_LETTER with the adapter's headline and body, for the matter and the client", async () => {
    const m = mocks();
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");
    const input = adapted();
    const built = buildTrademarkLoeDraft(input);

    const out = await generateTrademarkLoe({ ...input, matterId: "matter-1", proposalId: PROPOSAL });
    expect(out).toEqual({ draftId: "draft-1", queueItemId: "queue-1" });

    expect(m.createDraft).toHaveBeenCalledTimes(1);
    expect(m.createDraft.mock.calls[0][0]).toMatchObject({
      orgKey: "rpb-law",
      type: "ENGAGEMENT_LETTER",
      headline: built.headline,
      draftBody: built.draftBody,
      matterId: "matter-1",
      clientName: "Prosperall", // the entity, as the form does it
      dedupe: false,
    });
    // The queue item is a draft for a person to approve: nothing here sends.
    expect(JSON.stringify(m.createDraft.mock.calls[0][0])).not.toMatch(new RegExp(["send_at", ["send", "Mail"].join("")].join("|")));
  });

  it("the document draft row carries proposalId, and the built payload is otherwise unchanged", async () => {
    const m = mocks();
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");
    const input = adapted();
    await generateTrademarkLoe({ ...input, matterId: "matter-1", proposalId: PROPOSAL });
    const stored = m.createDocumentDraft.mock.calls[0][1];
    expect(stored.docType).toBe("loe_trademark_current");
    expect(stored.payload.proposalId).toBe(PROPOSAL);
    const { proposalId, ...rest } = stored.payload;
    expect(proposalId).toBe(PROPOSAL);
    expect(rest).toEqual(buildTrademarkLoeDraft(input).payload);
  });

  it("the ordinary LOE form (no proposalId) writes the payload exactly as before", async () => {
    const m = mocks();
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");
    const input = adapted();
    await generateTrademarkLoe({ ...input, matterId: "matter-1" });
    expect(m.createDocumentDraft.mock.calls[0][1].payload).toEqual(buildTrademarkLoeDraft(input).payload);
    expect(m.createDocumentDraft.mock.calls[0][1].payload).not.toHaveProperty("proposalId");
  });

  it("no queue configured: refused with the existing sentence before any row is made", async () => {
    const m = mocks({ orgKey: null });
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");
    await expect(generateTrademarkLoe({ ...adapted(), matterId: "matter-1", proposalId: PROPOSAL })).rejects.toThrow(/Approvals aren't switched on for your firm yet/);
    expect(m.createDocumentDraft).not.toHaveBeenCalled();
    expect(m.createDraft).not.toHaveBeenCalled();
  });

  it("a failed queue POST removes the draft row, so a retry can create exactly one", async () => {
    const m = mocks({ createDraftThrows: true });
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");
    await expect(generateTrademarkLoe({ ...adapted(), matterId: "matter-1", proposalId: PROPOSAL })).rejects.toThrow("queue down");
    expect(m.deleteDocumentDraft).toHaveBeenCalledWith(expect.anything(), "draft-1");
    expect(m.attachQueueItemId).not.toHaveBeenCalled();
  });
});
