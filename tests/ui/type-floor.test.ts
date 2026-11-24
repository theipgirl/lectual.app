import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ceilingCheck, cssFiles, phoneBlocks, pxFontSizes, read, staleCeilings, stripCssComments, tsxFiles } from "./_design-scan";

/**
 * Type floor (design items 15, 16, 31): no readable text under 13px (14px at or under 640px), the 13px floor is written as the token
 * var(--fs-1) so a phone gets 14px, and no font size is typed in place in a component. A RATCHET: each count may only go down.
 *   a  CSS font sizes under 13px
 *   b  CSS font sizes under 14px inside @media (max-width: 640px)
 *   c  literal `font-size: 13px` (must be var(--fs-1))
 *   d  TSX inline fontSize under 13px
 *   e  ANY TSX inline fontSize (sizes come from classes and tokens, never typed in place)
 * A file that is not listed has a ceiling of 0.
 */
const A: Record<string, number> = {};
const B: Record<string, number> = {};
const C: Record<string, number> = {};
const D: Record<string, number> = {};
/** What is left is outside the firm workspace's own pages, so it stays as it is: */
const E: Record<string, number> = {
  // The bare-domain 404 (outside the signed-in workspace; no area owns it).
  "src/app/not-found.tsx": 1,
  // Rendered on the public /q/[token] page: the design job does not restyle public pages (FOUNDATION-PLAN section 0).
  "src/components/proposal/QuoteDocument.tsx": 1,
  "src/components/proposal/Receipt.tsx": 1,
};

/** em / rem font sizes in CSS (a page's base is 15px, so 13px is 0.8667em and 14px is 0.9333em). */
function relativeFontSizes(css: string): number[] {
  return [...css.matchAll(/font-size:\s*([\d.]+)(?:r?em)\b/g)].map((m) => Number(m[1])).filter((n) => n > 0);
}
const EM_13 = 13 / 15 - 0.001;
const EM_14 = 14 / 15 - 0.001;
const F: Record<string, number> = {};
const G: Record<string, number> = {};

function measure() {
  const a: Record<string, number> = {}, b: Record<string, number> = {}, c: Record<string, number> = {}, d: Record<string, number> = {}, e: Record<string, number> = {}, f2: Record<string, number> = {}, g: Record<string, number> = {};
  for (const f of cssFiles()) {
    const css = stripCssComments(read(f));
    const all = pxFontSizes(css);
    const na = all.filter((n) => n < 13).length;
    const nb = pxFontSizes(phoneBlocks(css)).filter((n) => n < 14).length;
    const nc = (css.match(/font-size:\s*13px/g) ?? []).length;
    if (na) a[f] = na;
    if (nb) b[f] = nb;
    if (nc) c[f] = nc;
    const nf = relativeFontSizes(css).filter((n) => n < EM_13).length;
    const ng = relativeFontSizes(phoneBlocks(css)).filter((n) => n < EM_14).length;
    if (nf) f2[f] = nf;
    if (ng) g[f] = ng;
  }
  for (const f of tsxFiles()) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const sizes = [...src.matchAll(/fontSize:\s*(?:"([\d.]+)px"|'([\d.]+)px'|([\d.]+)(?![\d.]*\s*[a-z%]))/g)].map((m) => Number(m[1] ?? m[2] ?? m[3]));
    if (sizes.length) e[f] = sizes.length;
    const small = sizes.filter((n) => n > 0 && n < 13).length;
    if (small) d[f] = small;
  }
  return { a, b, c, d, e, f: f2, g };
}

describe("type floor", () => {
  const m = measure();
  if (process.env.DESIGN_DUMP) fs.writeFileSync(`${process.env.DESIGN_DUMP}/type-floor.json`, JSON.stringify(m, null, 2));
  it("a: no CSS font size under 13px beyond the ceilings", () => expect(ceilingCheck(m.a, A)).toEqual([]));
  it("b: no CSS font size under 14px inside a phone block beyond the ceilings", () => expect(ceilingCheck(m.b, B)).toEqual([]));
  it("c: the 13px floor is the token, not a literal, beyond the ceilings", () => expect(ceilingCheck(m.c, C)).toEqual([]));
  it("d: no inline fontSize under 13px beyond the ceilings", () => expect(ceilingCheck(m.d, D)).toEqual([]));
  it("e: no font size typed in place in a component beyond the ceilings", () => expect(ceilingCheck(m.e, E)).toEqual([]));
  it("f: no em/rem CSS font size under 13px (0.8667em of 15px) beyond the ceilings", () => expect(ceilingCheck(m.f, F)).toEqual([]));
  it("g: no em/rem CSS font size under 14px (0.9333em) inside a phone block beyond the ceilings", () => expect(ceilingCheck(m.g, G)).toEqual([]));
  it("no ceiling is higher than what is measured", () =>
    expect([...staleCeilings(m.a, A), ...staleCeilings(m.b, B), ...staleCeilings(m.c, C), ...staleCeilings(m.d, D), ...staleCeilings(m.e, E), ...staleCeilings(m.f, F), ...staleCeilings(m.g, G)]).toEqual([]));
  it("the shared stylesheet itself is clean", () => {
    for (const f of ["src/app/globals.css", "src/components/list-page/list-page.css", "src/components/view-toggle.css"]) {
      expect(m.a[f] ?? 0, `${f} (a)`).toBe(0);
      expect(m.b[f] ?? 0, `${f} (b)`).toBe(0);
      expect(m.c[f] ?? 0, `${f} (c)`).toBe(0);
    }
  });
});
