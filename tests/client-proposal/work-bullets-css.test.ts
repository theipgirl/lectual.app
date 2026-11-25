import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tailwind's reset sets `list-style: none` on every list, so the work-item bullets must set their own marker back.
describe("flat-fee work bullets", () => {
  it("draws a bullet marker on .cp-work-details", () => {
    const css = readFileSync("src/components/client-proposal/proposal.css", "utf8");
    expect(css).toMatch(/\.cp-work-details\s*\{[^}]*list-style:\s*disc/);
    expect(css).toMatch(/\.cp-work-details li\s*\{[^}]*display:\s*list-item/);
  });
});

describe("staff card work bullets", () => {
  it("draws a bullet marker on .pe-work-details", () => {
    const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");
    expect(css).toMatch(/\.pe-work-details\s*\{[^}]*list-style:\s*disc/);
  });
});
