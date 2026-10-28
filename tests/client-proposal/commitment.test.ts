import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { sevetri } from "../proposals/fixture";
import { commitmentSentence, firmDisplayName } from "@/lib/proposals/commitment";
import { contactLine, firmContactFromSignoff } from "@/lib/proposals/firm-contact";
import { usptoLine } from "@/lib/proposals/uspto-line";
import type { ProposalQuote, QuotedName } from "@/lib/proposals/types";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
const name = (o: Partial<QuotedName>): QuotedName =>
  ({ id: "n", name: "Acme", included: true, classes: [{ id: "c1", label: "a" }, { id: "c2", label: "b" }, { id: "c3", label: "c" }], marks: [{ id: "m1" }, { id: "m2" }], base_cents: 0, legal_cents: 0, gov_cents: 210_000, class_count: 6, ...o }) as unknown as QuotedName;
const quote = (names: QuotedName[], gov: number): ProposalQuote =>
  ({ names, legal_subtotal_cents: 0, adjustments: [], discount_cents: 0, legal_total_cents: 0, gov_total_cents: gov, gov_class_count: names.reduce((s, n) => s + n.class_count, 0) }) as ProposalQuote;

describe("commitment sentence", () => {
  it("uses the firm's name and the agreed words", () => {
    expect(commitmentSentence("Cabanis Law")).toBe(
      "By accepting, you agree to Cabanis Law starting work on the marks and classes above for the fees shown. You'll get an engagement letter to sign.",
    );
  });
  it("never hard-codes another firm and has no advice wording", () => {
    const text = commitmentSentence("Hartwell IP");
    expect(text).not.toMatch(/RPB/);
    expect(text).not.toMatch(/guarantee|will be approved|recommend|we advise|legal advice/i);
  });
  it("prefers the profile display name, falling back to the firm name", () => {
    expect(firmDisplayName("  Hartwell IP Group ", "Hartwell")).toBe("Hartwell IP Group");
    expect(firmDisplayName(null, "Hartwell")).toBe("Hartwell");
    expect(firmDisplayName("   ", "Hartwell")).toBe("Hartwell");
  });
});

describe("USPTO line (D2)", () => {
  it("reads classes x marks x fee when the engine's figures agree", () => {
    expect(usptoLine(quote([name({})], 210_000), 35_000, money)).toBe("3 classes × 2 marks × $350");
    expect(usptoLine(quote([name({ classes: [{ id: "c", label: "x" }], marks: [{ id: "m" } as never], class_count: 1, gov_cents: 35_000 })], 35_000), 35_000, money)).toBe("1 class × 1 mark × $350");
  });
  it("falls back to the plain total when the figures are not a clean product", () => {
    expect(usptoLine(quote([name({}), name({ id: "n2" })], 420_000), 35_000, money)).toBe("USPTO fees: $4,200 (per class per mark)".replace("(per", "($350 per"));
    expect(usptoLine(quote([name({ class_count: 5 })], 175_000), 35_000, money)).toContain("USPTO fees: $1,750");
  });
  it("makes no UPL claim", () => {
    expect(usptoLine(quote([name({})], 210_000), 35_000, money)).not.toMatch(/advice|guarantee/i);
  });
});

describe("contact line (D1)", () => {
  it("takes the first email and phone from the sign-off", () => {
    const c = firmContactFromSignoff("Warmly,\nRebecca\nRPB Law, PLLC\n(305) 712-6960 | info@rpblawfirm.com");
    expect(c).toEqual({ email: "info@rpblawfirm.com", phone: "(305) 712-6960" });
    expect(contactLine(c)).toBe("(305) 712-6960 · info@rpblawfirm.com");
  });
  it("omits the line when neither is found", () => {
    expect(firmContactFromSignoff("Best regards,\nThe team")).toBeNull();
    expect(firmContactFromSignoff(null)).toBeNull();
    expect(contactLine(null)).toBeNull();
  });
  it("works with only one of the two", () => {
    expect(contactLine(firmContactFromSignoff("Write to hello@firm.co"))).toBe("hello@firm.co");
    expect(contactLine(firmContactFromSignoff("Call 305-555-0100"))).toBe("305-555-0100");
  });
});

describe("client page wiring (F8)", () => {
  const doc = readFileSync("src/components/client-proposal/ProposalDocument.tsx", "utf8");
  it("shows the sentence above Accept, the USPTO line and the contact line", () => {
    expect(doc.indexOf("commitmentSentence(")).toBeLessThan(doc.indexOf("Accept and pay my legal fee"));
    expect(doc).toContain("usptoLine(quote");
    expect(doc).toContain("firm.contactLine");
  });
  it("does not explain classes or renumber them", () => {
    expect(doc).not.toMatch(/what is a class|what’s a class|what's a class/i);
    expect(doc).toContain("`Class ${ci + 1} · ${c.label}`");
  });
  it("leaves pricing.ts untouched", () => {
    const diff = execSync("git diff HEAD --stat -- src/lib/proposals/pricing.ts").toString();
    expect(diff).toBe("");
  });
});

describe("rendered client page (F8)", () => {
  const page = (firm: { name: string; slug: string; displayName?: string; contactLine?: string | null }) =>
    renderToStaticMarkup(
      <ProposalDocument content={sevetri()} title="Trademark Proposal" clientName="Sevetri Wilson" expiresOn={null} firm={firm} mode="live" onAccept={async () => ({ ok: true, payUrl: "https://example.com/pay" })} />,
    ).replaceAll("&#x27;", "'");

  it("names the firm from its profile and shows the contact line only when there is one", () => {
    const withContact = page({ name: "Hartwell", slug: "hartwell", displayName: "Hartwell IP Group", contactLine: "hello@hartwell.test" });
    expect(withContact).toContain("By accepting, you agree to Hartwell IP Group starting work on the marks and classes above for the fees shown.");
    expect(withContact).toContain("Hartwell \u00b7 hello@hartwell.test");
    const without = page({ name: "Hartwell", slug: "hartwell" });
    expect(without).toContain("you agree to Hartwell starting work");
    expect(without).not.toContain("hello@hartwell.test");
  });
  it("shows the USPTO line with the multiplication sign", () => {
    expect(page({ name: "Hartwell", slug: "hartwell" })).toMatch(/\d+ class(es)? \u00d7 \d+ marks? \u00d7 \$350|USPTO fees: \$/);
  });
});
