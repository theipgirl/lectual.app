import { describe, it, expect, vi, beforeEach } from "vitest";

function baseMocks(overrides: {
  matter?: unknown;
  lead?: unknown;
  orgKey?: string | null;
  extracted?: { text: string; units: number };
  createDraftImpl?: () => Promise<{ id: string }>;
} = {}) {
  const requireDocumentWriteRole = vi.fn(async () => "attorney");
  const createDocumentDraft = vi.fn(async (_supabase: unknown, input: unknown) => ({
    id: "draft-1",
    org_id: (input as { orgId: string }).orgId,
    matter_id: (input as { matterId: string }).matterId,
    doc_type: (input as { docType: string }).docType,
    queue_item_id: null,
    status: "queued",
    payload: (input as { payload: Record<string, unknown> }).payload,
    file_name: null,
    storage_path: null,
    error_message: null,
    generated_at: null,
    created_by: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  }));
  const attachQueueItemId = vi.fn(async () => {});
  const deleteDocumentDraft = vi.fn(async () => {});

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/matters/matters", () => ({
    getMatter: vi.fn(async () => overrides.matter ?? null),
  }));
  vi.doMock("@/lib/pipeline/leads", () => ({
    getLead: vi.fn(async () => overrides.lead ?? null),
  }));
  // resolveMatterClientName does its own contact/lead lookups against a real
  // scoped client — irrelevant to what this suite is testing (the "build,
  // then queue" plumbing), so it's mocked straight from the matter/lead
  // fixtures already in play, same precedence the real function uses.
  vi.doMock("@/lib/matters/client-name", () => ({
    resolveMatterClientName: vi.fn(async () => {
      const m = overrides.matter as { owner_name?: string | null } | null | undefined;
      const l = overrides.lead as
        | { business_name?: string | null; first_name?: string; last_name?: string }
        | null
        | undefined;
      if (l) {
        const name = l.business_name?.trim() || `${l.first_name} ${l.last_name}`.trim();
        return { name: name || null, source: "lead" as const };
      }
      const ownerName = m?.owner_name?.trim() || null;
      return ownerName ? { name: ownerName, source: "owner_name" as const } : { name: null, source: "none" as const };
    }),
  }));
  vi.doMock("@/lib/queue/org", () => ({
    activeQueueOrgKey: vi.fn(async () => (overrides.orgKey === undefined ? "rpb-law" : overrides.orgKey)),
  }));
  vi.doMock("@/lib/queue/api", () => ({
    createDraft: vi.fn(overrides.createDraftImpl ?? (async () => ({ id: "queue-1" }))),
  }));
  vi.doMock("@/lib/documents/store", () => ({
    requireDocumentWriteRole,
    createDocumentDraft,
    attachQueueItemId,
    deleteDocumentDraft,
  }));
  vi.doMock("@/lib/documents/extract", () => ({
    extractTextFromUpload: vi.fn(async () => overrides.extracted ?? { text: "report text", units: 1 }),
  }));
  vi.doMock("@/lib/documents/opinion-letter", () => ({
    buildOpinionLetterDraft: vi.fn(async () => ({
      headline: "Opinion letter DRAFT — Jane Doe — SUNBEAM",
      summary: "summary",
      draftBody: "body",
    })),
  }));
  vi.doMock("@/lib/documents/trademark-clearance", () => ({
    buildTrademarkClearanceDraft: vi.fn(async () => ({
      headline: "Trademark clearance DRAFT — Jane Doe — SUNBEAM",
      summary: "summary",
      draftBody: "body",
    })),
  }));
  vi.doMock("@/lib/documents/loe", () => ({
    buildTrademarkLoeDraft: vi.fn(() => ({
      docType: "loe_trademark_current",
      headline: "LOE DRAFT",
      summary: "summary",
      draftBody: "body",
      payload: {},
    })),
    buildGeneralLoeDraft: vi.fn(async () => ({
      docType: "loe_general",
      headline: "LOE DRAFT",
      summary: "summary",
      draftBody: "body",
      payload: {},
    })),
  }));

  return { requireDocumentWriteRole, createDocumentDraft, attachQueueItemId, deleteDocumentDraft };
}

const matter = {
  id: "matter-1",
  org_id: "org-1",
  lead_id: null,
  mark_text: "SUNBEAM",
  international_classes: [25],
  goods_services: "Clothing",
  owner_name: "Jane Doe",
  package_name: "ESSENTIAL",
};

