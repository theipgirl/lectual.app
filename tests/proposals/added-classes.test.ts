import { describe, it, expect } from "vitest";
import {
  MAX_ADDED_CLASSES_PER_NAME,
  MAX_ADDED_CLASS_CHARS,
  addedClassCount,
  cleanAddedDescription,
  parseAddedClasses,
  quoteWithAddedClasses,
  withAddedClasses,
} from "@/lib/proposals/added-classes";
import { quoteProposal } from "@/lib/proposals/pricing";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

const pick = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

/** Essential-shaped: $1,950 base, 1 class included, $825 per extra class, $350 USPTO. */
function essential(): ProposalContent {
  const c = sevetri();
  c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, gov_per_class_cents: 35_000 };
  c.names = [{ ...c.names[0], classes: [c.names[0].classes[0]] }];
  return c;
}

describe("cleanAddedDescription", () => {
  it("trims and accepts plain text", () => {
    expect(cleanAddedDescription("  Online store services  ")).toEqual({ ok: true, text: "Online store services" });
  });
  it("200 characters passes, 201 is refused", () => {
    expect(cleanAddedDescription("a".repeat(MAX_ADDED_CLASS_CHARS)).ok).toBe(true);
    expect(cleanAddedDescription("a".repeat(MAX_ADDED_CLASS_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
  });
  it("counts length after trimming", () => {
    expect(cleanAddedDescription(` ${"a".repeat(200)} `).ok).toBe(true);
  });
  it("refuses empty and whitespace-only", () => {
    expect(cleanAddedDescription("")).toEqual({ ok: false, reason: "empty" });
    expect(cleanAddedDescription("   \t ")).toEqual({ ok: false, reason: "empty" });
  });
  it("refuses markup and control characters rather than cleaning them", () => {
    for (const bad of ["<script>x</script>", "a > b", "line\nbreak", "nul\u0000", "bell\u0007"]) {
      expect(cleanAddedDescription(bad)).toEqual({ ok: false, reason: "markup" });
    }
  });
  it("refuses a non-string", () => {
    for (const bad of [1, null, undefined, {}, ["x"]]) expect(cleanAddedDescription(bad)).toEqual({ ok: false, reason: "shape" });
  });
});

describe("parseAddedClasses", () => {
  const c = essential();
  const sel = pick("p-word", "p-c1");

  it("none added", () => {
    expect(parseAddedClasses(c, sel, undefined)).toEqual({ ok: true, added: {} });
    expect(parseAddedClasses(c, sel, {})).toEqual({ ok: true, added: {} });
  });
  it("5 is fine, 6 is refused", () => {
    const five = Array.from({ length: MAX_ADDED_CLASSES_PER_NAME }, (_, i) => `class ${i}`);
    expect(parseAddedClasses(c, sel, { p: five }).ok).toBe(true);
    expect(parseAddedClasses(c, sel, { p: [...five, "six"] })).toEqual({ ok: false, reason: "too_many" });
  });
  it("refuses the wrong shape and an unknown brand name", () => {
    expect(parseAddedClasses(c, sel, "x")).toEqual({ ok: false, reason: "shape" });
    expect(parseAddedClasses(c, sel, [])).toEqual({ ok: false, reason: "shape" });
    expect(parseAddedClasses(c, sel, { p: "x" })).toEqual({ ok: false, reason: "shape" });
    expect(parseAddedClasses(c, sel, { nope: ["x"] })).toEqual({ ok: false, reason: "unknown_name" });
  });
  it("one bad description refuses the whole request", () => {
    expect(parseAddedClasses(c, sel, { p: ["fine", "<bad>"] })).toEqual({ ok: false, reason: "markup" });
  });
  it("drops a brand name with no ticked mark", () => {
    expect(parseAddedClasses(sevetri(), pick("p-word", "p-c1"), { t: ["x"], p: ["y"] })).toEqual({ ok: true, added: { p: ["y"] } });
  });
});

describe("withAddedClasses and quoteWithAddedClasses: one price path", () => {
  it("an added class is one more ticked class with a server-made id", () => {
    const { content, selection } = withAddedClasses(essential(), pick("p-word", "p-c1"), { p: ["Online store"] });
    expect(content.names[0].classes[1]).toEqual({ id: "add-p-1", label: "Online store", preselected: true, client_added: true });
    expect(selection["add-p-1"]).toBe(true);
    expect(addedClassCount(content)).toBe(1);
  });

  it("does not touch the original content", () => {
    const original = essential();
    withAddedClasses(original, pick("p-word", "p-c1"), { p: ["x"] });
    expect(original.names[0].classes).toHaveLength(1);
  });

  it("never reuses an id the content already has", () => {
    const c = essential();
    c.names[0].classes.push({ id: "add-p-1", label: "taken", preselected: false });
    const { content } = withAddedClasses(c, pick("p-word", "p-c1"), { p: ["x"] });
    const ids = content.names[0].classes.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Essential, one added class on one mark: legal $2,775, USPTO $700; removing it returns $1,950 / $350", () => {
    const withOne = quoteWithAddedClasses(essential(), pick("p-word", "p-c1"), { p: ["Online store"] });
    const without = quoteWithAddedClasses(essential(), pick("p-word", "p-c1"), {});
    if (!withOne.ok || !without.ok) throw new Error("priced");
    expect(withOne.quote.legal_total_cents).toBe(277_500);
    expect(withOne.quote.gov_total_cents).toBe(70_000);
    expect(without.quote.legal_total_cents).toBe(195_000);
    expect(without.quote.gov_total_cents).toBe(35_000);
  });

  it("equals the engine for a content that really has that extra class (word + design, second-mark discount)", () => {
    const real = essential();
    real.names[0].classes.push({ id: "real", label: "Online store", preselected: true });
    const engine = quoteProposal(real, pick("p-word", "p-logo", "p-c1", "real"));
    const helper = quoteWithAddedClasses(essential(), pick("p-word", "p-logo", "p-c1"), { p: ["Online store"] });
    if (!helper.ok) throw new Error("priced");
    expect(helper.quote.legal_total_cents).toBe(engine.legal_total_cents);
    expect(helper.quote.gov_total_cents).toBe(engine.gov_total_cents);
    expect(helper.quote.gov_class_count).toBe(engine.gov_class_count);
    expect(helper.quote.names[0].marks.map((m) => m.price_cents)).toEqual(engine.names[0].marks.map((m) => m.price_cents));
  });

  it("repair: only when asked for", () => {
    const bare = pick("p-word");
    const page = quoteWithAddedClasses(essential(), bare, {});
    const server = quoteWithAddedClasses(essential(), bare, {}, { repair: true });
    expect(page.ok && page.quote.legal_total_cents).toBe(0);
    expect(server.ok && server.quote.legal_total_cents).toBe(195_000);
  });
});
