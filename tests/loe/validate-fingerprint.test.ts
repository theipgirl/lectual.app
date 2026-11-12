import { describe, it, expect } from "vitest";
import { agreementFingerprint, canonicalJson, loeIssues, validateTemplate } from "@/lib/loe";

describe("validateTemplate returns every problem", () => {
  it("accepts a good letter", () => {
    expect(validateTemplate({ title: "Engagement letter", body: "Dear {{client_name}},\n\n{{date}}" })).toEqual([]);
  });

  it("refuses an unknown merge field, naming it", () => {
    const issues = validateTemplate({ title: "T", body: "Hello {{foo}} and {{bar}}" });
    expect(issues.map((i) => i.message).join(" ")).toContain("{{foo}}");
    expect(issues.map((i) => i.message).join(" ")).toContain("{{bar}}");
  });

  it("refuses an empty title and an empty body, both reported at once", () => {
    const issues = validateTemplate({ title: "  ", body: "" });
    expect(issues.map((i) => i.path).sort()).toEqual(["body", "title"]);
  });

  it("refuses a body over 60,000 characters and accepts exactly 60,000", () => {
    expect(validateTemplate({ title: "T", body: "a".repeat(60_001) }).some((i) => i.path === "body")).toBe(true);
    expect(validateTemplate({ title: "T", body: "a".repeat(60_000) })).toEqual([]);
  });

  it("returns a title problem, a field problem and an unclosed brace together, not only the first", () => {
    const issues = validateTemplate({ title: "", body: "{{nope}} and {{" });
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.some((i) => i.path === "title")).toBe(true);
    expect(issues.some((i) => /nope/.test(i.message))).toBe(true);
    expect(issues.some((i) => /does not close/.test(i.message))).toBe(true);
  });

  it("refuses non-text input", () => {
    expect(validateTemplate({ title: 5, body: null }).length).toBe(2);
  });
});

describe("loeIssues", () => {
  const good = { kind: "trademark", template_id: "abc", template_version: 2, title: "Letter", body: "Dear {{client_name}}" };
  it("passes a good block and checks the kind against the proposal's", () => {
    expect(loeIssues(good, "trademark")).toEqual([]);
    expect(loeIssues(good, "general").map((i) => i.path)).toContain("loe.kind");
  });
  it("refuses malformed blocks", () => {
    expect(loeIssues("a letter", "trademark")[0].path).toBe("loe");
    expect(loeIssues(null, "trademark")[0].path).toBe("loe");
    expect(loeIssues([], "trademark")[0].path).toBe("loe");
    expect(loeIssues({ ...good, body: undefined }, "trademark").map((i) => i.path)).toContain("loe.body");
    expect(loeIssues({ ...good, template_version: 0 }, "trademark").map((i) => i.path)).toContain("loe.template_version");
  });
});

describe("agreementFingerprint", () => {
  const parts = {
    letter: [{ lead: "A.", text: "Dear Pat" }],
    details: { signer_name: "Pat Client", address: { line1: "1 Main" } },
    exhibit: { names: [{ name: "The Fold", classes: ["Clothing"] }], legal_total_cents: 325000 },
  };

  it("is sha256 hex", () => {
    expect(agreementFingerprint(parts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order and the whitespace of any serialisation", () => {
    const reordered = {
      exhibit: { legal_total_cents: 325000, names: [{ classes: ["Clothing"], name: "The Fold" }] },
      details: { address: { line1: "1 Main" }, signer_name: "Pat Client" },
      letter: [{ text: "Dear Pat", lead: "A." }],
    };
    expect(agreementFingerprint(reordered)).toBe(agreementFingerprint(parts));
    const viaJson = JSON.parse(JSON.stringify(parts, null, 4));
    expect(agreementFingerprint(viaJson)).toBe(agreementFingerprint(parts));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it("changes with one letter of the letter, one detail, or one exhibit character", () => {
    const base = agreementFingerprint(parts);
    expect(agreementFingerprint({ ...parts, letter: [{ lead: "A.", text: "Dear Pam" }] })).not.toBe(base);
    expect(agreementFingerprint({ ...parts, details: { ...parts.details, signer_name: "Pat Clien" } })).not.toBe(base);
    expect(agreementFingerprint({ ...parts, exhibit: { ...parts.exhibit, names: [{ name: "The Fol", classes: ["Clothing"] }] } })).not.toBe(base);
    expect(agreementFingerprint({ ...parts, exhibit: { ...parts.exhibit, legal_total_cents: 325001 } })).not.toBe(base);
  });

  it("distinguishes which part a value sits in", () => {
    expect(agreementFingerprint({ letter: "x", details: "y", exhibit: "z" })).not.toBe(agreementFingerprint({ letter: "y", details: "x", exhibit: "z" }));
  });
});
