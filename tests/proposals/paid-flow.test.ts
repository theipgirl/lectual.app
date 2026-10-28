import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { LOE_REFUSAL_TEXT } from "@/lib/proposals/loe-adapter";
import { STEP_TEXT } from "@/lib/proposals/step-text";
import { acceptedSnapshot, CONCIERGE } from "./accepted-fixture";
import { PROPOSAL_ID, acceptedRow, setupFlow } from "./paid-flow-harness";

afterEach(() => vi.restoreAllMocks());

const withFields = (map: Record<string, string>, enabled = true) => ({
  pricing: { packages: [CONCIERGE], lawmatics_loe_fields: { enabled, map } },
});
const ALL_SIX = {
  "LOE Package": "301",
  "LOE Fee Chart": "302",
  "LOE Classes": "303",
  "LOE Legal Fee": "304",
  "LOE USPTO Fees": "305",
  "LOE Signature Deadline": "306",
};

describe("markProposalPaid: the happy path", () => {
  it("writes the paid mark first, then the LOE draft and the accepted-proposal upload, in that order", async () => {
    const t = await setupFlow();
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(r.ok).toBe(true);
    expect(t.stepsRecorded()).toEqual(["paid_marked:marked", "loe_draft:queued", "accepted_file_upload:uploaded"]);
  });

  it("queues the engagement letter through generateTrademarkLoe once, for the matter, marked with the proposal id", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(1);
    const [input] = t.spies.generateTrademarkLoe.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(input).toMatchObject({
      matterId: "matter-1",
      proposalId: PROPOSAL_ID,
      variant: "current",
      packageName: "Concierge",
      clientName: "Sevetri Wilson",
      entityName: "Prosperall",
      markText: "Prosperall",
      classCount: 2,
    });
    expect(t.latest("loe_draft")).toMatchObject({ outcome: "queued", queue_item_id: "queue-1", draft_id: "draft-1" });
  });

  it("uploads the accepted-proposal docx to the matter's Lawmatics id with the firm's token", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
    const [token, file] = t.spies.uploadMatterFile.mock.calls[0] as unknown as [string, { matterId: string; fileName: string; mime: string; bytes: Uint8Array }];
    expect(token).toBe("TOKEN-ORG-1");
    expect(file).toMatchObject({ matterId: "LM-MATTER-1", fileName: "Sevetri Wilson - Accepted Proposal.docx" });
    expect(file.mime).toContain("wordprocessingml");
    expect(Buffer.from(file.bytes.subarray(0, 2)).toString()).toBe("PK");
  });

  it("with the LOE fields setting absent, makes no PUT and leaves no custom_fields line", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).not.toHaveBeenCalled();
    expect(t.recorded.map((p) => p.step)).not.toContain("custom_fields");
  });

  it("never calls anything that sends, moves a stage or opens a matter (source assertion)", () => {
    const source = ["paid-flow.ts", "paid-view.ts", "loe-upload.ts", "accept-followups.ts", "lawmatics-access.ts", "loe-adapter.ts", "loe-fields.ts", "paid.ts", "step-text.ts"]
      .map((f) => readFileSync(`src/lib/proposals/${f}`, "utf8"))
      .join("\n");
    const actions = readFileSync("src/app/dashboard/proposals/[id]/paid-actions.ts", "utf8");
    // Built from pieces so this list is not itself a hit for the same words.
    const w = (...parts: string[]) => parts.join("");
    const banned = [w("send", "Mail"), w("Mail", ".Send"), w("move", "LeadStage"), w("stage", "_id"), w("Pending", " LOE"), w("send", "Message"), w("open", "Matter"), w("create", "Matter"), w("e", "sign")];
    for (const word of banned) {
      expect(source, word).not.toContain(word);
      expect(actions, word).not.toContain(word);
    }
    expect(source).not.toMatch(new RegExp(`${w("db/", "admin")}|${w("getAdmin", "Client")}\\(`));
    expect(source).not.toMatch(new RegExp(w("\\/", "send", "\\b")));
  });
});

