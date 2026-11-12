import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandKeyAction, lockScroll } from "@/lib/proposal-editor/expand-preview";

/**
 * Editor fixes (2026-11-12), bug 3: "if I scroll up too far, the page gets blank and I can't see the preview".
 *
 * The dashboard scrolls `.lx-page` (inside `.lx-app`, 100dvh, overflow hidden), not the window. The side column was
 * `max-height: calc(100vh - 24px)`, which is 88px taller than `.lx-page` (76px top bar, 36px content padding), so its
 * bottom (the end of the preview) hung below the visible area, cut off by `.lx-content { overflow: hidden }`, and the
 * preview was a 70vh scroller of its own inside the scrolling side column. Checked in a browser (Playwright, the real
 * shell CSS, 1440x900): stuck, the column ran from y=106 to y=982 in a 900px window; now it runs 94 to 882.
 */

const css = readFileSync("src/app/dashboard/proposals/proposals.css", "utf8");

/** The declarations of the FIRST top-level rule whose selector is exactly `selector` (outside any @media). */
function topRule(selector: string): string {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let start = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === "{") {
      if (depth === 0 && flat.slice(start, i).trim() === selector) return flat.slice(i + 1, flat.indexOf("}", i));
      depth++;
    } else if (flat[i] === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (depth === 0 && flat[i] === ";") start = i + 1;
  }
  return "";
}
function mediaBlock(query: string): string {
  const at = css.indexOf(`@media (${query})`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return "";
}

describe("the side column is exactly as tall as what is visible", () => {
  it("never measures itself against the window (100vh): .lx-page, not the window, is the scroller", () => {
    expect(topRule(".pe-side")).not.toMatch(/100vh/);
    expect(topRule(".pe-side")).toMatch(/position:\s*sticky/);
    expect(topRule(".pe-side")).toMatch(/top:\s*0/);
  });

  it("on wide screens .lx-page is a size container and the column is 100cqh of it", () => {
    const wide = mediaBlock("min-width: 1081px");
    expect(wide).toMatch(/\.lx-page:has\([^)]*\.pe-side\)\s*\{[^}]*container-type:\s*size/);
    expect(wide).toMatch(/\.pe-side\s*\{[^}]*max-height:\s*100cqh/);
  });

  it("it hands the wheel over to the page at its ends (no overscroll containment), so its last part is always reachable", () => {
    expect(topRule(".pe-side")).not.toMatch(/overscroll-behavior/);
  });
});

describe("no scroller inside a scroller", () => {
  it("the preview body has no height cap and no scroll of its own", () => {
    const rule = topRule(".pe-preview-body");
    expect(rule).not.toMatch(/max-height/);
    expect(rule).not.toMatch(/overflow/);
  });

  it("the full-width preview's body is the only scroller while it is open", () => {
    expect(topRule(".pe-xp-body")).toMatch(/overflow-y:\s*auto/);
    expect(topRule(".pe-xp-root")).toMatch(/position:\s*fixed/);
  });
});

describe("bug 4: the full-width preview's keyboard and scroll lock", () => {
  it("Esc closes; Tab and Shift+Tab wrap at the ends only", () => {
    expect(expandKeyAction({ key: "Escape" }, { count: 3, current: 1 })).toEqual({ kind: "close" });
    expect(expandKeyAction({ key: "Tab" }, { count: 3, current: 2 })).toEqual({ kind: "focus", index: 0 });
    expect(expandKeyAction({ key: "Tab", shiftKey: true }, { count: 3, current: 0 })).toEqual({ kind: "focus", index: 2 });
    expect(expandKeyAction({ key: "Tab" }, { count: 3, current: 1 })).toBeNull();
    expect(expandKeyAction({ key: "Tab" }, { count: 3, current: -1 })).toEqual({ kind: "focus", index: 0 });
    expect(expandKeyAction({ key: "a" }, { count: 3, current: 1 })).toBeNull();
  });

  it("locks every page scroller while open and puts each back exactly as it was", () => {
    const page = { style: { overflow: "" } };
    const html = { style: { overflow: "auto" } };
    const unlock = lockScroll([html, page, null]);
    expect(page.style.overflow).toBe("hidden");
    expect(html.style.overflow).toBe("hidden");
    unlock();
    expect(page.style.overflow).toBe("");
    expect(html.style.overflow).toBe("auto");
  });
});

describe("bug 1: the includes table fits its card", () => {
  it("text columns can shrink, the Highlight / Remove columns have room for their words, and header and rows line up", () => {
    const rule = topRule(".pe-inc-head, .pe-inc-row");
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1\.4fr\) 5\.5rem 4\.75rem/);
    expect(rule).not.toMatch(/44px/);
    // header and rows are separate grids: a content-sized column would size differently in each
    expect(rule).not.toMatch(/max-content|\bauto\b/);
  });
});
