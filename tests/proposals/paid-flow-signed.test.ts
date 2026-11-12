import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPOSAL_ID, acceptedRow, setupFlow } from "./paid-flow-harness";
import { acceptedSnapshot } from "./accepted-fixture";
import { signedTrademark } from "../loe/signed-fixtures";

afterEach(() => vi.restoreAllMocks());

/** P4a: Mark paid on a SIGNED version. The letter was signed on the proposal page, so there is nothing to draft. */

describe("Mark paid on a signed version", () => {
  it("records the old LOE-draft step as skipped, never calls generateTrademarkLoe and queues no ENGAGEMENT_LETTER item", async () => {
    const t = await setupFlow({ proposal: acceptedRow({}, signedTrademark()) });
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(r.ok).toBe(true);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(t.latest("loe_draft")).toMatchObject({ step: "loe_draft", outcome: "skipped", reason: "Signed on the proposal page" });
    // Decided before the module check, the matter lookup, the adapter and the drafts read.
    expect(t.spies.orgHasModule).not.toHaveBeenCalledWith("document-center");
    expect(t.spies.listDraftsForProposal).not.toHaveBeenCalled();
    expect(t.spies.retryLoeFileUpload).not.toHaveBeenCalled();
  });

  it("still uploads the accepted-proposal document, and still runs the custom fields when the firm turned them on", async () => {
    const t = await setupFlow({
      proposal: acceptedRow({}, signedTrademark()),
      settings: { pricing: { lawmatics_loe_fields: { enabled: true, map: {} } } },
    });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.stepsRecorded()).toContain("accepted_file_upload:uploaded");
    expect(t.stepsRecorded()[0]).toBe("paid_marked:marked");
    expect(t.stepsRecorded()).toContain("loe_draft:skipped");
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
  });

  it("the skipped line is the same with the Document Center off (it never asks)", async () => {
    const t = await setupFlow({ proposal: acceptedRow({}, signedTrademark()), modules: ["proposals"] });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.latest("loe_draft")).toMatchObject({ outcome: "skipped" });
  });

  it("an accepted version with no letter behaves exactly as before: the draft is queued", async () => {
    const t = await setupFlow({ proposal: acceptedRow({}, acceptedSnapshot({ classes: 2 })) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(1);
    expect(t.stepsRecorded()).toEqual(["paid_marked:marked", "loe_draft:queued", "accepted_file_upload:uploaded"]);
  });
});
