import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Changed on purpose: the client page's work bullets are now line-item rows (`.cp-work-lines`), not a bulleted list.
describe("flat-fee work lines", () => {
  it("draws rows with a hairline and a right-aligned hours cell, no bullet list", () => {
    const css = readFileSync("src/components/client-proposal/proposal.css", "utf8");
    expect(css).not.toMatch(/\.cp-work-details/);
    expect(css).toMatch(/\.cp-work-lines td\s*\{[^}]*border-bottom:\s*1px solid var\(--cp-line\)/);
    expect(css).toMatch(/\.cp-work-lines td\.cp-num\s*\{[^}]*text-align:\s*right/);
  });
});

describe("staff card work bullets", () => {
  it("draws a bullet marker on .pe-work-details", () => {
    const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
    expect(css).toMatch(/\.pe-work-details\s*\{[^}]*list-style:\s*disc/);
  });
});
