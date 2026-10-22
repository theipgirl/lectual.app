import { describe, it, expect, vi, beforeEach } from "vitest";
import { STEP_TEXT } from "@/lib/proposals/step-text";
import { acceptedRow, PROPOSAL_ID } from "./paid-flow-harness";

/**
 * Retry for the engagement letter's Lawmatics upload: re-reads the STORED docx of this proposal's
 * queued letter from the documents bucket and uploads it again. Nothing is rendered here, and with
 * nothing stored it says so instead of making something up.
 */

type Over = {
  steps?: Array<Record<string, unknown>> | "fail";
  draft?: Record<string, unknown> | null;
  bytes?: Uint8Array | null;
  upload?: unknown;
  token?: unknown;
  matter?: unknown;
};

const QUEUED = { step: "loe_draft", outcome: "queued", queue_item_id: "queue-1" };
const STORED = { id: "draft-1", matter_id: "matter-1", status: "generated", storage_path: "org-1/matter-1/draft-1.docx", file_name: "Sevetri - LOE DRAFT.docx" };

async function setup(over: Over = {}) {
  vi.resetModules();
  const recordProposalStep = vi.fn(async () => true);
  const uploadMatterFile = vi.fn(async () => over.upload ?? { ok: true });
  const downloadStoredDocument = vi.fn(async () => (over.bytes === undefined ? new Uint8Array([0x50, 0x4b, 1, 2]) : over.bytes));
  const getDocumentDraftByQueueItemId = vi.fn(async () => (over.draft === undefined ? STORED : over.draft));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/documents/store", () => ({ downloadStoredDocument, getDocumentDraftByQueueItemId }));
  vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile }));
  vi.doMock("@/lib/proposals/store", () => ({
    getProposalRow: vi.fn(),
    recordProposalStep,
    listProposalStepEvents: vi.fn(async () => (over.steps === "fail" ? { ok: false } : { ok: true, events: (over.steps ?? [QUEUED]).map((payload) => ({ payload, created_at: "2026-10-21T16:00:00Z" })) })),
  }));
  vi.doMock("@/lib/proposals/lawmatics-access", async () => {
    const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
    return {
      ...actual,
      resolveProposalMatter: vi.fn(async () => over.matter ?? { status: "one", id: "matter-1", lawmaticsId: "LM-MATTER-1" }),
      signedInLawmaticsToken: vi.fn(async () => over.token ?? { status: "ok", token: "TOKEN-ORG-1" }),
    };
  });
  const mod = await import("@/lib/proposals/loe-upload");
  return { ...mod, recordProposalStep, uploadMatterFile, downloadStoredDocument, getDocumentDraftByQueueItemId };
}

beforeEach(() => vi.resetModules());

describe("retryLoeFileUpload", () => {
  it("uploads the stored docx again, with the stored file name, and records it", async () => {
    const t = await setup();
    const r = await t.retryLoeFileUpload(acceptedRow());
    expect(r).toEqual({ outcome: "uploaded", reason: null, recorded: true });
    expect(t.getDocumentDraftByQueueItemId).toHaveBeenCalledWith(expect.anything(), "queue-1");
    expect(t.downloadStoredDocument).toHaveBeenCalledWith(expect.anything(), "org-1/matter-1/draft-1.docx");
    const [token, file] = t.uploadMatterFile.mock.calls[0] as unknown as [string, { matterId: string; fileName: string; bytes: Uint8Array }];
    expect(token).toBe("TOKEN-ORG-1");
    expect(file).toMatchObject({ matterId: "LM-MATTER-1", fileName: "Sevetri - LOE DRAFT.docx" });
    expect(Array.from(file.bytes)).toEqual([0x50, 0x4b, 1, 2]);
    expect(t.recordProposalStep).toHaveBeenCalledWith(expect.objectContaining({ id: PROPOSAL_ID }), expect.objectContaining({ step: "loe_file_upload", outcome: "uploaded" }));
  });

  it("with no queued letter for this proposal it says so and makes no request", async () => {
    const t = await setup({ steps: [{ step: "loe_draft", outcome: "blocked", reason: "Open the matter to draft the LOE." }] });
    expect(await t.retryLoeFileUpload(acceptedRow())).toEqual({ outcome: "blocked", reason: STEP_TEXT.noDraftToRetry, recorded: false });
    expect(t.uploadMatterFile).not.toHaveBeenCalled();
  });

  it.each([
    ["not approved yet (the draft is still queued)", { draft: { ...STORED, status: "queued", storage_path: null } }],
    ["the draft row is gone", { draft: null }],
    ["the stored file can't be read back", { bytes: null }],
  ])("%s: 'no file to upload', no request, nothing written", async (_name, over) => {
    const t = await setup(over);
    expect(await t.retryLoeFileUpload(acceptedRow())).toEqual({ outcome: "blocked", reason: STEP_TEXT.noStoredLoe, recorded: false });
    expect(t.uploadMatterFile).not.toHaveBeenCalled();
    expect(t.recordProposalStep).not.toHaveBeenCalled();
  });

  it("an unreadable timeline is not 'no letter queued'", async () => {
    const t = await setup({ steps: "fail" });
    const r = await t.retryLoeFileUpload(acceptedRow());
    expect(r.outcome).toBe("blocked");
    expect(r.reason).toBe(STEP_TEXT.draftsUnreadable);
    expect(t.uploadMatterFile).not.toHaveBeenCalled();
  });

  it("a refused upload is recorded as failed, with the short reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup({ upload: { ok: false, reason: "HTTP 500", retryable: true, status: 500 } });
    expect(await t.retryLoeFileUpload(acceptedRow())).toEqual({ outcome: "failed", reason: "HTTP 500", recorded: true });
  });

  it("no active Lawmatics connection: nothing is sent", async () => {
    const t = await setup({ token: { status: "not_connected" } });
    const r = await t.retryLoeFileUpload(acceptedRow());
    expect(r).toMatchObject({ outcome: "blocked", reason: "Lawmatics isn't connected, so nothing was uploaded." });
    expect(t.uploadMatterFile).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setup();
    t.getDocumentDraftByQueueItemId.mockRejectedValueOnce(new Error("db down"));
    expect(await t.retryLoeFileUpload(acceptedRow())).toEqual({ outcome: "failed", reason: "unexpected error", recorded: false });
  });
});
