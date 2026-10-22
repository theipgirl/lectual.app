import { describe, it, expect, vi, beforeEach } from "vitest";

const draftRow = {
  id: "draft-1",
  org_id: "org-1",
  matter_id: "matter-1",
  doc_type: "opinion_letter" as const,
  queue_item_id: "queue-1",
  status: "queued" as const,
  payload: { clientName: "Jane Doe", markText: "SUNBEAM" },
  file_name: null,
  storage_path: null,
  error_message: null,
  generated_at: null,
  created_by: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

function mocks(overrides: {
  draft?: unknown;
  item?: unknown;
  renderThrows?: boolean;
  uploadError?: unknown;
} = {}) {
  const upload = vi.fn(async () => ({ error: overrides.uploadError ?? null }));
  const getScopedClient = vi.fn(async () => ({ storage: { from: () => ({ upload } as unknown) } }));
  const getQueueItem = vi.fn(async () => overrides.item ?? {
    id: "queue-1",
    type: "OPINION_LETTER",
    status: "approved",
    draft_body: "draft text",
    final_body: "final approved text",
  });
  const logActivity = vi.fn(async () => {});
  const renderDocumentDocx = vi.fn(async () => {
    if (overrides.renderThrows) throw new Error("docx render failed");
    return { buffer: Buffer.from("PK..."), fileName: "Jane Doe - Opinion Letter DRAFT - SUNBEAM.docx" };
  });
  const getDocumentDraftByQueueItemId = vi.fn(async () =>
    overrides.draft === undefined ? draftRow : overrides.draft,
  );
  const markDocumentGenerated = vi.fn(async () => {});
  const markDocumentFailed = vi.fn(async () => {});

  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient }));
  vi.doMock("@/lib/queue/api", () => ({ getQueueItem }));
  vi.doMock("@/lib/matters/activity", () => ({ logActivity }));
  vi.doMock("@/lib/documents/docx", () => ({ renderDocumentDocx }));
  vi.doMock("@/lib/documents/store", () => ({
    MATTER_DOCUMENTS_BUCKET: "matter-documents",
    getDocumentDraftByQueueItemId,
    markDocumentGenerated,
    markDocumentFailed,
  }));

  return { getQueueItem, logActivity, renderDocumentDocx, upload, markDocumentGenerated, markDocumentFailed, getDocumentDraftByQueueItemId };
}

describe("generateApprovedDocument", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("no-ops when the queue item isn't a Document Center draft", async () => {
    const { getQueueItem, markDocumentGenerated } = mocks({ draft: null });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(getQueueItem).not.toHaveBeenCalled();
    expect(markDocumentGenerated).not.toHaveBeenCalled();
  });

  it("no-ops when the approved item isn't an opinion-letter/LOE type", async () => {
    const { markDocumentGenerated } = mocks({ item: { id: "queue-1", type: "CLIENT_EMAIL", status: "approved" } });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(markDocumentGenerated).not.toHaveBeenCalled();
  });

  it("no-ops when the item isn't actually approved yet", async () => {
    const { markDocumentGenerated } = mocks({
      item: { id: "queue-1", type: "OPINION_LETTER", status: "pending" },
    });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(markDocumentGenerated).not.toHaveBeenCalled();
  });

  it("renders the FINAL (edited) body, not the original draft, when both are present", async () => {
    const { renderDocumentDocx, upload, markDocumentGenerated, logActivity } = mocks();
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(renderDocumentDocx).toHaveBeenCalledWith(draftRow, "final approved text");
    expect(upload).toHaveBeenCalledWith(
      "org-1/matter-1/draft-1.docx",
      expect.anything(),
      expect.objectContaining({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    expect(markDocumentGenerated).toHaveBeenCalledWith(
      expect.anything(),
      "draft-1",
      expect.objectContaining({ storagePath: "org-1/matter-1/draft-1.docx" }),
    );
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "document_generated", matterId: "matter-1" }),
    );
  });

  it("falls back to draft_body when there is no final_body (never edited)", async () => {
    const { renderDocumentDocx } = mocks({
      item: { id: "queue-1", type: "ENGAGEMENT_LETTER", status: "approved", draft_body: "original", final_body: null },
    });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(renderDocumentDocx).toHaveBeenCalledWith(draftRow, "original");
  });

  it("renders an approved TRADEMARK_CLEARANCE queue item too (third document type hooks the same as OPINION_LETTER/ENGAGEMENT_LETTER)", async () => {
    const { renderDocumentDocx, markDocumentGenerated } = mocks({
      draft: { ...draftRow, doc_type: "trademark_clearance" },
      item: {
        id: "queue-1",
        type: "TRADEMARK_CLEARANCE",
        status: "approved",
        draft_body: "draft text",
        final_body: "final approved text",
      },
    });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await generateApprovedDocument("rpb-law", "queue-1");

    expect(renderDocumentDocx).toHaveBeenCalledWith(
      expect.objectContaining({ doc_type: "trademark_clearance" }),
      "final approved text",
    );
    expect(markDocumentGenerated).toHaveBeenCalled();
  });

  it("marks the draft failed (never throws) when docx rendering errors", async () => {
    const { markDocumentFailed } = mocks({ renderThrows: true });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await expect(generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(markDocumentFailed).toHaveBeenCalledWith(
      expect.anything(),
      "draft-1",
      expect.stringContaining("docx render failed"),
    );
  });

  it("marks the draft failed (never throws) when the storage upload errors", async () => {
    const { markDocumentFailed } = mocks({ uploadError: new Error("bucket full") });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");

    await expect(generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(markDocumentFailed).toHaveBeenCalled();
  });

  it("never throws even when the scoped client itself blows up", async () => {
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: vi.fn(async () => {
        throw new Error("no session");
      }),
    }));
    vi.doMock("@/lib/queue/api", () => ({ getQueueItem: vi.fn() }));
    vi.doMock("@/lib/matters/activity", () => ({ logActivity: vi.fn() }));
    vi.doMock("@/lib/documents/docx", () => ({ renderDocumentDocx: vi.fn() }));
    vi.doMock("@/lib/documents/store", () => ({
      MATTER_DOCUMENTS_BUCKET: "matter-documents",
      getDocumentDraftByQueueItemId: vi.fn(async () => draftRow),
      markDocumentGenerated: vi.fn(),
      markDocumentFailed: vi.fn(),
    }));

    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await expect(generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
  });
});

