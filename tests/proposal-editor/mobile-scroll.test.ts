import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");

/** Declarations of `selector` inside the first `@media (max-width: 1080px)` block. */
function narrowRule(selector: string): string | null {
  const start = css.indexOf("@media (max-width: 1080px)");
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf("\n}", start));
  const m = block.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

describe("proposal page on a phone", () => {
  it("does not nest a scroller in the side column or the preview", () => {
    for (const sel of [".pe-side", ".pe-preview-body"]) {
      const rule = narrowRule(sel);
      expect(rule, sel).toMatch(/max-height:\s*none/);
      expect(rule, sel).toMatch(/overflow:\s*visible/);
    }
  });
});
