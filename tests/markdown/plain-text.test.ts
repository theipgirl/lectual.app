import { describe, it, expect } from "vitest";
import { markdownToPlainText } from "@/lib/markdown";

describe("markdownToPlainText (F5)", () => {
  it("strips heading, bold and table debris but keeps the words", () => {
    const out = markdownToPlainText("# T\n**b** | c |\n|---|");
    expect(out).not.toContain("#");
    expect(out).not.toContain("**");
    expect(out).not.toContain("|---|");
    expect(out).not.toContain("|");
    for (const word of ["T", "b", "c"]) expect(out).toContain(word);
  });

  it("reduces links to their text and drops list bullets", () => {
    const out = markdownToPlainText("See [the guide](https://a.example) now\n\n- one\n- two\n\n1. three");
    expect(out).toContain("See the guide now");
    expect(out).not.toContain("https://a.example");
    expect(out).not.toMatch(/^- /m);
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("three");
  });

  it("flattens a real table to its cells", () => {
    const out = markdownToPlainText("| Service | Fee |\n|---|---|\n| Filing | $850 |");
    expect(out).toContain("Service Fee");
    expect(out).toContain("Filing $850");
    expect(out).not.toContain("|");
    expect(out).not.toContain("---");
  });

  it("removes emphasis and code marks and keeps code text", () => {
    expect(markdownToPlainText("*a* _b_ `c` ~~d~~")).toBe("a b c ~~d~~");
    expect(markdownToPlainText("```\nraw **x**\n```")).toBe("raw **x**");
  });

  it("handles empty and whitespace input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText("  \n\n ")).toBe("");
  });

  it("leaves a plain sentence unchanged", () => {
    expect(markdownToPlainText("Thanks for your time today.")).toBe("Thanks for your time today.");
  });
});
