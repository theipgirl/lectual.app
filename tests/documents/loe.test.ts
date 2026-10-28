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

describe("buildTrademarkLoeDraft — opened from a signed quote", () => {
  const base = {
    variant: "current" as const,
    clientName: "Jane Doe",
    entityName: null,
    markText: "SUNBEAM",
    packageName: "ENHANCED",
    benefitRowsText: "Enhanced package (2 classes) — $3,250",
    classSelected: "Classes 25, 35 — Clothing",
    classCount: 2,
    amountPaid: "$3,500",
    amountPaidMath: "$3,750 − $250 = $3,500",
    sendDateIso: "2026-08-01",
  };
  const source = { quoteId: "q-1", reference: "QT-3F9A1C", acceptedOn: "Sep 27, 2026", differences: [] as string[] };

  it("is byte-for-byte today's letter when there is no signed quote", () => {
    const draft = buildTrademarkLoeDraft(base);
    expect(draft.draftBody).not.toContain("Source:");
    expect(draft.draftBody).not.toContain("Check before sending");
    expect(draft.draftBody).toContain("- **Government Filing Fees (Unpaid):** $700 (350 × 2 classes)\n\n## Human steps remaining");
    expect(draft.payload).not.toHaveProperty("signedQuote");
    expect(draft.payload).not.toHaveProperty("govFeesText");
  });

  it("names the signed quote it came from, and records it on the draft", () => {
    const draft = buildTrademarkLoeDraft({ ...base, signedQuote: source });
    expect(draft.draftBody).toContain(
      "Mark: SUNBEAM\nSource: signed quote QT-3F9A1C (accepted Sep 27, 2026). Pre-filled from the signed copy, not re-priced. Nothing taken from it was changed.",
    );
    expect(draft.draftBody).not.toContain("Check before sending");
    expect(draft.payload.signedQuote).toEqual({ quoteId: "q-1", reference: "QT-3F9A1C", differences: [] });
  });

  it("prints the signed quote's own government-fee wording, not the $350 constant", () => {
    const draft = buildTrademarkLoeDraft({ ...base, govFeesText: "$0 — $700 (350 × 2 classes) absorbed by the firm, not charged", signedQuote: source });
    expect(draft.draftBody).toContain("**Government Filing Fees (Unpaid):** $0 — $700 (350 × 2 classes) absorbed by the firm, not charged");
    expect(draft.draftBody).not.toContain("$700 (350 × 2 classes)\n");
    expect(draft.payload.govFees).toBeNull();
    expect(draft.payload.govFeesText).toContain("absorbed");
  });

  it("puts every departure from the signed quote in front of the approver", () => {
    const differences = ["Amount paid is entered as $3,000; QT-3F9A1C says $3,500."];
    const draft = buildTrademarkLoeDraft({ ...base, amountPaid: "$3,000", signedQuote: { ...source, differences } });
    expect(draft.draftBody).toContain("## Check before sending — differs from signed quote QT-3F9A1C\n- Amount paid is entered as $3,000; QT-3F9A1C says $3,500.\n\n## Human steps remaining");
    expect((draft.payload.signedQuote as { differences: string[] }).differences).toEqual(differences);
  });

  it("still requires the explicit template and at least one class", () => {
    expect(() => buildTrademarkLoeDraft({ ...base, classCount: 0, signedQuote: source })).toThrow(DocumentFlowError);
    expect(buildTrademarkLoeDraft({ ...base, variant: "legacy", signedQuote: source }).docType).toBe("loe_trademark_legacy");
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

  it("names the signed quote and flags a quoted amount that was edited", async () => {
    vi.doMock("@/lib/ai/claude", () => ({
      askClaude: vi.fn(async () => ({ text: "- Some scope", model: "test", costUsd: 0 })),
    }));
    const { buildGeneralLoeDraft } = await import("@/lib/documents/loe");

    const draft = await buildGeneralLoeDraft({
      clientName: "Jane Doe",
      entityName: null,
      scopeDescription: "Something",
      feeStructure: "Flat fee: $3,500 due at signing",
      depositStatedTerms: null,
      depositPercent: 50,
      quotedAmount: 3000,
      signedQuote: {
        quoteId: "q-1",
        reference: "QT-3F9A1C",
        acceptedOn: "Sep 27, 2026",
        differences: ["Quoted amount is entered as $3000.00; QT-3F9A1C says $3500.00."],
      },
    });

    expect(draft.draftBody).toContain("Source: signed quote QT-3F9A1C (accepted Sep 27, 2026).");
    // An edited letter never claims it is the signed copy unchanged.
    expect(draft.draftBody).toContain("Some were changed before generating");
    expect(draft.draftBody).not.toContain("Nothing taken from it was changed");
    expect(draft.draftBody).toContain("## Check before sending — differs from signed quote QT-3F9A1C");
    expect(draft.payload.signedQuote).toMatchObject({ quoteId: "q-1", reference: "QT-3F9A1C" });
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
    ).rejects.toThrow(/AI isn't switched on for your firm yet/);
  });
});