/**
 * Sprint 19: an engagement letter born from an accepted proposal (its draft payload carries
 * proposalId) is uploaded to the matter's Lawmatics record, but only after a person approved the
 * queue item and the docx was stored. Nothing else uploads, and an upload can't change the approval.
 */
describe("generateApprovedDocument: the proposal-born LOE upload", () => {
  const PROPOSAL = "44444444-4444-4444-8444-444444444444";
  const loeDraft = { ...draftRow, doc_type: "loe_trademark_current" as const, payload: { clientName: "Sevetri Wilson", proposalId: PROPOSAL } };
  const approvedLoe = { id: "queue-1", type: "ENGAGEMENT_LETTER", status: "approved", draft_body: "chart", final_body: "reviewed chart" };

  function uploadMocks(over: { draft?: unknown; item?: unknown; renderThrows?: boolean; uploadError?: unknown; uploadResult?: unknown; proposal?: unknown; matter?: unknown; token?: unknown; recordOk?: boolean } = {}) {
    const base = mocks({ draft: over.draft ?? loeDraft, item: over.item ?? approvedLoe, renderThrows: over.renderThrows, uploadError: over.uploadError });
    const uploadMatterFile = vi.fn(async () => over.uploadResult ?? { ok: true });
    const getProposalRow = vi.fn(async () => (over.proposal === undefined ? { id: PROPOSAL, org_id: "org-1", matter_id: "matter-1", lead_id: null } : over.proposal));
    const recordProposalStep = vi.fn(async () => over.recordOk ?? true);
    vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile }));
    vi.doMock("@/lib/proposals/store", () => ({ getProposalRow, recordProposalStep, listProposalStepEvents: vi.fn() }));
    vi.doMock("@/lib/proposals/lawmatics-access", async () => {
      const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
      return {
        ...actual,
        resolveProposalMatter: vi.fn(async () => over.matter ?? { status: "one", id: "matter-1", lawmaticsId: "LM-MATTER-1" }),
        signedInLawmaticsToken: vi.fn(async () => over.token ?? { status: "ok", token: "TOKEN-ORG-1" }),
      };
    });
    return { ...base, uploadMatterFile, getProposalRow, recordProposalStep };
  }

  beforeEach(() => vi.resetModules());

  it("uploads the stored docx to the matter's Lawmatics id with the firm's token, after the file is stored", async () => {
    const m = uploadMocks();
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await generateApprovedDocument("rpb-law", "queue-1");

    expect(m.markDocumentGenerated).toHaveBeenCalled();
    expect(m.uploadMatterFile).toHaveBeenCalledTimes(1);
    const [token, file] = m.uploadMatterFile.mock.calls[0] as unknown as [string, { matterId: string; fileName: string; mime: string; bytes: Uint8Array }];
    expect(token).toBe("TOKEN-ORG-1");
    expect(file).toMatchObject({ matterId: "LM-MATTER-1", fileName: "Jane Doe - Opinion Letter DRAFT - SUNBEAM.docx" });
    expect(file.mime).toContain("wordprocessingml");
    // Stored first, uploaded second.
    expect(m.markDocumentGenerated.mock.invocationCallOrder[0]).toBeLessThan(m.uploadMatterFile.mock.invocationCallOrder[0]);
    // The outcome is a line on the proposal's timeline.
    expect(m.recordProposalStep).toHaveBeenCalledWith(expect.objectContaining({ id: PROPOSAL }), expect.objectContaining({ step: "loe_file_upload", outcome: "uploaded", draft_id: "draft-1" }));
  });

  it.each([
    ["still pending", { id: "queue-1", type: "ENGAGEMENT_LETTER", status: "pending", draft_body: "x" }],
    ["rejected", { id: "queue-1", type: "ENGAGEMENT_LETTER", status: "rejected", draft_body: "x" }],
  ])("a queue item that is %s uploads nothing", async (_name, item) => {
    const m = uploadMocks({ item });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await generateApprovedDocument("rpb-law", "queue-1");
    expect(m.uploadMatterFile).not.toHaveBeenCalled();
    expect(m.recordProposalStep).not.toHaveBeenCalled();
    expect(m.getProposalRow).not.toHaveBeenCalled();
  });

  it("an ordinary opinion letter or a non-proposal LOE makes no upload request", async () => {
    for (const draft of [draftRow, { ...draftRow, doc_type: "loe_trademark_current" as const, payload: { clientName: "Jane Doe" } }, { ...draftRow, payload: { proposalId: 42 } }]) {
      vi.resetModules();
      const m = uploadMocks({ draft, item: draft === draftRow ? undefined : approvedLoe });
      const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
      await generateApprovedDocument("rpb-law", "queue-1");
      expect(m.uploadMatterFile).not.toHaveBeenCalled();
      expect(m.recordProposalStep).not.toHaveBeenCalled();
    }
  });

  it("nothing uploads when the docx was not stored (render or storage failure)", async () => {
    for (const over of [{ renderThrows: true }, { uploadError: new Error("bucket full") }]) {
      vi.resetModules();
      const m = uploadMocks(over);
      const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
      await generateApprovedDocument("rpb-law", "queue-1");
      expect(m.uploadMatterFile).not.toHaveBeenCalled();
    }
  });

  it("an upload failure never changes the stored document or the approval; the outcome goes on the proposal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = uploadMocks({ uploadResult: { ok: false, reason: "HTTP 422", retryable: false, status: 422 } });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await expect(generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(m.markDocumentGenerated).toHaveBeenCalledTimes(1);
    expect(m.markDocumentFailed).not.toHaveBeenCalled();
    expect(m.recordProposalStep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ step: "loe_file_upload", outcome: "failed", reason: "HTTP 422" }));
  });

  it("a throwing upload, a throwing proposal read and a failing timeline write are all contained", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = uploadMocks();
    throwing.uploadMatterFile.mockRejectedValueOnce(new Error("socket hang up"));
    const hook1 = await import("@/lib/documents/approve-hook");
    await expect(hook1.generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(throwing.markDocumentFailed).not.toHaveBeenCalled();

    vi.resetModules();
    const noProposal = uploadMocks();
    noProposal.getProposalRow.mockRejectedValueOnce(new Error("db down"));
    const hook2 = await import("@/lib/documents/approve-hook");
    await expect(hook2.generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(noProposal.uploadMatterFile).not.toHaveBeenCalled();
    expect(noProposal.markDocumentFailed).not.toHaveBeenCalled();

    vi.resetModules();
    const noLine = uploadMocks({ recordOk: false });
    const hook3 = await import("@/lib/documents/approve-hook");
    await expect(hook3.generateApprovedDocument("rpb-law", "queue-1")).resolves.toBeUndefined();
    expect(noLine.markDocumentFailed).not.toHaveBeenCalled();
  });

  it.each([
    ["no active Lawmatics connection", { token: { status: "not_connected" } }, "Lawmatics isn't connected, so nothing was uploaded."],
    ["a matter not linked to Lawmatics", { matter: { status: "one", id: "matter-1", lawmaticsId: null } }, "This matter isn't linked to Lawmatics yet."],
    ["no matter", { matter: { status: "none" } }, "There is no matter yet, so nothing was uploaded. Open the matter first."],
  ])("%s: no request, and the reason is on the timeline", async (_name, over, reason) => {
    const m = uploadMocks(over);
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await generateApprovedDocument("rpb-law", "queue-1");
    expect(m.uploadMatterFile).not.toHaveBeenCalled();
    expect(m.recordProposalStep).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ step: "loe_file_upload", outcome: "blocked", reason }));
  });

  it("another firm's proposal id (not visible to this firm) uploads nothing and writes nothing", async () => {
    const m = uploadMocks({ proposal: null });
    const { generateApprovedDocument } = await import("@/lib/documents/approve-hook");
    await generateApprovedDocument("rpb-law", "queue-1");
    expect(m.uploadMatterFile).not.toHaveBeenCalled();
    expect(m.recordProposalStep).not.toHaveBeenCalled();
  });
});
