import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrepConsultFacts } from "@/lib/prep-consult/prep-consult";

const facts: PrepConsultFacts = {
  clientName: "Jane Doe",
  clientEmail: "jane@example.com",
  practiceArea: "Trademark",
  inquiryDescription: "I want to protect the name of my new coffee brand before I launch.",
  sessionWhen: "Thursday, Aug 28 at 2:00pm ET",
  zoomLink: "https://zoom.us/j/12345",
};

describe("buildHeadsUpDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("passes the facts to Claude and returns the drafted heads-up, queued internally (no recipient concept baked in)", async () => {
    const askClaude = vi.fn(async (_input: { system: string; prompt: string; maxTokens?: number }) => ({
      text: "To: Rebecca\nSubject: Consult booked — Jane Doe (Trademark)\n\nHi Rebecca, ...",
      model: "test",
      costUsd: 0,
    }));
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));

    const { buildHeadsUpDraft } = await import("@/lib/prep-consult/drafts");
    const result = await buildHeadsUpDraft(facts);

    expect(askClaude).toHaveBeenCalledTimes(1);
    const call = askClaude.mock.calls[0]![0];
    expect(call.prompt).toContain("Jane Doe");
    expect(call.prompt).toContain("Trademark");
    expect(call.prompt).toContain("I want to protect the name of my new coffee brand before I launch.");
    expect(call.system).toContain("INTERNAL ONLY");
    expect(call.system).toMatch(/never invent/i);

    expect(result.headline).toContain("Jane Doe");
    expect(result.draftBody).toContain("Hi Rebecca");
  });

  it("throws PrepConsultFlowError when no AI provider is configured", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ askClaude: vi.fn(async () => ({ skipped: true })) }));
    const { buildHeadsUpDraft } = await import("@/lib/prep-consult/drafts");
    const { PrepConsultFlowError } = await import("@/lib/prep-consult/errors");
    await expect(buildHeadsUpDraft(facts)).rejects.toThrow(PrepConsultFlowError);
  });

  it("refuses (JudgmentBoundaryError) when the model slips in a Nice class or package/price content", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({
        text: "Hi Rebecca, likely Class 25, recommend the Essential package at $1,950.",
        model: "test",
        costUsd: 0,
      })),
    }));
    const { buildHeadsUpDraft } = await import("@/lib/prep-consult/drafts");
    const { JudgmentBoundaryError } = await import("@/lib/prep-consult/prep-consult");
    await expect(buildHeadsUpDraft(facts)).rejects.toThrow(JudgmentBoundaryError);
  });
});

describe("buildClientPrepDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("passes the facts to Claude and returns the drafted client-facing email", async () => {
    const askClaude = vi.fn(async (_input: { system: string; prompt: string; maxTokens?: number }) => ({
      text: "To: jane@example.com\nFrom: RPB Law Operations\nSubject: Preparing for your strategy session\n\nDear Ms. Doe, ...",
      model: "test",
      costUsd: 0,
    }));
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));

    const { buildClientPrepDraft } = await import("@/lib/prep-consult/drafts");
    const result = await buildClientPrepDraft(facts);

    expect(askClaude).toHaveBeenCalledTimes(1);
    const call = askClaude.mock.calls[0]![0];
    expect(call.system).toContain("QUEUED FOR APPROVAL");
    expect(call.system).toMatch(/never invent a time or a link/i);
    expect(result.draftBody).toContain("Dear Ms. Doe");
    expect(result.headline).toContain("Jane Doe");
  });

  it("refuses when the model produces a risk-tier call", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({
        text: "We think this is a GREEN mark and should move forward.",
        model: "test",
        costUsd: 0,
      })),
    }));
    const { buildClientPrepDraft } = await import("@/lib/prep-consult/drafts");
    const { JudgmentBoundaryError } = await import("@/lib/prep-consult/prep-consult");
    await expect(buildClientPrepDraft(facts)).rejects.toThrow(JudgmentBoundaryError);
  });
});

describe("the optional injected text generator (Sprint 17)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the caller's generator instead of askClaude, with the same system prompt and facts, and returns the same shape", async () => {
    const askClaude = vi.fn();
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));
    const generate = vi.fn<(args: { system: string; prompt: string; maxTokens: number }) => Promise<string>>(async () => "  Dear Jane,\n\nPlease bring the name.  ");
    const { buildClientPrepDraft, buildHeadsUpDraft } = await import("@/lib/prep-consult/drafts");

    const prep = await buildClientPrepDraft(facts, generate);
    expect(askClaude).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    const args = generate.mock.calls[0]![0];
    expect(args.system).toContain("QUEUED FOR APPROVAL");
    expect(args.prompt).toContain("jane@example.com");
    expect(args.prompt).toContain("I want to protect the name of my new coffee brand before I launch.");
    expect(args.maxTokens).toBe(1024);
    expect(prep.draftBody).toBe("Dear Jane,\n\nPlease bring the name.");
    expect(prep.headline).toContain("Jane Doe");

    const headsUp = await buildHeadsUpDraft(facts, generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(headsUp.draftBody).toContain("Dear Jane");
  });

  it("still refuses judgment content from an injected generator", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ askClaude: vi.fn() }));
    const { buildClientPrepDraft } = await import("@/lib/prep-consult/drafts");
    const { JudgmentBoundaryError } = await import("@/lib/prep-consult/prep-consult");
    await expect(buildClientPrepDraft(facts, async () => "File in Class 25 for $1,950.")).rejects.toThrow(JudgmentBoundaryError);
  });

  it("the helpers the agent uses to keep recorded values out of its own wording", async () => {
    const { hasJudgmentContent, scrubJudgmentContent, assertNoJudgmentContent } = await import("@/lib/prep-consult/prep-consult");
    expect(hasJudgmentContent("Class 25 and $5,000")).toBe(true);
    expect(hasJudgmentContent("Craft beer")).toBe(false);
    const scrubbed = scrubJudgmentContent("Class 25 apparel, about $5,000, Essential package, green risk");
    expect(scrubbed).toContain("apparel");
    expect(scrubbed.match(/\[omitted\]/g)).toHaveLength(4);
    expect(scrubbed).not.toMatch(/class 25|5,000|Essential|green risk/i);
    expect(() => assertNoJudgmentContent(scrubbed, "card")).not.toThrow();
    // repeated calls give the same answer (no sticky regex state)
    expect(scrubJudgmentContent("class 9")).toBe("[omitted]");
    expect(scrubJudgmentContent("class 9")).toBe("[omitted]");
  });
});
