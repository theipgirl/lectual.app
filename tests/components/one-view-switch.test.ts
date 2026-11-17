import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D1 (Taylor): ONE view-style switch for the whole app, src/components/ViewToggle.tsx, drawn by src/components/view-toggle.css. This test
 * fails if a second one appears. A view switch changes how the SAME records are drawn (Table | Board, Board | Sheet | Cards, Cards | List |
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
  "src/app/dashboard/reports/[key]/page.tsx": "Reports period: a date range",
  "src/app/globals.css": "the old .lx-view-toggle anchor rules, now used only by Reports' period control",
  "src/components/shell/owner-shell.css": "the .lx-view-toggle layout rule shared with Reports' period control",
  "src/app/dashboard/mail/page.tsx": "Mail folder tabs (\"Mail views\"): a tab strip of folders, ambiguous; left for Taylor",
};

describe("one view switch (D1)", () => {
  it("the old view-switch class names appear only where a non-view control still uses them", () => {
    const hits: string[] = [];
    for (const f of files) {
      if (LEFT_ALONE[f] || f === "src/components/view-toggle.css" || f === "src/components/ViewToggle.tsx") continue;
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

  it("the shared selectors are defined once, in tokens, with a focus ring and a coarse-pointer height", () => {
    const hits = files.filter((f) => f.endsWith(".css") && f !== "src/components/view-toggle.css" && read(f).includes(".vs-switch"));
    expect(hits).toEqual([]);
    const css = read("src/components/view-toggle.css");
    expect(css).toContain("--view-switch-on: #550e1a");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("var(--cream)");
    // no colour literal except the one token's own value (and its dark pair)
    const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
    expect(literals.sort()).toEqual(["#4a0c17", "#550e1a"]);
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
