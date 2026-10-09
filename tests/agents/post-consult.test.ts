import { describe, it, expect } from "vitest";
import { runPostConsult, type FollowUp } from "@/lib/agents/post-consult";
import { NOW, ORG, agentCtx, assertOrgFenced, fakeLlm, writes } from "./helpers";
import { applyReview, normalizeExtraction, withConsultDetails } from "@/lib/consult/details";
import type { Recorded } from "../mailbox/fake-db";

const draft: FollowUp = {
  subject: "Great speaking today",
  body: "Hi Amara,\n\nThank you...\n\n[Attorney name]",
  internal_summary: "Discussed SANKOFA in class 32.",
  consult_details: {
    marks: [
      {
        mark: "SANKOFA",
        mark_type: "word",
        classes: [{ class: 32, goods: "Non-alcoholic beverages, namely sparkling water" }],
        filing_basis: "1b",
        basis_evidence: "Amara said the drink hasn't launched yet.",
        first_use_date: null,
      },
    ],
    recommended_package: "Enhanced",
    discount_discussed: null,
  },
};

const NOTE_BODY = { summary: "Wants to file SANKOFA.", next_step: "Send the engagement letter." };

function handler(opts: { email?: string; handled?: string[]; notes?: Record<string, unknown>; failNoteWrite?: boolean } = {}) {
  return (q: Recorded) => {
    if (q.table === "crm_consult_note" && q.action === "update" && opts.failNoteWrite) {
      return { data: null, error: { message: "permission denied" } };
    }
    if (q.table === "crm_consult_note") {
      return { data: [{ id: "note-1", lead_id: "lead-1", created_at: "2026-09-24T09:00:00Z", notes: opts.notes ?? NOTE_BODY }], error: null };
    }
    if (q.table === "crm_activity" && q.action === "select") {
      return { data: (opts.handled ?? []).map((id) => ({ payload: { consult_note_id: id } })), error: null };
    }
    if (q.table === "crm_lead") {
      return { data: [{ id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, email: opts.email ?? "amara@example.com" }], error: null };
    }
    return undefined;
  };
}

