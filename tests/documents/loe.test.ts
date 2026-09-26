import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTrademarkLoeDraft } from "@/lib/documents/loe";
import { DocumentFlowError } from "@/lib/documents/errors";

describe("buildTrademarkLoeDraft — deterministic, no AI", () => {
  const base = {
    variant: "current" as const,
    clientName: "Jane Doe",
    entityName: null,
    markText: "SUNBEAM",
    packageName: "ESSENTIAL",
    benefitRowsText: "Preliminary Consultation Strategy Call ($450) — ✓\nComprehensive Trademark Search Report — 1 included",
    classSelected: "Clothing (namely, t-shirts and hats)",
    classCount: 2,
    amountPaid: "$2,525",
    amountPaidMath: "$2,775 − $250 = $2,525",
    sendDateIso: "2026-08-01",
  };

  it("computes government filing fees as $350 × class count and shows the math", () => {
    const draft = buildTrademarkLoeDraft(base);
    expect(draft.payload.govFees).toBe(700);
    expect(draft.draftBody).toContain("$700 (350 × 2 classes)");
  });

  it("sets the signature deadline to 14 days after the send date", () => {
    const draft = buildTrademarkLoeDraft(base);
    expect(draft.payload.signatureDeadline).toBe("2026-08-15");
    expect(draft.draftBody).toContain("2026-08-15");
  });

  it("selects the current vs. legacy doc_type and template label from the explicit variant", () => {
    const current = buildTrademarkLoeDraft(base);
    expect(current.docType).toBe("loe_trademark_current");
    expect(current.draftBody).toContain("Trademark LOE (current)");

    const legacy = buildTrademarkLoeDraft({ ...base, variant: "legacy" });
    expect(legacy.docType).toBe("loe_trademark_legacy");
    expect(legacy.draftBody).toContain("legacy");
  });

  it("shows the amount paid verbatim, including the discount math", () => {
    const draft = buildTrademarkLoeDraft(base);
    expect(draft.draftBody).toContain("**Amount Paid:** $2,525 ($2,775 − $250 = $2,525)");
  });

  it("prefers the entity name in the headline when one is on file", () => {
    const draft = buildTrademarkLoeDraft({ ...base, entityName: "Doe Studio LLC" });
    expect(draft.headline).toContain("Doe Studio LLC");
  });

  it("refuses a class count under 1", () => {
    expect(() => buildTrademarkLoeDraft({ ...base, classCount: 0 })).toThrow(DocumentFlowError);
  });
});

describe("buildGeneralLoeDraft — AI bullets, human-entered fee math", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("computes deposit as pct × quoted amount and shows the math", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({
        text: "- Phone consultation regarding contract review\n- Drafting of vendor agreement",
        model: "test",
        costUsd: 0,
      })),
    }));
    const { buildGeneralLoeDraft } = await import("@/lib/documents/loe");

    const draft = await buildGeneralLoeDraft({
      clientName: "Jane Doe",
      entityName: null,
      scopeDescription: "Phone call about a vendor contract; draft the agreement.",
      feeStructure: "hourly at $450/hr",
      depositStatedTerms: "we require a 50% deposit to commence work",
      depositPercent: 50,
      quotedAmount: 450,
    });

    expect(draft.docType).toBe("loe_general");
    expect(draft.draftBody).toContain("50% × $450 = $225");
    expect(draft.draftBody).toContain("Phone consultation regarding contract review");
  });

  it("flags an unclear deposit rather than inventing a number", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ text: "- Some scope", model: "test", costUsd: 0 })),
    }));
    const { buildGeneralLoeDraft } = await import("@/lib/documents/loe");

    const draft = await buildGeneralLoeDraft({
      clientName: "Jane Doe",
      entityName: null,
      scopeDescription: "Something",
      feeStructure: "flat fee of $2,000",
      depositStatedTerms: null,
      depositPercent: null,
      quotedAmount: null,
    });

    expect(draft.draftBody).toContain("no deposit terms stated");
  });

  it("throws DocumentFlowError when no AI provider is configured", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ skipped: true })),
    }));
    const { buildGeneralLoeDraft } = await import("@/lib/documents/loe");

    await expect(
      buildGeneralLoeDraft({
        clientName: "Jane Doe",
        entityName: null,
        scopeDescription: "Something",
        feeStructure: "flat fee of $2,000",
        depositStatedTerms: null,
        depositPercent: null,
        quotedAmount: null,
      }),
    ).rejects.toThrow(/no ai provider is configured/i);
  });
});
