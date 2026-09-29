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
