import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpinionLetterMatterFacts } from "@/lib/documents/opinion-letter";

const facts: OpinionLetterMatterFacts = {
  markText: "SUNBEAM",
  markType: "word mark",
  internationalClasses: [25],
  goodsServices: "Clothing, namely t-shirts and hats",
  clientName: "Jane Doe",
  entityName: null,
  clientEmail: "jane@example.com",
  honorific: "Ms.",
  letterDate: "August 1, 2026",
};

describe("buildOpinionLetterDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("passes the extracted report text and matter facts to Claude, and returns the drafted body", async () => {
    const askClaude = vi.fn(async (_input: { system: string; prompt: string; maxTokens?: number }) => ({
      text: "# Jane Doe — Opinion Letter DRAFT — SUNBEAM\n\nDear Ms. Doe:...",
      model: "test",
      costUsd: 0,
    }));
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));

    const { buildOpinionLetterDraft } = await import("@/lib/documents/opinion-letter");
    const result = await buildOpinionLetterDraft(facts, "TMTKO REPORT TEXT: MARK X, U.S. Reg. No. 1111111");

    expect(askClaude).toHaveBeenCalledTimes(1);
    const call = askClaude.mock.calls[0]![0];
    expect(call.prompt).toContain("SUNBEAM");
    expect(call.prompt).toContain("Ms.");
    expect(call.prompt).toContain("TMTKO REPORT TEXT: MARK X, U.S. Reg. No. 1111111");
    expect(call.system).toContain("Never fabricate");

    expect(result.headline).toContain("SUNBEAM");
    expect(result.headline).toContain("Jane Doe");
    expect(result.draftBody).toContain("Dear Ms. Doe:...");
  });

  it("uses the entity name over the client name in the headline when one is on file", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ text: "body", model: "test", costUsd: 0 })),
    }));
    const { buildOpinionLetterDraft } = await import("@/lib/documents/opinion-letter");
    const result = await buildOpinionLetterDraft(
      { ...facts, entityName: "Doe Studio LLC" },
      "report text",
    );
    expect(result.headline).toContain("Doe Studio LLC");
  });

  it("throws DocumentFlowError when no AI provider is configured, rather than silently degrading", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ skipped: true })),
    }));
    const { buildOpinionLetterDraft } = await import("@/lib/documents/opinion-letter");
    await expect(buildOpinionLetterDraft(facts, "report text")).rejects.toThrow(
      /no ai provider is configured/i,
    );
  });
});
