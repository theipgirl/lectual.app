import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D1 (Taylor): ONE view-style switch for the whole app, src/components/ViewToggle.tsx, drawn by the `.vs-switch` rules in src/app/globals.css. This test
 * fails if a second one appears. A view switch changes how the SAME records are drawn (Board | List, Board | List | Cards, Cards | List |
 * Board, Month | Week). It is NOT a chip, filter pill, tab, period or date-range control; those stay as they are and are listed below.
 *
 * Detection (a pattern, not a proof): (1) the old view-switch class names may appear only in the files listed; (2) a `<nav>` or
 * `role="group"` whose aria-label names a view ("... view" / "View") may appear only in ViewToggle.tsx or in the listed files;
 * (3) the shared selectors are defined in one stylesheet only; (4) each known view-switch page imports and uses <ViewToggle>.
 */
const ROOT = path.resolve(__dirname, "../..");
function all(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) all(rel, out);
    else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const files = all("src");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

/** Left alone on purpose (not view switches). Taylor gets this as a checklist. */
const LEFT_ALONE: Record<string, string> = {
  "src/app/dashboard/reports/[key]/page.tsx": "Reports period: a pick-one switch that already wears the shared look through the .lx-view-toggle alias",
  "src/app/globals.css": "the one definition of .vs-switch and its aliases (.lx-segs, .lx-lv, .lx-view-toggle)",
  "src/app/dashboard/mail/page.tsx": "Mail folder tabs (\"Mail views\"): a tab strip of folders, ambiguous; left for Taylor",
};

describe("one view switch (D1)", () => {
  it("the old view-switch class names appear only where a non-view control still uses them", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (LEFT_ALONE[f] || f === "src/components/ViewToggle.tsx") continue;
      const text = read(f);
      for (const name of ["dk-switch", "lx-view-toggle", "rv-view-switch", "view-switch"]) if (text.includes(name)) hits.push(`${f}: ${name}`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("no nav or group outside the shared component is labelled as a view switch", () => {
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".tsx") && x !== "src/components/ViewToggle.tsx" && !LEFT_ALONE[x])) {
      const text = read(f);
      if (/<nav[^>]*aria-label="[^"]*\b[Vv]iews?"/.test(text) || /role="group"[^>]*aria-label="[^"]*\b[Vv]iews?"/.test(text)) offenders.push(f);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the shared selectors are defined once, in globals, in tokens, with a focus ring and a coarse-pointer height", () => {
    const hits = files.filter((f) => f.endsWith(".css") && f !== "src/app/globals.css" && /\.vs-switch|\.lx-segs|\.lx-view-toggle/.test(read(f)));
    expect(hits).toEqual([]);
    expect(files).not.toContain("src/components/view-toggle.css");
    const css = read("src/app/globals.css");
    expect(css.match(/^\.vs-switch,$/gm) ?? []).toHaveLength(1);
    const block = css.slice(css.indexOf("the ONE pick-one switch"), css.indexOf("the ONE pick-one switch") + 4500);
    expect(block).toContain("background: var(--ox)");
    expect(block).toContain(":focus-visible");
    expect(block).toContain("var(--cream)");
    expect(block).toContain('[aria-pressed="true"]');
    expect(block).toContain("label:has(input:checked)");
    // coarse pointers and phones: 44px
    expect(css).toMatch(/pointer: coarse\), \(max-width: 640px\) \{[\s\S]*\.vs-switch a,[\s\S]*min-height: 44px/);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toContain("--view-switch-on");
  });

  it("the default views are Board then List, from the glossary, and no switch says Table or Sheet", () => {
    const toggle = read("src/components/ViewToggle.tsx");
    expect(toggle).toMatch(/value: "board", label: VIEW_BOARD[\s\S]*value: "table", label: VIEW_LIST/);
    const words = read("src/lib/ui/words.ts");
    expect(words).toContain('export const VIEW_LIST = "List";');
    expect(words).toContain("export const REVIEW_SHEET_VIEW = VIEW_LIST;");
    const offenders: string[] = [];
    for (const f of files.filter((x) => x.endsWith(".tsx"))) {
      const text = read(f);
      if (/label:\s*"(Table|Sheet)"/.test(text) || />Sheet</.test(text) && text.includes("ViewToggle")) offenders.push(f);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    expect(read("src/components/review/ReviewViews.tsx")).toContain("sheet: REVIEW_SHEET_VIEW");
    const deck = read("src/components/deck/DeckFrame.tsx");
    expect(deck.indexOf("DECK_VIEW_CARDS }")).toBeLessThan(deck.indexOf("DECK_VIEW_LIST }"));
    expect(deck.indexOf("DECK_VIEW_LIST }")).toBeLessThan(deck.indexOf("DECK_VIEW_BOARD }"));
  });

  it("every page that switches views goes through <ViewToggle>", () => {
    for (const f of [
      "src/components/deck/DeckFrame.tsx",
      "src/components/review/ReviewViews.tsx",
      "src/app/dashboard/intake/_components/IntakeWorkspace.tsx",
      "src/app/dashboard/matters/page.tsx",
      "src/app/dashboard/calendar/page.tsx",
    ]) {
      const text = read(f);
      expect(text, f).toContain('from "@/components/ViewToggle"');
      expect(text, f).toContain("<ViewToggle");
    }
    expect(read("src/components/ViewToggle.tsx")).toContain("data-view-switch");
  });
});