describe("markProposalPaid: refusals write nothing", () => {
  it("another firm's (or a malformed) proposal is 'Proposal not found.'", async () => {
    const t = await setupFlow({ proposal: null });
    expect(await t.flow.markProposalPaid(PROPOSAL_ID)).toEqual({ ok: false, error: "Proposal not found." });
    expect(t.recorded).toEqual([]);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(t.spies.uploadMatterFile).not.toHaveBeenCalled();
  });

  it.each(["draft", "approved", "sent", "superseded", "withdrawn"] as const)("a %s version cannot be marked paid", async (status) => {
    const t = await setupFlow({ proposal: acceptedRow({ status }) });
    expect(await t.flow.markProposalPaid(PROPOSAL_ID)).toEqual({ ok: false, error: "Only an accepted proposal can be marked paid." });
    expect(t.recorded).toEqual([]);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("an accepted row with no snapshot cannot be marked paid either", async () => {
    const t = await setupFlow({ proposal: acceptedRow({ accepted_snapshot: null }) });
    expect((await t.flow.markProposalPaid(PROPOSAL_ID)).ok).toBe(false);
    expect(t.recorded).toEqual([]);
  });

  it("a failed proposal read and a failed events read are their own sentences, and write nothing", async () => {
    const down = await setupFlow({ proposal: "throw" });
    expect(await down.flow.markProposalPaid(PROPOSAL_ID)).toEqual({ ok: false, error: "Couldn't load the proposal. Try again shortly." });
    const blind = await setupFlow({ eventsRead: "fail" });
    const r = await blind.flow.markProposalPaid(PROPOSAL_ID);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("Paid status couldn't be read");
    expect(blind.recorded).toEqual([]);
    expect(blind.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("when the paid mark itself can't be saved, nothing else runs", async () => {
    const t = await setupFlow({ recordFails: ["paid_marked"] });
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(r).toMatchObject({ ok: false });
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(t.spies.uploadMatterFile).not.toHaveBeenCalled();
  });
});

describe("idempotent per accepted version", () => {
  it("marking an already-paid version again writes nothing and reruns nothing", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    const before = t.recorded.length;
    const again = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(again).toMatchObject({ ok: true, alreadyPaid: true, reports: [] });
    expect(t.recorded).toHaveLength(before);
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(1);
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
  });

  it("undo then mark again: one LOE draft and one upload in total, and the second attempt says the draft is already queued", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(await t.flow.undoProposalPaid(PROPOSAL_ID)).toMatchObject({ ok: true });
    const second = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(second).toMatchObject({ ok: true });
    expect((second as { notes: string[] }).notes).toContain("An engagement letter draft is already in the queue for this proposal.");
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(1);
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
    expect(t.stepsRecorded().filter((s) => s === "paid_marked:marked")).toHaveLength(2);
    expect(t.stepsRecorded().filter((s) => s === "loe_draft:queued")).toHaveLength(1);
  });

  it("a draft already on the matter (its timeline line never landed) is not created again, and the line is written", async () => {
    const t = await setupFlow({ drafts: [{ id: "draft-old", queue_item_id: "queue-old", status: "queued" }] });
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect((r as { notes: string[] }).notes).toContain(STEP_TEXT.alreadyQueued);
    expect(t.latest("loe_draft")).toMatchObject({ outcome: "queued", queue_item_id: "queue-old" });
  });

  it("a page reload (a fresh run over the same timeline) creates nothing new", async () => {
    const first = await setupFlow();
    await first.flow.markProposalPaid(PROPOSAL_ID);
    const t = await setupFlow({
      events: [
        { payload: { step: "paid_marked", outcome: "marked" } },
        { payload: { step: "loe_draft", outcome: "queued", queue_item_id: "queue-1" } },
        { payload: { step: "accepted_file_upload", outcome: "uploaded" } },
      ],
    });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(t.spies.uploadMatterFile).not.toHaveBeenCalled();
  });

  it("a failed upload is retried by Retry; a successful one is not repeated", async () => {
    const t = await setupFlow({ upload: { ok: false, reason: "HTTP 500", retryable: true, status: 500 } });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.latest("accepted_file_upload")).toMatchObject({ outcome: "failed", reason: "HTTP 500" });
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
    const retry = await t.flow.retryProposalStep(PROPOSAL_ID, "accepted_file_upload");
    expect(retry).toMatchObject({ ok: true });
    expect(t.spies.uploadMatterFile).toHaveBeenCalledTimes(2);

    const ok = await setupFlow();
    await ok.flow.markProposalPaid(PROPOSAL_ID);
    const again = await ok.flow.retryProposalStep(PROPOSAL_ID, "accepted_file_upload");
    expect((again as { notes: string[] }).notes).toEqual([STEP_TEXT.alreadyUploaded]);
    expect(ok.spies.uploadMatterFile).toHaveBeenCalledTimes(1);
  });
});

describe("the LOE draft step: blocked and failed, never silent", () => {
  const draftLine = (t: Awaited<ReturnType<typeof setupFlow>>) => t.latest("loe_draft")!;

  it("no matter: no draft, the queue is not called, 'Open the matter to draft the LOE.'", async () => {
    const t = await setupFlow({ matter: { status: "none" } });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", reason: "Open the matter to draft the LOE." });
    expect(t.spies.resolveProposalMatter).toBeDefined();
  });

  it("two matters: no draft and the 'more than one matter' sentence (never picked)", async () => {
    const t = await setupFlow({ matter: { status: "many" } });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", reason: "More than one matter is linked to this client. Draft the LOE from the right matter." });
  });

  it("an unreadable matter lookup is a failure with its own sentence", async () => {
    const t = await setupFlow({ matter: { status: "unreadable" } });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "failed", reason: STEP_TEXT.mattersUnreadable });
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("Document Center off: 'Document Center isn't switched on for this firm.'", async () => {
    const t = await setupFlow({ modules: ["proposals"] });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", reason: "Document Center isn't switched on for this firm." });
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("an unknown package: no draft, flagged for 'Choose the LOE template'", async () => {
    const t = await setupFlow({ proposal: acceptedRow({}, acceptedSnapshot({ packageName: "Platinum" })) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", code: "unknown_package", reason: LOE_REFUSAL_TEXT.unknown_package });
  });

  it("an unknown package with the matter found through the lead: the line carries the matter id and no draft is made", async () => {
    const t = await setupFlow({
      proposal: acceptedRow({ lead_id: "lead-1", matter_id: null }, acceptedSnapshot({ packageName: "Platinum" })),
      matter: { status: "one", id: "matter-from-lead", lawmaticsId: "LM-1" },
    });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", code: "unknown_package", matter_id: "matter-from-lead" });
  });

  it("an unknown package with no single matter carries no matter id", async () => {
    const t = await setupFlow({
      proposal: acceptedRow({ lead_id: "lead-1", matter_id: null }, acceptedSnapshot({ packageName: "Platinum" })),
      matter: { status: "many" },
    });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", code: "unknown_package" });
    expect(draftLine(t)).not.toHaveProperty("matter_id");
  });

  it("an unreadable package list is its own state, not 'unknown package'", async () => {
    const t = await setupFlow({ settings: "fail" });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", code: "package_list_unreadable" });
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("two accepted brands: 'draft each engagement letter from the LOE form'", async () => {
    const t = await setupFlow({ proposal: acceptedRow({}, acceptedSnapshot({ brands: ["p", "t"] })) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", code: "multiple_brands", reason: "More than one brand was accepted. Draft each engagement letter from the LOE form." });
  });

  it("no queue configured: the DocumentFlowError sentence is shown as it is", async () => {
    const t = await setupFlow({ generate: "flow-error" });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "blocked", reason: expect.stringContaining("Approvals aren't switched on for your firm yet") });
  });

  it("any other error shows a fixed sentence, never the raw text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setupFlow({ generate: "other-error" });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "failed", reason: STEP_TEXT.draftFailed });
    expect(JSON.stringify(t.recorded)).not.toContain("sevetri@example.com");
    expect(JSON.stringify(t.recorded)).not.toContain("duplicate key");
  });

  it("an unreadable drafts lookup creates nothing", async () => {
    const t = await setupFlow({ drafts: null });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(draftLine(t)).toMatchObject({ outcome: "failed", reason: STEP_TEXT.draftsUnreadable });
    expect(t.spies.generateTrademarkLoe).not.toHaveBeenCalled();
  });

  it("Retry after the blocker is fixed drafts the letter once", async () => {
    const blocked = await setupFlow({ matter: { status: "none" } });
    await blocked.flow.markProposalPaid(PROPOSAL_ID);
    expect(blocked.spies.generateTrademarkLoe).not.toHaveBeenCalled();
    // The matter now exists: a fresh run over the same timeline.
    const t = await setupFlow({ events: [{ payload: { step: "paid_marked", outcome: "marked" } }, { payload: { step: "loe_draft", outcome: "blocked", reason: "Open the matter to draft the LOE." } }] });
    const r = await t.flow.retryProposalStep(PROPOSAL_ID, "loe_draft");
    expect(r).toMatchObject({ ok: true });
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(1);
    expect(t.latest("loe_draft")).toMatchObject({ outcome: "queued" });
  });
});

describe("independent steps", () => {
  it("a failed LOE step does not stop the paid mark, the upload or the custom fields", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setupFlow({ generate: "other-error", settings: withFields(ALL_SIX) });
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(r.ok).toBe(true);
    expect(t.stepsRecorded()).toEqual(["paid_marked:marked", "loe_draft:failed", "accepted_file_upload:uploaded", "custom_fields:written"]);
  });

  it("a failed upload does not stop the LOE draft or the custom fields", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setupFlow({ upload: { ok: false, reason: "HTTP 422", retryable: false, status: 422 }, settings: withFields(ALL_SIX) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.stepsRecorded()).toEqual(["paid_marked:marked", "loe_draft:queued", "accepted_file_upload:failed", "custom_fields:written"]);
  });

  it("a step that throws is recorded as failed with a fixed sentence, and the next still runs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await setupFlow();
    t.spies.listDraftsForProposal.mockRejectedValueOnce(new Error("boom for sevetri@example.com"));
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.stepsRecorded()).toEqual(["paid_marked:marked", "loe_draft:failed", "accepted_file_upload:uploaded"]);
    expect(JSON.stringify(t.recorded)).not.toContain("sevetri@example.com");
  });

  it("a timeline line that fails to save is reported on the step", async () => {
    const t = await setupFlow({ recordFails: ["loe_draft"] });
    const r = await t.flow.markProposalPaid(PROPOSAL_ID);
    const report = (r as { reports: Array<{ step: string; recorded: boolean }> }).reports.find((x) => x.step === "loe_draft")!;
    expect(report.recorded).toBe(false);
  });
});

describe("the accepted-proposal upload: where it stops", () => {
  it.each([
    ["no matter", { matter: { status: "none" } as const }, "There is no matter yet, so nothing was uploaded. Open the matter first."],
    ["two matters", { matter: { status: "many" } as const }, "More than one matter is linked to this client, so nothing was uploaded."],
    ["a matter not linked to Lawmatics", { matter: { status: "one", id: "matter-1", lawmaticsId: null } as const }, "This matter isn't linked to Lawmatics yet."],
    ["no active connection", { token: { status: "not_connected" } as const }, "Lawmatics isn't connected, so nothing was uploaded."],
    ["an unreadable connection", { token: { status: "unavailable" } as const }, "Couldn't check the Lawmatics connection, so nothing was uploaded."],
  ])("%s: no request, and the reason is on the timeline", async (_name, opts, reason) => {
    const t = await setupFlow(opts);
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.uploadMatterFile).not.toHaveBeenCalled();
    expect(t.latest("accepted_file_upload")).toMatchObject({ outcome: "blocked", reason });
  });
});

describe("the LOE fields (stretch), off by default", () => {
  it("off, absent and `enabled: false` each make no request and leave no line", async () => {
    for (const settings of [undefined, { pricing: { packages: [CONCIERGE] } }, withFields(ALL_SIX, false)]) {
      const t = await setupFlow({ settings });
      await t.flow.markProposalPaid(PROPOSAL_ID);
      expect(t.spies.setProspectCustomFields).not.toHaveBeenCalled();
      expect(t.recorded.map((p) => p.step)).not.toContain("custom_fields");
    }
  });

  it("unreadable settings keep it inert too", async () => {
    const t = await setupFlow({ settings: "fail" });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).not.toHaveBeenCalled();
  });

  it("on and fully mapped: one PUT with the six values from the same adapter output as the draft", async () => {
    const t = await setupFlow({ settings: withFields(ALL_SIX) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).toHaveBeenCalledTimes(1);
    const [token, prospectId, writes] = t.spies.setProspectCustomFields.mock.calls[0] as unknown as [string, string, Array<{ id: string; value: string }>];
    expect(token).toBe("TOKEN-ORG-1");
    expect(prospectId).toBe("LM-MATTER-1");
    expect(writes.map((w) => w.id)).toEqual(["301", "302", "303", "304", "305", "306"]);
    const [input] = t.spies.generateTrademarkLoe.mock.calls[0] as unknown as [{ amountPaid: string; govFeesText: string; classSelected: string; benefitRowsText: string }];
    const byId = Object.fromEntries(writes.map((w) => [w.id, w.value]));
    expect(byId["301"]).toBe("Concierge");
    expect(byId["302"]).toContain(input.benefitRowsText.split("\n")[0]);
    expect(byId["303"]).toBe(input.classSelected);
    expect(byId["304"]).toBe(input.amountPaid);
    expect(byId["305"]).toBe(input.govFeesText);
    expect(byId["306"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Legal and USPTO stay two fields: no value carries their sum.
    const snapshot = acceptedSnapshot({ classes: 2 });
    const sum = snapshot.quote.legal_total_cents + snapshot.quote.gov_total_cents;
    expect(JSON.stringify(writes)).not.toContain(`$${(sum / 100).toLocaleString("en-US")}`);
  });

  it("partly mapped: only the mapped names are written, and the rest are named as skipped", async () => {
    const t = await setupFlow({ settings: withFields({ "LOE Package": "301", "LOE Legal Fee": "304" }) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    const writes = (t.spies.setProspectCustomFields.mock.calls[0] as unknown as unknown[])[2] as Array<{ id: string }>;
    expect(writes.map((w) => w.id)).toEqual(["301", "304"]);
    expect(t.latest("custom_fields")).toMatchObject({ outcome: "written", reason: expect.stringContaining("LOE Fee Chart") });
  });

  it("on with no mapping at all does nothing and says so", async () => {
    const t = await setupFlow({ settings: withFields({}) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).not.toHaveBeenCalled();
    expect(t.latest("custom_fields")).toMatchObject({ outcome: "skipped", reason: STEP_TEXT.fieldsNoMapping });
  });

  it("works with the LOE draft blocked and without the document-center module", async () => {
    const t = await setupFlow({ settings: withFields(ALL_SIX), modules: ["proposals"] });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.latest("loe_draft")).toMatchObject({ outcome: "blocked" });
    expect(t.spies.setProspectCustomFields).toHaveBeenCalledTimes(1);
  });

  it("one successful write per version; a failure can be retried", async () => {
    const t = await setupFlow({ settings: withFields(ALL_SIX) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    await t.flow.undoProposalPaid(PROPOSAL_ID);
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).toHaveBeenCalledTimes(1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = await setupFlow({ settings: withFields(ALL_SIX), fields: { ok: false, reason: "HTTP 500", retryable: true } });
    await bad.flow.markProposalPaid(PROPOSAL_ID);
    expect(bad.latest("custom_fields")).toMatchObject({ outcome: "failed", reason: "HTTP 500" });
    await bad.flow.retryProposalStep(PROPOSAL_ID, "custom_fields");
    expect(bad.spies.setProspectCustomFields).toHaveBeenCalledTimes(2);
  });

  it("the write is blocked, not attempted, when the matter has no Lawmatics id", async () => {
    const t = await setupFlow({ settings: withFields(ALL_SIX), matter: { status: "one", id: "matter-1", lawmaticsId: null } });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    expect(t.spies.setProspectCustomFields).not.toHaveBeenCalled();
    expect(t.latest("custom_fields")).toMatchObject({ outcome: "blocked", reason: STEP_TEXT.matterNotLinked });
  });
});

describe("undoProposalPaid", () => {
  it("is refused when the version is not paid, and writes nothing", async () => {
    const t = await setupFlow();
    expect(await t.flow.undoProposalPaid(PROPOSAL_ID)).toEqual({ ok: false, error: "This proposal isn't marked paid." });
    expect(t.recorded).toEqual([]);
  });

  it("writes paid_undone, says the queued letter stays, and deletes or withdraws nothing", async () => {
    const t = await setupFlow();
    await t.flow.markProposalPaid(PROPOSAL_ID);
    const calls = t.spies.generateTrademarkLoe.mock.calls.length;
    const r = await t.flow.undoProposalPaid(PROPOSAL_ID);
    expect(r).toMatchObject({ ok: true, notes: ["The engagement letter draft, if one was queued, stays in the approval queue."] });
    expect(t.latest("paid_undone")).toMatchObject({ outcome: "undone" });
    expect(t.spies.generateTrademarkLoe).toHaveBeenCalledTimes(calls);
  });

  it("is refused for a non-accepted or foreign proposal", async () => {
    expect(await (await setupFlow({ proposal: null })).flow.undoProposalPaid(PROPOSAL_ID)).toEqual({ ok: false, error: "Proposal not found." });
    expect(await (await setupFlow({ proposal: acceptedRow({ status: "sent" }) })).flow.undoProposalPaid(PROPOSAL_ID)).toMatchObject({ ok: false });
  });
});

describe("retryProposalStep", () => {
  it("is refused while the version isn't paid", async () => {
    const t = await setupFlow();
    expect(await t.flow.retryProposalStep(PROPOSAL_ID, "loe_draft")).toEqual({ ok: false, error: "Mark the proposal paid first." });
  });

  it("retries a failed Lawmatics note over the signed-in token, once", async () => {
    const t = await setupFlow({
      events: [
        { payload: { step: "paid_marked", outcome: "marked" } },
        { payload: { step: "lawmatics_note", outcome: "blocked", reason: "no Lawmatics record found" }, actor: "system", actor_user_id: null },
      ],
    });
    const r = await t.flow.retryProposalStep(PROPOSAL_ID, "lawmatics_note");
    expect(r).toMatchObject({ ok: true });
    expect(t.spies.addAcceptanceNote).toHaveBeenCalledTimes(1);
    expect((t.spies.addAcceptanceNote.mock.calls[0] as unknown as unknown[])[2]).toBe("TOKEN-ORG-1");
    expect(t.latest("lawmatics_note")).toMatchObject({ outcome: "added" });
    const done = await setupFlow({ events: [{ payload: { step: "paid_marked", outcome: "marked" } }, { payload: { step: "lawmatics_note", outcome: "added" } }] });
    const again = await done.flow.retryProposalStep(PROPOSAL_ID, "lawmatics_note");
    expect((again as { notes: string[] }).notes).toEqual([STEP_TEXT.alreadyNoted]);
    expect(done.spies.addAcceptanceNote).not.toHaveBeenCalled();
  });

  it("retries the LOE file upload from the stored docx; with nothing stored it says so without writing a step", async () => {
    const paid = [{ payload: { step: "paid_marked", outcome: "marked" } }];
    const ok = await setupFlow({ events: paid });
    expect(await ok.flow.retryProposalStep(PROPOSAL_ID, "loe_file_upload")).toMatchObject({ ok: true, reports: [{ step: "loe_file_upload", outcome: "uploaded" }] });
    const none = await setupFlow({ events: paid, loeRetry: { outcome: "blocked", reason: STEP_TEXT.noStoredLoe, recorded: false } });
    const r = await none.flow.retryProposalStep(PROPOSAL_ID, "loe_file_upload");
    expect(r).toMatchObject({ ok: true, reports: [], notes: [STEP_TEXT.noStoredLoe] });
  });

  it("does not repeat an engagement letter upload that already landed", async () => {
    const t = await setupFlow({ events: [{ payload: { step: "paid_marked", outcome: "marked" } }, { payload: { step: "loe_file_upload", outcome: "uploaded" } }] });
    await t.flow.retryProposalStep(PROPOSAL_ID, "loe_file_upload");
    expect(t.spies.retryLoeFileUpload).not.toHaveBeenCalled();
  });
});

describe("no record data in logs", () => {
  it("mark paid, undo and retry log nothing that names a client, an email, an amount or a token", async () => {
    const spies = (["info", "log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const t = await setupFlow({ generate: "other-error", upload: { ok: false, reason: "HTTP 500", retryable: true }, settings: withFields(ALL_SIX) });
    await t.flow.markProposalPaid(PROPOSAL_ID);
    await t.flow.retryProposalStep(PROPOSAL_ID, "accepted_file_upload");
    await t.flow.undoProposalPaid(PROPOSAL_ID);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const secret of ["Sevetri", "sevetri@example.com", "Prosperall", "TOKEN-ORG-1", "$7,", "$1,400", "duplicate key"]) expect(logged).not.toContain(secret);
  });
});
