import { describe, it, expect } from "vitest";
import { runPostConsult, type FollowUp } from "@/lib/agents/post-consult";
import { agentCtx, assertOrgFenced, fakeLlm, writes } from "./helpers";
import type { Recorded } from "../mailbox/fake-db";

const draft: FollowUp = { subject: "Great speaking today", body: "Hi Amara,\n\nThank you...\n\n[Attorney name]", internal_summary: "Discussed SANKOFA in class 32." };

function handler(opts: { email?: string; handled?: string[] } = {}) {
  return (q: Recorded) => {
    if (q.table === "crm_consult_note") {
      return { data: [{ id: "note-1", lead_id: "lead-1", created_at: "2026-09-24T09:00:00Z", notes: { summary: "Wants to file SANKOFA.", next_step: "Send the engagement letter." } }], error: null };
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
});
