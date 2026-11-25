import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COL_ORDER, DEFAULT_COL_WIDTHS, MENU_COL_WIDTH, NEXT_MIN_WIDTH, tableMinWidth, type ColKey } from "@/lib/intake/col-widths";
import { LEADS_LIST_BUILTIN } from "@/lib/leads/views";

/**
 * Guard: no column header on the Leads list is cut at its default width. PURE (no browser): the width of a header word is
 * estimated from the REAL header font size and letter-spacing in the CSS (read below, so a CSS change moves the estimate), the th's
 * horizontal padding, and ADVANCE_EM.
 *
 * ADVANCE_EM is the advance width of each capital in Geist (the app's sans face, which the kit's header uses),
 * in em, measured in Chromium at 13px with letter-spacing 0 (A-Z, one run of 20 letters / 20 / 13). The estimate for a word is
 * sum(advance * fontSize) + letterSpacing * letters, matching the rendered "TEMPERATURE" (101.6px measured, 103.2 estimated: kerning is ignored, so the estimate errs wide).
 * A header wraps at spaces (white-space: normal), so a label needs only its LONGEST WORD to fit; the th's border-box must hold
 * that word plus padding. SAFETY is a little room for rounding and font fallback.
 */
const ADVANCE_EM: Record<string, number> = {
  A: 0.668, B: 0.6724, C: 0.703, D: 0.7054, E: 0.5935, F: 0.571, G: 0.7001, H: 0.6941, I: 0.251, J: 0.5685, K: 0.621, L: 0.5515, M: 0.8581,
  N: 0.724, O: 0.739, P: 0.631, Q: 0.7331, R: 0.6721, S: 0.64, T: 0.5615, U: 0.689, V: 0.6575, W: 0.9355, X: 0.606, Y: 0.595, Z: 0.5441,
};
const SAFETY = 1;

const read = (p: string) => readFileSync(p, "utf8");
const leadsCss = read("src/app/dashboard/intake/leads.css");
const globalsCss = read("src/app/globals.css");
const sheetCss = read("src/components/review/review-sheet-edit.css");

/** The header rule of the sheet table kit (globals.css `.sheet-tbl thead th { ... }`): font size, letter spacing and padding are read from it. */
const thRule = /\.sheet-tbl thead th \{[^}]*\}/.exec(globalsCss)![0];
const letterSpacing = Number(/letter-spacing:\s*([\d.]+)(?:px)?;/.exec(thRule)![1]);
/** `padding: 10px` (one value) or `padding: 10px 12px` (vertical horizontal): the horizontal one counts, twice. */
const padX = Number(/padding:\s*\d+px(?:\s+(\d+)px)?;/.exec(thRule)!.slice(1).find(Boolean) ?? /padding:\s*(\d+)px;/.exec(thRule)![1]) * 2;
/** The header size is a type token (`var(--fs-N)`) resolved from the desktop `:root` of globals.css. */
const fontSizeRaw = /font-size:\s*([^;]+);/.exec(thRule)![1].trim();
const tokenName = /^var\((--[\w-]+)\)$/.exec(fontSizeRaw)?.[1];
const fontSize = Number(
  tokenName ? new RegExp(`${tokenName}:\\s*(\\d+)px`).exec(globalsCss)![1] : /^(\d+)px$/.exec(fontSizeRaw)![1],
);

/** The labels: the Leads List's own columns (`LEADS_LIST_BUILTIN`, the layout's defaults the table draws its headers from). */
const labels: Record<string, string> = Object.fromEntries(LEADS_LIST_BUILTIN.map((c) => [c.key, c.label]));

const wordWidth = (w: string) => [...w.toUpperCase()].reduce((n, ch) => n + (ADVANCE_EM[ch] ?? 0.75) * fontSize + letterSpacing, 0);

describe("Leads list: header labels fit their default column", () => {
  it("reads the header font from the CSS", () => {
    expect([fontSize, letterSpacing, padX]).toEqual([13, 0, 20]);
    expect(Object.keys(labels).sort()).toEqual([...COL_ORDER].sort());
  });

  it.each(COL_ORDER.filter((c) => DEFAULT_COL_WIDTHS[c] !== null))("%s: its longest word fits", (c: ColKey) => {
    const longest = Math.max(...labels[c].split(/\s+/).map(wordWidth));
    expect(DEFAULT_COL_WIDTHS[c]!).toBeGreaterThanOrEqual(Math.ceil(longest + padX + SAFETY));
  });

  it("the table still fits 1280 with the rail open (954px) without the Owner column", () => {
    expect(tableMinWidth(COL_ORDER.filter((c) => c !== "owner"), {})).toBeLessThanOrEqual(948);
    expect(MENU_COL_WIDTH + NEXT_MIN_WIDTH).toBe(178);
  });

  it("the headers rely on wrapping at words, so the CSS must keep it and must not break inside a word", () => {
    expect(thRule).toMatch(/white-space: normal;/);
    const rules = [thRule, ...sheetCss.split("\n").filter((l) => l.includes("thead th")), ...leadsCss.split("\n").filter((l) => /thead th|ix-sort/.test(l))].join("\n");
    expect(rules).not.toMatch(/white-space:\s*nowrap|word-break:\s*break-all|overflow-wrap:\s*anywhere|text-overflow/);
  });
});
