import { describe, expect, it, vi } from "vitest";
import type { AcceptedSnapshot } from "@/lib/proposals/types";

vi.mock("next/server", () => ({ after: () => {} }));

/** T17, the staff Try again path (`paid-flow.ts`): a link-signed letter's filing is recorded `failed` and nothing is uploaded. */
describe("T17 paid-flow: Try again of signed_loe_upload for a link signature", () => {
  it("records failed and uploads nothing until Sprint B's certificate exists", async () => {
    vi.resetModules();
    const { signedTrademark, acceptedProposalRow } = await import("../signed-fixtures");
    const base = signedTrademark();
    const snapshot: AcceptedSnapshot = { ...base, agreement: { ...base.agreement!, method: "email_link", signing_request_id: "r-1" } };
    const proposal = acceptedProposalRow(snapshot);
    const recorded: Array<Record<string, unknown>> = [];
    const all: Array<Record<string, unknown>> = [
      { proposal_id: proposal.id, type: "edited", actor: "system", actor_user_id: null, created_at: "2026-11-12T19:15:00.000Z", payload: { step: "signed_loe_upload", outcome: "failed", reason: "HTTP 422" } },
    ];
    const uploadMatterFile = vi.fn(async () => ({ ok: true }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalRow: vi.fn(async () => proposal),
      listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [...all].reverse() })),
      recordProposalStep: vi.fn(async (_p: unknown, payload: Record<string, unknown>) => {
        recorded.push(payload);
        return true;
      }),
      getProposalSettings: vi.fn(async () => ({ pricing: {} })),
    }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => true) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/documents/generate", () => ({ generateTrademarkLoe: vi.fn() }));
    vi.doMock("@/lib/documents/store", () => ({ listDraftsForProposal: vi.fn(async () => []) }));
    vi.doMock("@/lib/loe/staff-firm", () => ({ loadStaffFirmFacts: vi.fn(async () => ({ status: "ok", displayName: "Sample Firm", timeZone: "America/New_York" })) }));
    vi.doMock("@/lib/proposals/lawmatics-access", async () => {
      const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
      return { ...actual, signedInLawmaticsToken: vi.fn(async () => ({ status: "ok", token: "SIGNED-IN-TOKEN" })), resolveProposalMatter: vi.fn() };
    });
    vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile, setProspectCustomFields: vi.fn() }));
    vi.doMock("@/lib/proposals/accept-followups", () => ({
      addAcceptanceNote: vi.fn(),
      resolveNoteTarget: vi.fn(async () => ({ ok: true, notableType: "Prospect", notableId: "LM-77" })),
    }));
    vi.doMock("@/lib/proposals/loe-upload", () => ({ retryLoeFileUpload: vi.fn() }));
    const flow = await import("@/lib/proposals/paid-flow");
    await flow.retryProposalStep(proposal.id, "signed_loe_upload");
    expect(uploadMatterFile).not.toHaveBeenCalled();
    expect(recorded.map((r) => `${r.step}:${r.outcome}`)).toEqual(["signed_loe_upload:failed"]);
  });
});
