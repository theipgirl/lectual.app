import { describe, it, expect } from "vitest";
import { runIntakeTriage, triagePrompt, type BoothAssessment, type Triage } from "@/lib/agents/intake-triage";
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
  it("act: scores and SUGGESTS a lane — never writes the lane or the temperature — and briefs the queue on a hot lead", async () => {
    const { llm, calls } = fakeLlm(hot);
    const { ctx, log, createDraft } = agentCtx(handler([lead(), lead({ id: "lead-2", temperature: "cold" })]), { autonomy: "act", queue: true, llm });
    const result = await runIntakeTriage(ctx);

    expect(result).toMatchObject({ itemsIn: 2, draftsOut: 2 });
    expect(calls[0].effort).toBe("low");
    const updates = writes(log, "crm_lead", "update");
    // SOP Stage 2: routing is a suggestion, not a status. The suggestion lives
    // in ai_summary; a person's lane (and the board's temperature) is never touched.
    expect(updates[0].values).toMatchObject({ ai_summary: expect.stringContaining("HOT") });
    for (const u of updates) {
      expect(u.values).not.toHaveProperty("temperature");
      expect(u.values).not.toHaveProperty("lane");
    }
    expect(writes(log, "crm_activity", "insert")[0].values).toMatchObject({
      payload: expect.objectContaining({ lane: "hot", applied: { lane: false, temperature: false, summary: true } }),
    });
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

  it("labels the computed CRM score for what it is, not as an assessment score", () => {
    const prompt = triagePrompt(lead());
    expect(prompt).toContain("CRM qualification score");
    expect(prompt).not.toContain("Assessment score:");
  });

  const booth: BoothAssessment = {
    lead_id: "lead-1",
    event_code: "story2profit-2026",
    track: "business",
    score: 13,
    band: "exposed",
    temperature: "hot",
    gaps: ["Your name and logo are not federally registered."],
    answers: { "104": "yes", "108": "under_150k", "109": "right_away" },
    mark_name: "Breakthrough Unlocked",
    mark_goods: "Speaking, coaching",
    completed_at: "2026-10-21T01:16:41Z",
  };

  it("gives the model the booth assessment the person completed", () => {
    const prompt = triagePrompt(lead({ mark_text: null }), booth);
    expect(prompt).toContain("<booth_assessment>");
    expect(prompt).toContain("Breakthrough Unlocked");
    expect(prompt).toContain("Speaking, coaching");
    expect(prompt).toContain("HOT");
    expect(prompt).toContain("13/100 (exposed)");
    expect(prompt).toContain("Your name and logo are not federally registered.");
    expect(prompt).toContain("Right away");
    expect(prompt).toContain("Under $150k");
    expect(prompt).toMatch(/similar name.*Yes/i);
  });

  it("says plainly when there is no booth assessment", () => {
    expect(triagePrompt(lead())).toContain("Booth assessment: (none)");
  });

  it("reads the lead's booth assessment, fenced to the firm, and passes it to the model", async () => {
    const { llm, calls } = fakeLlm(hot);
    const { ctx, log } = agentCtx(
      (q) =>
        q.table === "crm_lead" && q.action === "select"
          ? { data: [lead({ mark_text: null })], error: null }
          : q.table === "crm_booth_scorecard" && q.action === "select"
            ? { data: [booth], error: null }
            : undefined,
      { autonomy: "draft", queue: false, llm },
    );
    await runIntakeTriage(ctx);
    expect(log.some((q) => q.table === "crm_booth_scorecard" && q.action === "select")).toBe(true);
    expect(calls[0].user).toContain("Breakthrough Unlocked");
    assertOrgFenced(log);
  });

  it("re-scores a lead whose booth assessment arrived after its last triage", async () => {
    const { llm } = fakeLlm(hot);
    const scored = lead({ id: "lead-9", ai_enriched_at: "2026-10-20T13:29:26Z" });
    const { ctx, log } = agentCtx(
      (q) => {
        if (q.table === "crm_lead" && q.action === "select") {
          // First read: never-scored leads (none). Second read: the re-score candidates.
          const isRescore = q.filters.some((f) => f.op === "in" && f.column === "id");
          return { data: isRescore ? [scored] : [], error: null };
        }
        if (q.table === "crm_booth_scorecard" && q.action === "select") {
          return { data: [{ ...booth, lead_id: "lead-9" }], error: null };
        }
        return undefined;
      },
      { autonomy: "draft", queue: false, llm },
    );
    const result = await runIntakeTriage(ctx);
    expect(result.itemsIn).toBe(1);
    expect(writes(log, "crm_lead", "update")[0].filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: "id", value: "lead-9" })]),
    );
    assertOrgFenced(log);
  });

  it("does not re-score a lead already triaged after its booth assessment", async () => {
    const { llm, calls } = fakeLlm(hot);
    const fresh = lead({ id: "lead-9", ai_enriched_at: "2026-10-21T13:29:39Z" });
    const { ctx } = agentCtx(
      (q) => {
        if (q.table === "crm_lead" && q.action === "select") {
          const isRescore = q.filters.some((f) => f.op === "in" && f.column === "id");
          return { data: isRescore ? [fresh] : [], error: null };
        }
        if (q.table === "crm_booth_scorecard" && q.action === "select") {
          return { data: [{ ...booth, lead_id: "lead-9" }], error: null };
        }
        return undefined;
      },
      { autonomy: "draft", queue: false, llm },
    );
    expect((await runIntakeTriage(ctx)).itemsIn).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
