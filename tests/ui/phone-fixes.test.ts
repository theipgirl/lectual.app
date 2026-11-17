import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_COL_WIDTHS } from "@/lib/intake/col-widths";

const read = (p: string) => readFileSync(p, "utf8");
const globals = read("src/app/globals.css");
const listPage = read("src/components/list-page/list-page.css");
const integrations = read("src/components/integrations/integrations.css");
const deck = read("src/components/deck/deck.css");

describe("what the remaining-look pass fixed", () => {
  it("an integration's button goes under its text on a phone, never on top of it", () => {
    expect(integrations).toMatch(/@media \(max-width: 640px\)[\s\S]*\.lx-int-row > summary,[\s\S]*flex-wrap:\s*wrap/);
    expect(integrations).toMatch(/\.lxi-actions[^{]*\{[^}]*flex:\s*1 1 100%/);
  });

  it("a view switch keeps one row on a phone, and the Board | List switch has a row of its own", () => {
    expect(globals).toMatch(/\.vs-switch\[data-view-switch\]\s*\{\s*flex-wrap:\s*nowrap/);
    expect(globals).toMatch(/\.lp-toolbar-actions > \.vs-switch\s*\{[^}]*flex:\s*1 1 100%/);
    expect(deck).toMatch(/\.dk-phone-switch\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("the Approvals Cards header is not a split grid, so its title and sentence get the whole column", () => {
    expect(read("src/components/deck/DeckFrame.tsx")).not.toMatch(/dk-pagehead lx-head-split/);
  });

  it("on a phone the page scrolls as a whole (a board or table is not squeezed into its own short scroller)", () => {
    expect(listPage).toMatch(/@media \(max-width: 640px\)[\s\S]*\.lp-root\s*\{\s*flex:\s*0 0 auto/);
  });

  it("the Intake list's Last contact column is wide enough for \"Waiting on them · Nov 7\" on one line", () => {
    expect(DEFAULT_COL_WIDTHS.touch ?? 0).toBeGreaterThanOrEqual(180);
  });

  it("a switched-off assistant stays readable", () => {
    const m = /\.lx-agent\.off \.lx-agent-head,[^{]*\{\s*opacity:\s*([\d.]+)/.exec(globals);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(0.8);
  });
});
