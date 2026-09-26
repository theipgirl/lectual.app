import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrademarkClearanceMatterFacts } from "@/lib/documents/trademark-clearance";

const facts: TrademarkClearanceMatterFacts = {
  markText: "SUNBEAM",
  filingBasis: "1(a) Use in Commerce",
  internationalClasses: [25],
  goodsServices: "Clothing, namely t-shirts and hats",
  clientName: "Jane Doe",
  entityName: null,
  clientEmail: "jane@example.com",
  searchDate: "August 1, 2026",
};

describe("buildTrademarkClearanceDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("passes the preliminary search findings and matter facts to Claude, and returns the drafted body", async () => {
    const askClaude = vi.fn(async (_input: { system: string; prompt: string; maxTokens?: number }) => ({
      text: "# Jane Doe — Trademark Clearance Opinion DRAFT — SUNBEAM\n\n## Section A: Clearance Findings...",
      model: "test",
      costUsd: 0,
    }));
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));

    const { buildTrademarkClearanceDraft } = await import("@/lib/documents/trademark-clearance");
    const result = await buildTrademarkClearanceDraft(
      facts,
      "No live federal registrations found for identical marks in Class 25.",
    );

    expect(askClaude).toHaveBeenCalledTimes(1);
    const call = askClaude.mock.calls[0]![0] as { system: string; prompt: string };
    expect(call.prompt).toContain("SUNBEAM");
    expect(call.prompt).toContain("1(a) Use in Commerce");
    expect(call.prompt).toContain("No live federal registrations found for identical marks in Class 25.");
    expect(call.system).toContain("PRELIMINARY");
    expect(call.system).toContain("Never fabricate");

    expect(result.headline).toContain("SUNBEAM");
    expect(result.headline).toContain("Jane Doe");
    expect(result.draftBody).toContain("Section A: Clearance Findings");
  });

  it("uses the entity name over the client name in the headline when one is on file", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ text: "body", model: "test", costUsd: 0 })),
    }));
    const { buildTrademarkClearanceDraft } = await import("@/lib/documents/trademark-clearance");
    const result = await buildTrademarkClearanceDraft(
      { ...facts, entityName: "Doe Studio LLC" },
      "findings",
    );
    expect(result.headline).toContain("Doe Studio LLC");
  });

  it("throws DocumentFlowError when no AI provider is configured, rather than silently degrading", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ skipped: true })),
    }));
    const { buildTrademarkClearanceDraft } = await import("@/lib/documents/trademark-clearance");
    await expect(buildTrademarkClearanceDraft(facts, "findings")).rejects.toThrow(
      /no ai provider is configured/i,
    );
  });

  it("instructs the model that this is a preliminary search only, never comprehensive (distinguishing it from opinion-letter)", async () => {
    const askClaude = vi.fn(async (_input: { system: string; prompt: string }) => ({ text: "body", model: "test", costUsd: 0 }));
    vi.doMock("@/lib/ai/claude", () => ({ askClaude }));
    const { buildTrademarkClearanceDraft } = await import("@/lib/documents/trademark-clearance");
    await buildTrademarkClearanceDraft(facts, "findings");
    const call = askClaude.mock.calls[0]![0] as { system: string; prompt: string };
    expect(call.system).toContain("PRELIMINARY search only");
    expect(call.system).toContain("comprehensive");
  });
});
