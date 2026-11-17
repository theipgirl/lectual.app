import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ceilingCheck, cssFiles, read, removeBlocks, stripCssComments, tsxFiles } from "./_design-scan";

/**
 * Colours come from the tokens in globals.css (design item 12): no hex, rgb(a) or hsl(a) literal in a rule. The token blocks
 * (:root and @theme in globals.css) are where the literals live. A RATCHET: a file's literal count may only go down.
 * Not counted: url(...) (the select chevron is a data URI), and IntakePreview.tsx, which mirrors the public page's own theme.
 */
const ALLOW_TSX = new Set(["src/app/dashboard/forms/_components/IntakePreview.tsx"]);
const CSS: Record<string, number> = {
  "src/app/dashboard/copilot/copilot.css": 3,
  "src/app/dashboard/forms/forms.css": 69,
  "src/app/dashboard/intake/intake.css": 2,
  "src/app/dashboard/intake/leads.css": 1,
  "src/app/dashboard/proposals/proposals.css": 6,
  "src/app/dashboard/quotes/quotes.css": 7,
  "src/components/copilot/copilot.css": 26,
  "src/components/deck/deck.css": 9,
  "src/components/leads/lead-page.css": 1,
  "src/components/onboarding/welcome-deal.css": 1,
};
const TSX: Record<string, number> = {
  "src/app/dashboard/agents/page.tsx": 1,
  "src/app/dashboard/intake/_components/AddLeadDialog.tsx": 1,
  "src/components/intake/TimeEntryDialog.tsx": 1,
};
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

function measure() {
  const css: Record<string, number> = {}, tsx: Record<string, number> = {};
  for (const f of cssFiles()) {
    let text = stripCssComments(read(f)).replace(/url\([^)]*\)/g, "url()");
    if (f === "src/app/globals.css") text = removeBlocks(removeBlocks(text, /:root\s*\{/), /@theme[^{]*\{/);
    const n = (text.match(LITERAL) ?? []).length;
    if (n) css[f] = n;
  }
  for (const f of tsxFiles()) {
    if (ALLOW_TSX.has(f)) continue;
    const src = read(f);
    let n = 0;
    for (const s of src.matchAll(/style=\{\{[\s\S]*?\}\}/g)) n += (s[0].match(LITERAL) ?? []).length;
    if (n) tsx[f] = n;
  }
  return { css, tsx };
}

describe("colour tokens", () => {
  const m = measure();
  if (process.env.DESIGN_DUMP) fs.writeFileSync(`${process.env.DESIGN_DUMP}/colour-tokens.json`, JSON.stringify(m, null, 2));
  it("CSS: no colour literal in a rule beyond the ceilings", () => expect(ceilingCheck(m.css, CSS)).toEqual([]));
  it("TSX: no colour literal in an inline style beyond the ceilings", () => expect(ceilingCheck(m.tsx, TSX)).toEqual([]));
  it("the shared stylesheets are clean", () => {
    for (const f of ["src/app/globals.css", "src/components/list-page/list-page.css", "src/components/view-toggle.css"]) expect(m.css[f] ?? 0, f).toBe(0);
  });
});
