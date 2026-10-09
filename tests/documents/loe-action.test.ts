import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoePrefill } from "@/lib/documents/loe-prefill";
import type { SignedQuotePrefill } from "@/lib/documents/loe-prefill-load";

/**
 * The generate action when the form was opened from a signed quote.
 *
 * The quote id the form carries is the caller's word, so the action re-derives
 * the signed figures itself and refuses what it cannot confirm. These tests
 * pin: the module gate still comes first; the template is still required even
 * with a signed quote in hand; edits to signed figures reach the draft as
 * `differences`; and a form with no quote behaves exactly as it always has.
 */

const h = vi.hoisted(() => ({
  modules: ["document-center"] as string[],
  tm: [] as unknown[],
  general: [] as unknown[],
  prefillCalls: [] as [string, string][],
  prefill: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => h.modules.includes(m) }));
vi.mock("@/lib/documents/generate", () => ({
  generateTrademarkLoe: async (input: unknown) => {
    h.tm.push(input);
    return { queueItemId: "qi-1" };
  },
  generateGeneralLoe: async (input: unknown) => {
    h.general.push(input);
    return { queueItemId: "qi-2" };
  },
}));
vi.mock("@/lib/documents/loe-prefill-load", () => ({
  prefillForSignedQuote: async (matterId: string, quoteId: string) => {
    h.prefillCalls.push([matterId, quoteId]);
    return h.prefill;
  },
}));

const { generateLoeAction } = await import("@/app/dashboard/documents/new/[matterId]/loe/actions");

const PREFILL: LoePrefill = {
  quoteId: "q-1",
  reference: "QT-3F9A1C",
  acceptedOn: "Sep 27, 2026",
  signerName: "Nadia Petra",
  packageName: "Enhanced",
  markText: "HALCYON ROWE",
  markFrom: "signed terms",
  classCount: "2",
  classSelected: "Classes 25, 35 — Clothing",
  amountPaid: "$3,500",
  amountPaidMath: "$3,750 − $250 = $3,500",
  benefitRowsText: "Enhanced package (2 classes) — $3,250",
  govFeesText: "$700 (350 × 2 classes)",
  scopeDescription: "Enhanced package (2 classes)",
  feeStructure: "Flat fee: $3,500 due at signing; $700 due later, at filing",
  quotedAmount: "3500.00",
  totals: { dueAtSigning: "$3,500", dueAtFiling: "$700", fullProjectCost: "$4,200" },
  checks: [],
};

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const tmForm = {
  matterId: "m-1",
  kind: "trademark",
  clientName: "Nadia Petra",
  variant: "current",
  markText: "HALCYON ROWE",
  packageName: "Enhanced",
  classSelected: "Classes 25, 35 — Clothing",
  classCount: "2",
  amountPaid: "$3,500",
  amountPaidMath: "$3,750 − $250 = $3,500",
  govFeesText: "$700 (350 × 2 classes)",
  benefitRowsText: "Enhanced package (2 classes) — $3,250",
};

beforeEach(() => {
  h.modules = ["document-center"];
  h.tm = [];
  h.general = [];
  h.prefillCalls = [];
  h.prefill = { ok: true, prefill: PREFILL } satisfies SignedQuotePrefill;
});

