import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COL_ORDER, DEFAULT_COL_WIDTHS, MENU_COL_WIDTH, NEXT_MIN_WIDTH, tableMinWidth, type ColKey } from "@/lib/intake/col-widths";
import { LEADS_ASSISTANT_COLUMN, LEADS_CONTACT_COLUMN } from "@/lib/ui/words";

/**
 * Guard: no column header on the Leads list is cut at its default width. PURE (no browser): the width of a header word is
 * estimated from the REAL header font size and letter-spacing in the CSS (read below, so a CSS change moves the estimate), the th's
 * horizontal padding, and ADVANCE_EM.
 *
 * ADVANCE_EM is the advance width of each capital in Geist (the Leads workspace font, `.ix-leads` overrides --mono to Geist),
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
const sheetCss = read("src/components/review/review-sheet-edit.css");

/** The th rule of the Sheet (`.rv-owner .rse-tbl thead th { ... font-size ... }` with `position: relative`) and Leads' 13px override. */
const thRule = sheetCss.split("\n").find((l) => l.includes(".rv-owner .rse-tbl thead th {") && l.includes("letter-spacing"))!;
const letterSpacing = Number(/letter-spacing:\s*([\d.]+)px/.exec(thRule)![1]);
const padX = Number(/padding:\s*\d+px\s+(\d+)px/.exec(thRule)![1]) * 2;
/** Leads' header size: a px literal, or a type token (`var(--fs-N)`) resolved from the desktop `:root` of globals.css. */
const globalsCss = read("src/app/globals.css");
const fontSizeRaw = /\.ix-leads \.rv-owner \.rse-tbl thead th[^{]*\{\s*font-size:\s*([^;]+);/.exec(leadsCss)![1].trim();
const tokenName = /^var\((--[\w-]+)\)$/.exec(fontSizeRaw)?.[1];
const fontSize = Number(
  tokenName ? new RegExp(`${tokenName}:\\s*(\\d+)px`).exec(globalsCss)![1] : /^(\d+)px$/.exec(fontSizeRaw)![1],
);

/** The labels, read from the table's own COLUMNS map (two come from the words file). */
const tableSrc = read("src/app/dashboard/intake/_components/IntakeTable.tsx");
const labels: Record<string, string> = {};
for (const m of tableSrc.matchAll(/^\s+(\w+): \{ key: [^,]+, label: ([^}]+?) \},?$/gm)) {
  const raw = m[2].trim();
  labels[m[1]] = raw === "LEADS_ASSISTANT_COLUMN" ? LEADS_ASSISTANT_COLUMN : raw === "LEADS_CONTACT_COLUMN" ? LEADS_CONTACT_COLUMN : JSON.parse(raw);
}

const wordWidth = (w: string) => [...w.toUpperCase()].reduce((n, ch) => n + (ADVANCE_EM[ch] ?? 0.75) * fontSize + letterSpacing, 0);

describe("Leads list: header labels fit their default column", () => {
  it("reads the header font from the CSS", () => {
    expect([fontSize, letterSpacing, padX]).toEqual([13, 1, 20]);
    expect(Object.keys(labels).sort()).toEqual([...COL_ORDER].sort());
  });

  it.each(COL_ORDER.filter((c) => DEFAULT_COL_WIDTHS[c] !== null))("%s: its longest word fits", (c: ColKey) => {
    const longest = Math.max(...labels[c].split(/\s+/).map(wordWidth));
    expect(DEFAULT_COL_WIDTHS[c]!).toBeGreaterThanOrEqual(Math.ceil(longest + padX + SAFETY));
  });

  it("the table still fits 1280 with the rail open (954px) without the Owner column", () => {
    expect(tableMinWidth(COL_ORDER.filter((c) => c !== "owner"), {})).toBeLessThanOrEqual(948);
    expect(MENU_COL_WIDTH + NEXT_MIN_WIDTH).toBe(202);
  });

  it("the headers rely on wrapping at words, so the CSS must keep it and must not break inside a word", () => {
    expect(sheetCss).toMatch(/\.rv-owner \.rse-tbl thead th \{ white-space: normal;/);
    const rules = [thRule, ...sheetCss.split("\n").filter((l) => l.includes("thead th")), ...leadsCss.split("\n").filter((l) => /thead th|ix-sort/.test(l))].join("\n");
    expect(rules).not.toMatch(/white-space:\s*nowrap|word-break:\s*break-all|overflow-wrap:\s*anywhere|text-overflow/);
  });
});