describe("generateOpinionLetter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("checks the write role, builds the draft, queues it, and attaches the queue item id", async () => {
    const { requireDocumentWriteRole, createDocumentDraft, attachQueueItemId } = baseMocks({ matter });
    const { generateOpinionLetter } = await import("@/lib/documents/generate");

    const result = await generateOpinionLetter({
      matterId: "matter-1",
      upload: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "report.pdf" },
      markType: "word mark",
      honorific: "Ms.",
      entityName: "",
    });

    expect(requireDocumentWriteRole).toHaveBeenCalledTimes(1);
    expect(createDocumentDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matterId: "matter-1", orgId: "org-1", docType: "opinion_letter" }),
    );
    expect(attachQueueItemId).toHaveBeenCalledWith(expect.anything(), "draft-1", "queue-1");
    expect(result).toEqual({ draftId: "draft-1", queueItemId: "queue-1" });
  });

  it("refuses when the matter has no mark on file", async () => {
    baseMocks({ matter: { ...matter, mark_text: null } });
    const { generateOpinionLetter } = await import("@/lib/documents/generate");

    await expect(
      generateOpinionLetter({
        matterId: "matter-1",
        upload: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "report.pdf" },
        markType: "word mark",
        honorific: "",
        entityName: "",
      }),
    ).rejects.toThrow(/no mark on file/i);
  });

  it("refuses when the firm has no approval queue configured", async () => {
    baseMocks({ matter, orgKey: null });
    const { generateOpinionLetter } = await import("@/lib/documents/generate");

    await expect(
      generateOpinionLetter({
        matterId: "matter-1",
        upload: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "report.pdf" },
        markType: "word mark",
        honorific: "",
        entityName: "",
      }),
    ).rejects.toThrow(/approval queue/i);
  });

  it("deletes the bookkeeping row and rethrows when the queue POST fails, rather than leaving an orphan row", async () => {
    const { deleteDocumentDraft } = baseMocks({
      matter,
      createDraftImpl: async () => {
        throw new Error("Queue API 500: boom");
      },
    });
    const { generateOpinionLetter } = await import("@/lib/documents/generate");

    await expect(
      generateOpinionLetter({
        matterId: "matter-1",
        upload: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "report.pdf" },
        markType: "word mark",
        honorific: "",
        entityName: "",
      }),
    ).rejects.toThrow(/boom/);

    expect(deleteDocumentDraft).toHaveBeenCalledWith(expect.anything(), "draft-1");
  });

  it("returns not-found when the matter is invisible under RLS", async () => {
    baseMocks({ matter: null });
    const { generateOpinionLetter } = await import("@/lib/documents/generate");

    await expect(
      generateOpinionLetter({
        matterId: "nope",
        upload: { bytes: new Uint8Array([1]), mime: "application/pdf", fileName: "report.pdf" },
        markType: "word mark",
        honorific: "",
        entityName: "",
      }),
    ).rejects.toThrow(/matter not found/i);
  });
});

describe("generateTrademarkClearance", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("checks the write role, builds the draft, queues it under 'trademark_clearance', and attaches the queue item id", async () => {
    const { requireDocumentWriteRole, createDocumentDraft, attachQueueItemId } = baseMocks({ matter });
    const { generateTrademarkClearance } = await import("@/lib/documents/generate");

    const result = await generateTrademarkClearance({
      matterId: "matter-1",
      filingBasis: "1(a) Use in Commerce",
      entityName: "",
      searchFindings: "No live federal registrations found in Class 25.",
    });

    expect(requireDocumentWriteRole).toHaveBeenCalledTimes(1);
    expect(createDocumentDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matterId: "matter-1", orgId: "org-1", docType: "trademark_clearance" }),
    );
    expect(attachQueueItemId).toHaveBeenCalledWith(expect.anything(), "draft-1", "queue-1");
    expect(result).toEqual({ draftId: "draft-1", queueItemId: "queue-1" });
  });

  it("refuses when the matter has no mark on file", async () => {
    baseMocks({ matter: { ...matter, mark_text: null } });
    const { generateTrademarkClearance } = await import("@/lib/documents/generate");

    await expect(
      generateTrademarkClearance({
        matterId: "matter-1",
        filingBasis: "1(a) Use in Commerce",
        entityName: "",
        searchFindings: "findings",
      }),
    ).rejects.toThrow(/no mark on file/i);
  });

  it("refuses when the search findings are blank — never invents a search result", async () => {
    baseMocks({ matter });
    const { generateTrademarkClearance } = await import("@/lib/documents/generate");

    await expect(
      generateTrademarkClearance({
        matterId: "matter-1",
        filingBasis: "1(a) Use in Commerce",
        entityName: "",
        searchFindings: "   ",
      }),
    ).rejects.toThrow(/preliminary search findings/i);
  });

  it("refuses when the firm has no approval queue configured", async () => {
    baseMocks({ matter, orgKey: null });
    const { generateTrademarkClearance } = await import("@/lib/documents/generate");

    await expect(
      generateTrademarkClearance({
        matterId: "matter-1",
        filingBasis: "1(a) Use in Commerce",
        entityName: "",
        searchFindings: "findings",
      }),
    ).rejects.toThrow(/approval queue/i);
  });

  it("returns not-found when the matter is invisible under RLS", async () => {
    baseMocks({ matter: null });
    const { generateTrademarkClearance } = await import("@/lib/documents/generate");

    await expect(
      generateTrademarkClearance({
        matterId: "nope",
        filingBasis: "1(a) Use in Commerce",
        entityName: "",
        searchFindings: "findings",
      }),
    ).rejects.toThrow(/matter not found/i);
  });
});

describe("generateTrademarkLoe / generateGeneralLoe", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("queues a trademark LOE draft against the matter's org", async () => {
    baseMocks({ matter });
    const { generateTrademarkLoe } = await import("@/lib/documents/generate");

    const result = await generateTrademarkLoe({
      matterId: "matter-1",
      variant: "current",
      clientName: "Jane Doe",
      entityName: null,
      markText: "SUNBEAM",
      packageName: "ESSENTIAL",
      benefitRowsText: "",
      classSelected: "Clothing",
      classCount: 1,
      amountPaid: "$1,950",
      amountPaidMath: null,
      sendDateIso: "2026-08-01",
    });

    expect(result).toEqual({ draftId: "draft-1", queueItemId: "queue-1" });
  });

  it("queues a general LOE draft against the matter's org", async () => {
    baseMocks({ matter });
    const { generateGeneralLoe } = await import("@/lib/documents/generate");

    const result = await generateGeneralLoe({
      matterId: "matter-1",
      clientName: "Jane Doe",
      entityName: null,
      scopeDescription: "Contract review",
      feeStructure: "hourly at $450/hr",
      depositStatedTerms: null,
      depositPercent: null,
      quotedAmount: null,
    });

    expect(result).toEqual({ draftId: "draft-1", queueItemId: "queue-1" });
  });
});
