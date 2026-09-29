import { describe, it, expect } from "vitest";
import { runIntakeTriage, triagePrompt, type Triage } from "@/lib/agents/intake-triage";
import { agentCtx, assertOrgFenced, fakeLlm, writes } from "./helpers";
import type { Recorded } from "../mailbox/fake-db";

const lead = (over: Record<string, unknown> = {}) => ({
  id: "lead-1",
  first_name: "Amara",
  last_name: "Nwosu",
  business_name: "Sankofa Brew",
  email: "amara@sankofabrew.example",
  phone: null,
  website: null,
  practice_area: "Trademark",
  mark_text: "SANKOFA",
  referral_source: "Assessment",
  referral_detail: null,
  qualification_score: 82,
  temperature: null,
  created_at: "2026-09-24T09:00:00Z",
  ...over,
});

const hot: Triage = { lane: "hot", readiness: 5, value: "HIGH", urgency: "2d", practice_fit: "strong", reason: "Ready to file this month.", red_flags: ["Similar mark in class 32"] };

function handler(rows: unknown[]) {
  return (q: Recorded) => (q.table === "crm_lead" && q.action === "select" ? { data: rows, error: null } : undefined);
}

describe("intake triage", () => {
  it("act: scores, sets temperature only when unset, and briefs the queue on a hot lead", async () => {
    const { llm, calls } = fakeLlm(hot);
    const { ctx, log, createDraft } = agentCtx(handler([lead(), lead({ id: "lead-2", temperature: "cold" })]), { autonomy: "act", queue: true, llm });
    const result = await runIntakeTriage(ctx);

    expect(result).toMatchObject({ itemsIn: 2, draftsOut: 2 });
    expect(calls[0].effort).toBe("low");
    const updates = writes(log, "crm_lead", "update");
    expect(updates[0].values).toMatchObject({ temperature: "hot", ai_summary: expect.stringContaining("HOT") });
    // A person already set lead-2 to cold: the agent must not overwrite it.
    expect(updates[1].values).not.toHaveProperty("temperature");
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "BRIEFING", orgKey: "firm-queue-key" }));
    assertOrgFenced(log);
  });

  it("suggest: records the view on the timeline and touches no lead field but the scored marker", async () => {
    const { llm } = fakeLlm(hot);
    const { ctx, log } = agentCtx(handler([lead()]), { autonomy: "suggest", queue: false, llm });
    await runIntakeTriage(ctx);
    expect(Object.keys(writes(log, "crm_lead", "update")[0].values as object)).toEqual(["ai_enriched_at"]);
    expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({ type: "ai_insight", actor_type: "ai" });
  });

  it("queues nothing when the firm has no approval queue", async () => {
    const { llm } = fakeLlm(hot);
    const { ctx, createDraft } = agentCtx(handler([lead()]), { autonomy: "draft", queue: false, llm });
    expect((await runIntakeTriage(ctx)).draftsOut).toBe(0);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("sends the model the email domain, never the full address", () => {
    const prompt = triagePrompt(lead());
    expect(prompt).toContain("sankofabrew.example");
    expect(prompt).not.toContain("amara@");
  });
});
