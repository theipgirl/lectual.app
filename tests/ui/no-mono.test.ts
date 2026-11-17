import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ceilingCheck, cssFiles, read, stripCssComments, tsxFiles } from "./_design-scan";

/**
 * No monospace where a person reads a list, label, count, date or number (design item 15): digits that must line up use
 * font-variant-numeric: tabular-nums in the sans face. A RATCHET: a file's count of monospace font declarations may only go down.
 * Allowed for good: `.lx-md code` / `.lx-md pre` in globals.css (code is code). The token definitions are not declarations and do not count.
 */
const MONO = /var\(--mono\)|monospace|courier|--font-courier-prime|--font-mono|jetbrains/i;
const CSS: Record<string, number> = {
  "src/app/dashboard/brain/brain.css": 1,
  "src/app/dashboard/campaigns/campaigns.css": 1,
  "src/app/dashboard/copilot/copilot.css": 1,
  "src/app/dashboard/forms/forms.css": 13,
  "src/app/dashboard/intake/intake.css": 2,
  "src/app/dashboard/intake/reconcile/reconcile.css": 1,
  "src/app/dashboard/proposals/proposals.css": 14,
  "src/app/dashboard/quotes/quotes.css": 20,
  "src/components/copilot/copilot.css": 4,
  "src/components/deck/deck.css": 17,
  "src/components/queue/review.css": 2,
  "src/components/review/review-sheet-edit.css": 5,
  "src/components/review/review.css": 8,
  "src/components/setup/setup.css": 1,
  "src/components/shell/account-menu.css": 3,
  "src/components/shell/owner-shell.css": 2,
  "src/components/today/owner/owner-today.css": 3,
};
const TSX: Record<string, number> = {
  "src/app/dashboard/layout.tsx": 1,
  "src/components/intake/TimeChip.tsx": 1,
  "src/components/quotes/QuoteForms.tsx": 1,
  "src/components/quotes/QuoteParts.tsx": 1,
};
const ALLOW_CSS_LINES: Array<[string, RegExp]> = [["src/app/globals.css", /^\.lx-md (code|pre)\b/]];

function measure() {
  const css: Record<string, number> = {}, tsx: Record<string, number> = {};
  for (const f of cssFiles()) {
    const text = stripCssComments(read(f));
    let n = 0;
    for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      if (ALLOW_CSS_LINES.some(([file, re]) => file === f && re.test(selector))) continue;
      for (const d of rule[2].matchAll(/(?:^|;)\s*(font-family|font)\s*:([^;]*)/g)) if (MONO.test(d[2])) n++;
    }
    if (n) css[f] = n;
  }
  for (const f of tsxFiles()) {
    const src = read(f);
    const n = [...src.matchAll(/fontFamily:\s*([^\n]*)/g)].filter((m) => MONO.test(m[1])).length + (src.match(/\bfont-mono\b/g) ?? []).length;
    if (n) tsx[f] = n;
  }
  return { css, tsx };
}

describe("no monospace", () => {
  const m = measure();
  if (process.env.DESIGN_DUMP) fs.writeFileSync(`${process.env.DESIGN_DUMP}/no-mono.json`, JSON.stringify(m, null, 2));
  it("CSS: no monospace font declaration beyond the ceilings", () => expect(ceilingCheck(m.css, CSS)).toEqual([]));
  it("TSX: no monospace fontFamily or font-mono class beyond the ceilings", () => expect(ceilingCheck(m.tsx, TSX)).toEqual([]));
  it("the shared stylesheets are clean", () => {
    for (const f of ["src/app/globals.css", "src/components/list-page/list-page.css", "src/components/view-toggle.css"]) expect(m.css[f] ?? 0, f).toBe(0);
  });
});
