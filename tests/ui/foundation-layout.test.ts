import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Layout guards for shared rules the foundation check found broken in the design harness (round 2). */
const css = readFileSync("src/app/globals.css", "utf8");

describe("shared layout rules", () => {
  it("a chip strip never shrinks in a height-bound page column (it collapsed to 2px on the Weekly review phone screen)", () => {
    expect(css).toMatch(/\.lp-chips, \.lx-chips \{[^}]*flex-shrink: 0/);
  });

  it("the autonomy pick-one (.lx-lv) fills its card and grows to hold its confirm question, after the shared alias rules", () => {
    const alias = css.indexOf(".vs-switch :disabled, .lx-segs :disabled, .lx-lv :disabled");
    const own = css.indexOf(".lx-lv { display: flex; height: auto; min-height: var(--ctl-h); }");
    expect(alias).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(alias);
  });

  it("a board card's menu and foot controls sit above the card-wide title link", () => {
    expect(css).toMatch(/\.lx-board-menu,\n\.lx-board-card-foot :is\(a, button, select, label\) \{ position: relative; z-index: 1; \}/);
  });
});
