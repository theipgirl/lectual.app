import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/** The text of every `@media (max-width: 640px) { ... }` block in a stylesheet (braces balanced). */
function phoneBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media \(max-width: 640px\)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out.join("\n");
}

const globals = phoneBlocks(read("src/app/globals.css"));
const listPage = phoneBlocks(read("src/components/list-page/list-page.css"));

describe("compact page tops under 640px (Sprint 34 B)", () => {
  it("the h1 is at most 24px", () => {
    const sizes = [...globals.matchAll(/\.lx-h1\s*\{[^}]*font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.at(-1)).toBeLessThanOrEqual(24);
  });

  it("the sub-line is one line with an ellipsis, the eyebrow is hidden and no gap is stacked", () => {
    expect(globals).toMatch(/\.lx-page-head \.lx-sub[^{]*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
    expect(globals).toMatch(/\.lp-header \.lp-sub[^{]*\{[^}]*white-space:\s*nowrap/);
    expect(globals).toMatch(/\.lx-page-head-list \.lx-label\s*\{\s*display:\s*none/);
    expect(globals).toMatch(/\.lx-page\s*\{[^}]*gap:\s*10px/);
  });

  it("filter chips are one horizontally scrolling row (both chip families)", () => {
    expect(globals).toMatch(/\.lx-chips\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/);
    expect(listPage).toMatch(/\.lp-chips\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/);
  });

  it("toolbar buttons stay on one compact row", () => {
    expect(listPage).toMatch(/\.lp-toolbar-spacer\s*\{\s*display:\s*none/);
    expect(listPage).toMatch(/\.lp-toolbar \.lp-btn[^{]*\{[^}]*padding:\s*0 10px/);
    expect(globals).toMatch(/\.lx-head-actions\s*\{[^}]*flex-wrap:\s*nowrap/);
  });

  it("the sideways-overflow clip from Sprint 32 and the 44px touch targets are still there", () => {
    expect(globals).toMatch(/html,\s*body\s*\{\s*overflow-x:\s*clip/);
    expect(read("src/app/globals.css")).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
  });

  it("text is never below 12.5px in the new rules and the new CSS uses tokens, not hex colours", () => {
    const added = read("src/app/globals.css").split("Page header actions and")[1] + read("src/components/list-page/list-page.css").split("Compact top under 640px")[1];
    for (const m of added.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12.5);
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("all eight pages draw their top with the shared header classes", () => {
    const shared = /lx-page-head|<ListHeader/;
    for (const f of [
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/intake/_components/IntakeWorkspace.tsx",
      "src/app/dashboard/matters/page.tsx",
      "src/app/dashboard/mail/page.tsx",
      "src/app/dashboard/meetings/page.tsx",
      "src/app/dashboard/queue/page.tsx",
      "src/app/dashboard/proposals/page.tsx",
      "src/app/dashboard/calendar/page.tsx",
    ]) {
      expect(read(f), f).toMatch(shared);
    }
  });

  it("record pages and links keep their labels under 640px", () => {
    expect(globals).not.toMatch(/\.lx-page-head \.lx-label/);
    expect(read("src/app/dashboard/reports/[key]/page.tsx")).not.toMatch(/lx-page-head-list/);
    expect(read("src/app/dashboard/matters/[id]/page.tsx")).not.toMatch(/lx-page-head-list/);
    expect(read("src/app/dashboard/leads/[id]/page.tsx")).not.toMatch(/lx-page-head-list/);
  });
});
