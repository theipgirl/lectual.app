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
