import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { normalizeSelection } from "@/lib/proposals/pricing";
import { buildExhibit, exhibitLines } from "@/lib/loe/exhibit";
import { generalWithLoe, twoBrandPerMark, withLoe } from "./loe-fixtures";

function priced(content = withLoe(twoBrandPerMark())) {
  // Both brands' word marks, The Fold's design mark on Essential, The Fold's second class off, The Confidence Interval's class one;
  // plus a class the client typed on The Confidence Interval.
  const selection = normalizeSelection(content, {
    "fold-word": true,
    "fold-logo": true,
    "fold-c1": true,
    "fold-c2": false,
    "ci-word": true,
    "ci-logo": false,
    "ci-c1": true,
    "ci-c2": false,
  });
  const result = quoteWithClientClasses(content, selection, { entries: {}, added: { ci: [{ text: "Gaming consoles", on: true }] } }, { repair: true });
  if (!result.ok) throw new Error("no quote");
  return result;
}

describe("Exhibit A (trademark, two brands, a package per mark)", () => {
  it("lists every selected mark with its package, and nothing unselected", () => {
    const p = priced();
    const exhibit = buildExhibit(p.content, p.quote, money);
    const all = JSON.stringify(exhibit);
    expect(exhibit.groups.map((g) => g.title)).toEqual(["The Fold", "The Confidence Interval"]);
    const fold = exhibit.groups[0].rows;
    expect(fold.find((r) => r.label === "Word mark")?.detail).toContain("Enhanced");
    expect(fold.find((r) => r.label === "Logo mark" || r.label === "Design mark")?.detail).toContain("Essential");
    expect(fold.map((r) => r.label)).toContain("Class: Clothing");
    // Unselected class, unselected design mark of the second brand, the package nobody picked.
    expect(all).not.toContain("Online retail");
    expect(all).not.toContain("Consulting");
    expect(exhibit.groups[1].rows.filter((r) => r.label === "Word mark" || r.label === "Logo mark" || r.label === "Design mark")).toHaveLength(1);
    expect(exhibit.groups[1].rows.find((r) => r.label === "Word mark")?.detail).toContain("Concierge");
  });

  it("includes the classes the client typed", () => {
    const p = priced();
    const labels = buildExhibit(p.content, p.quote, money).groups[1].rows.map((r) => r.label);
    expect(labels).toContain("Class: Gaming consoles");
  });

  it("every figure equals the engine's quote, cent for cent", () => {
    const p = priced();
    const exhibit = buildExhibit(p.content, p.quote, money);
    for (const qn of p.quote.names.filter((n) => n.included)) {
      const group = exhibit.groups.find((g) => g.title === qn.name)!;
      expect(group.rows.find((r) => r.label === `Legal fee for ${qn.name}`)?.amount).toBe(money(qn.legal_cents));
      expect(group.rows.find((r) => r.label.startsWith("USPTO filing fee"))?.amount).toBe(money(qn.gov_cents));
      for (const m of qn.marks) {
        const row = group.rows.find((r) => r.amount === money(m.price_before_custom_discount_cents ?? m.price_cents));
        expect(row).toBeTruthy();
      }
    }
    expect(exhibit.legalDue.amount).toBe(money(p.quote.legal_total_cents));
    expect(exhibit.usptoDue?.amount).toBe(money(p.quote.gov_total_cents));
  });

  it("shows a brand discount and a credit as reductions the quote holds", () => {
    const content = withLoe(twoBrandPerMark());
    content.names[0].discount_pct = 10;
    content.adjustments = [{ id: "cr", label: "Consult credit", kind: "amount", value: 10_000 }];
    const p = priced(content);
    const exhibit = buildExhibit(p.content, p.quote, money);
    const qn = p.quote.names[0];
    expect(qn.discount_cents).toBeGreaterThan(0);
    expect(exhibit.groups[0].rows.find((r) => r.label === "Discount")?.amount).toBe(`−${money(qn.discount_cents!)}`);
    const credit = exhibit.groups.find((g) => g.title === "Credits")!;
    expect(credit.rows[0].amount).toBe(`−${money(p.quote.adjustments[0].discount_cents)}`);
  });

  it("is deterministic", () => {
    const p = priced();
    expect(buildExhibit(p.content, p.quote, money)).toEqual(buildExhibit(p.content, p.quote, money));
  });

  it("has plain text lines for the agreement", () => {
    const p = priced();
    const lines = exhibitLines(buildExhibit(p.content, p.quote, money)).join("\n");
    expect(lines).toContain("Exhibit A: Fee Structure and Estimated Costs");
    expect(lines).toContain("Legal fee due now");
  });
});

describe("Exhibit A (flat fee)", () => {
  it("shows the matter, the work and the flat fee, and no USPTO line", () => {
    const content = generalWithLoe();
    const result = quoteWithClientClasses(content, {}, { entries: {}, added: {} }, { repair: true });
    if (!result.ok) throw new Error("no quote");
    const exhibit = buildExhibit(result.content, result.quote, money);
    expect(exhibit.groups[0].title).toBe(content.general!.matter_title);
    expect(exhibit.groups[0].rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Review both management agreements", "Flat fee"]));
    expect(exhibit.groups[0].rows.find((r) => r.label === "Flat fee")?.amount).toBe("$500");
    expect(exhibit.groups[0].rows.find((r) => r.label === "Value of the work")?.amount).toBe("$1,250");
    expect(exhibit.usptoDue).toBeNull();
    expect(JSON.stringify(exhibit)).not.toMatch(/USPTO/);
    expect(exhibit.legalDue.amount).toBe("$500");
  });
});

describe("the formatter does no money arithmetic", () => {
  it("exhibit.ts has no multiplication or addition (comments and strings aside)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/loe/exhibit.ts"), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    expect(code).not.toMatch(/[*+]/);
    expect(code).not.toMatch(/Math\.(floor|ceil|trunc)/);
  });
});
