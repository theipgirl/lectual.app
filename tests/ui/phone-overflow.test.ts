import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Found by the final check at 375px: a grid column sized "auto" grows to its widest child, so a header row or a
 * pick-one switch that does not wrap pushed the Approvals List/Board and the lead page's consult-outcome card past the
 * screen, and the shell clipped what was beyond it. These pin the three rules that keep them inside.
 */
const deck = readFileSync("src/components/deck/deck.css", "utf8");
const globals = readFileSync("src/app/globals.css", "utf8");

describe("phone width: nothing is pushed past the screen", () => {
  it("the approvals frame's single column can shrink", () => {
    expect(deck).toMatch(/\.dk-frame \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(deck).toMatch(/\.dk-frame--cards \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
  it("the approvals header actions wrap on phones", () => {
    expect(deck).toMatch(/\.dk-wide-head \.lx-head-actions \{ flex-wrap: wrap; \}/);
  });
  it("a pick-one switch wraps inside the screen on phones", () => {
    const at = globals.indexOf("  .vs-switch { flex-wrap: wrap;");
    expect(at).toBeGreaterThan(0);
    const media = globals.slice(0, at).match(/@media[^{]*\{/g) ?? [];
    expect(media.at(-1)).toBe("@media (max-width: 640px) {");
  });
});