describe("post-consult drafter", () => {
  it("drafts the follow-up INTO THE QUEUE, never anywhere else, and logs it once", async () => {
    const { llm, calls } = fakeLlm(draft);
    const { ctx, log, createDraft } = agentCtx(handler(), { autonomy: "act", queue: true, llm });
    const result = await runPostConsult(ctx);
    expect(result).toMatchObject({ itemsIn: 1, draftsOut: 1 });
    expect(calls[0].effort).toBe("high");
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "CLIENT_EMAIL", recipient: "amara@example.com", subject: "Great speaking today" }));
    expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({ type: "queue_drafted", payload: expect.objectContaining({ consult_note_id: "note-1", queue_id: "q-1" }) });
    assertOrgFenced(log);
  });

  it("with no approval queue, drafts nothing at all — a client email with nowhere safe to wait is never written", async () => {
    const { llm, calls } = fakeLlm(draft);
    const { ctx, log } = agentCtx(handler(), { autonomy: "draft", queue: false, llm });
    const result = await runPostConsult(ctx);
    expect(result.skipped).toBe(true);
    expect(calls).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  it("doesn't draft twice for the same consult", async () => {
    const { llm, calls } = fakeLlm(draft);
    const { ctx } = agentCtx(handler({ handled: ["note-1"] }), { autonomy: "draft", queue: true, llm });
    expect((await runPostConsult(ctx)).draftsOut).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("leaves the recipient blank for a placeholder address", async () => {
    const { llm } = fakeLlm(draft);
    const { ctx, createDraft } = agentCtx(handler({ email: "row-12@intake.invalid" }), { autonomy: "draft", queue: true, llm });
    await runPostConsult(ctx);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ recipient: undefined }));
  });

  it("suggest: flags the follow-up as due without calling the model", async () => {
    const { llm, calls } = fakeLlm(draft);
    const { ctx, createDraft } = agentCtx(handler(), { autonomy: "suggest", queue: true, llm });
    await runPostConsult(ctx);
    expect(calls).toHaveLength(0);
    expect(createDraft).not.toHaveBeenCalled();
  });

  describe("consult details (marks, classes, filing basis)", () => {
    it("asks for the extraction as REPORTING: no inferred basis, none in the email", async () => {
      const { llm, calls } = fakeLlm(draft);
      const { ctx } = agentCtx(handler(), { autonomy: "draft", queue: true, llm });
      await runPostConsult(ctx);
      expect(calls[0].system).toContain("consult_details");
      expect(calls[0].system).toMatch(/Never infer a basis/);
      expect(calls[0].system).toMatch(/never choose classes, a package or a discount yourself/);
      expect(calls[0].system).toMatch(/Do not mention the filing basis in the email/);
    });

    it("stores the extraction on the very note the draft came from, beside what is already there", async () => {
      const { llm } = fakeLlm(draft);
      const { ctx, log } = agentCtx(handler(), { autonomy: "draft", queue: true, llm });
      await runPostConsult(ctx);
      const [update] = writes(log, "crm_consult_note", "update");
      expect(update.filters).toEqual(expect.arrayContaining([{ op: "eq", column: "id", value: "note-1" }, { op: "eq", column: "org_id", value: ORG }]));
      const notes = (update.values as { notes: Record<string, unknown> }).notes;
      expect(notes).toMatchObject(NOTE_BODY);
      expect(notes.consult_details).toMatchObject({
        version: 1,
        review: null,
        extracted: { source: "post-consult-agent", meeting_id: null },
        recommended_package: "Enhanced",
        marks: [{ mark: "SANKOFA", mark_type: "word", filing_basis: "1b", classes: [{ class: 32, goods: expect.stringContaining("sparkling water") }] }],
      });
      expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({ payload: expect.objectContaining({ consult_details: "saved" }) });
      assertOrgFenced(log);
    });

    it("records a basis the model gave with no evidence as unknown", async () => {
      const claim = { ...draft, consult_details: { ...draft.consult_details, marks: [{ ...draft.consult_details.marks[0], filing_basis: "1a" as const, basis_evidence: null }] } };
      const { llm } = fakeLlm(claim);
      const { ctx, log } = agentCtx(handler(), { autonomy: "draft", queue: true, llm });
      await runPostConsult(ctx);
      const notes = (writes(log, "crm_consult_note", "update")[0].values as { notes: { consult_details: { marks: Array<{ filing_basis: string }> } } }).notes;
      expect(notes.consult_details.marks[0].filing_basis).toBe("unknown");
    });

    it("never overwrites details a person already reviewed", async () => {
      const mine = applyReview(
        normalizeExtraction(draft.consult_details, { now: new Date(NOW), source: "post-consult-agent" }),
        { marks: [{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1a", first_use_date: null, classes: [] }], recommended_package: null, discount_discussed: null },
        { userId: "u1", name: "Dawn", role: "paralegal" },
        new Date(NOW),
      );
      const { llm } = fakeLlm(draft);
      const { ctx, log } = agentCtx(handler({ notes: withConsultDetails(NOTE_BODY, mine) }), { autonomy: "draft", queue: true, llm });
      const result = await runPostConsult(ctx);
      expect(result.draftsOut).toBe(1);
      expect(writes(log, "crm_consult_note", "update")).toHaveLength(0);
      expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({ payload: expect.objectContaining({ consult_details: "kept" }) });
    });

    it("a failure saving the details never undoes or repeats the queued draft", async () => {
      const { llm } = fakeLlm(draft);
      const { ctx, log, createDraft } = agentCtx(handler({ failNoteWrite: true }), { autonomy: "draft", queue: true, llm });
      const result = await runPostConsult(ctx);
      expect(result).toMatchObject({ itemsIn: 1, draftsOut: 1 });
      expect(createDraft).toHaveBeenCalledTimes(1);
      // the "already drafted" marker is still written, so the next run won't draft it again
      expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({ type: "queue_drafted", payload: expect.objectContaining({ consult_details: "failed" }) });
    });

    it("a draft whose extraction is missing or malformed still goes to the queue, with nothing stored", async () => {
      const { llm } = fakeLlm({ subject: "Great speaking today", body: "Hi", internal_summary: "x" });
      const { ctx, log, createDraft } = agentCtx(handler(), { autonomy: "draft", queue: true, llm });
      expect((await runPostConsult(ctx)).draftsOut).toBe(1);
      expect(createDraft).toHaveBeenCalledTimes(1);
      expect(writes(log, "crm_consult_note", "update")).toHaveLength(0);
    });

    it("suggest mode reads nothing off the call: no model, no write", async () => {
      const { llm, calls } = fakeLlm(draft);
      const { ctx, log } = agentCtx(handler(), { autonomy: "suggest", queue: true, llm });
      await runPostConsult(ctx);
      expect(calls).toHaveLength(0);
      expect(writes(log, "crm_consult_note", "update")).toHaveLength(0);
    });
  });
});
