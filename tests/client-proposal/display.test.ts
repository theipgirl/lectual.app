import { describe, expect, it } from "vitest";
import { markDisplayPrices } from "@/components/client-proposal/display";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";

describe("markDisplayPrices", () => {
  it("shows ticked marks at the quote's own prices (first full, second 20% off)", () => {
    const content = sevetri();
    const sel = defaultSelection(content);
    const d = markDisplayPrices(content, sel);
    const q = quoteProposal(content, sel);
    for (const qn of q.names) {
      for (const m of qn.marks) {
        expect(d[m.id].price_cents).toBe(m.price_cents);
        expect(d[m.id].second).toBe(m.second);
      }
    }
    expect(d["p-word"].price_cents).toBe(495_000 + 82_500 * (2 - 3));
    expect(d["p-logo"].second).toBe(true);
  });

  it("prices an unticked mark as what ticking it would add", () => {
    const content = sevetri();
    const sel = { ...defaultSelection(content), "p-logo": false };
    const d = markDisplayPrices(content, sel);
    const withLogo = quoteProposal(content, defaultSelection(content)).names[0].marks.find((m) => m.id === "p-logo")!;
    expect(d["p-logo"].price_cents).toBe(withLogo.price_cents);
    expect(d["p-logo"].second).toBe(true);
  });

  it("prices a brand name with no class ticked as if all its classes were, never $0", () => {
    const content = sevetri();
    const sel = { ...defaultSelection(content), "p-c1": false, "p-c2": false };
    const d = markDisplayPrices(content, sel);
    expect(d["p-word"].price_cents).toBeGreaterThan(0);
    expect(d["p-word"].class_count).toBe(2);
  });

  it("an untouched first mark with nothing else ticked is the base price", () => {
    const content = sevetri();
    const sel = { ...defaultSelection(content), "p-word": false, "p-logo": false };
    const d = markDisplayPrices(content, sel);
    expect(d["p-word"].second).toBe(false);
    expect(d["p-word"].price_cents).toBe(d["p-word"].base_cents);
  });
});