describe("generateLoeAction — opened from a signed quote", () => {
  it("checks the module before it looks at the quote", async () => {
    h.modules = [];
    const out = await generateLoeAction({}, fd({ ...tmForm, quoteId: "q-1" }));
    expect(out.error).toMatch(/isn't available/);
    expect(h.prefillCalls).toEqual([]);
    expect(h.tm).toEqual([]);
  });

  it("still refuses without an explicit template, signed quote or not", async () => {
    const { variant: _variant, ...noVariant } = tmForm;
    void _variant;
    const out = await generateLoeAction({}, fd({ ...noVariant, quoteId: "q-1" }));
    expect(out.error).toMatch(/Select a template/);
    expect(h.tm).toEqual([]);
  });

  it("queues a letter that matches the signed quote with no differences, naming its source", async () => {
    await expect(generateLoeAction({}, fd({ ...tmForm, quoteId: "q-1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard/queue/qi-1/");
    expect(h.prefillCalls).toEqual([["m-1", "q-1"]]);
    expect(h.tm).toHaveLength(1);
    expect(h.tm[0]).toMatchObject({
      matterId: "m-1",
      variant: "current",
      amountPaid: "$3,500",
      govFeesText: "$700 (350 × 2 classes)",
      signedQuote: { quoteId: "q-1", reference: "QT-3F9A1C", acceptedOn: "Sep 27, 2026", differences: [] },
    });
  });

  it("carries an edited figure to the approver as a difference, and still queues the letter", async () => {
    await expect(generateLoeAction({}, fd({ ...tmForm, quoteId: "q-1", amountPaid: "$3,000", classCount: "3" }))).rejects.toThrow("NEXT_REDIRECT");
    const sent = h.tm[0] as { signedQuote: { differences: string[] } };
    expect(sent.signedQuote.differences).toHaveLength(2);
    expect(sent.signedQuote.differences.join("\n")).toMatch(/Amount paid is entered as \$3,000/);
    expect(sent.signedQuote.differences.join("\n")).toMatch(/Class count is entered as 3/);
  });

  it("refuses a quote that is not a signed quote on this matter, generating nothing", async () => {
    h.prefill = { ok: false, reason: "not_signed" } satisfies SignedQuotePrefill;
    const out = await generateLoeAction({}, fd({ ...tmForm, quoteId: "q-elsewhere" }));
    expect(out.error).toMatch(/isn't a signed quote on this matter/);
    expect(h.tm).toEqual([]);
  });

  it("says nothing was generated when the quote cannot be re-checked", async () => {
    h.prefill = { ok: false, reason: "unavailable" } satisfies SignedQuotePrefill;
    const out = await generateLoeAction({}, fd({ ...tmForm, quoteId: "q-1" }));
    expect(out.error).toMatch(/Nothing was generated/);
    expect(h.tm).toEqual([]);
  });

  it("refuses a signed quote whose signed copy cannot be read", async () => {
    h.prefill = { ok: false, reason: "unreadable" } satisfies SignedQuotePrefill;
    const out = await generateLoeAction({}, fd({ ...tmForm, quoteId: "q-1" }));
    expect(out.error).toMatch(/signed copy can't be read/);
    expect(h.tm).toEqual([]);
  });

  it("flags an edited quoted amount on the general letter", async () => {
    const form = { matterId: "m-1", kind: "general", clientName: "Nadia Petra", scopeDescription: "Enhanced package", feeStructure: "Flat fee", quotedAmount: "3000", quoteId: "q-1" };
    await expect(generateLoeAction({}, fd(form))).rejects.toThrow("NEXT_REDIRECT:/dashboard/queue/qi-2/");
    const sent = h.general[0] as { quotedAmount: number; signedQuote: { reference: string; differences: string[] } };
    expect(sent.quotedAmount).toBe(3000);
    expect(sent.signedQuote.reference).toBe("QT-3F9A1C");
    expect(sent.signedQuote.differences[0]).toMatch(/Quoted amount/);
  });
});

describe("generateLoeAction — no signed quote", () => {
  it("is the action it has always been: the quote is never looked up", async () => {
    const { govFeesText: _gov, ...plain } = tmForm;
    void _gov;
    await expect(generateLoeAction({}, fd(plain))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.prefillCalls).toEqual([]);
    expect(h.tm[0]).toMatchObject({ signedQuote: null, govFeesText: null });
  });

  it("a blank quote id counts as none", async () => {
    await expect(generateLoeAction({}, fd({ ...tmForm, quoteId: "  " }))).rejects.toThrow("NEXT_REDIRECT");
    expect(h.prefillCalls).toEqual([]);
  });
});
