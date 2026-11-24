import { describe, expect, it } from "vitest";
import { cssFiles, read, stripCssComments } from "./_design-scan";

/** The app is light-only (design inconsistency item 11): no dark block, no prefers-color-scheme, in any firm-workspace stylesheet. */
describe("no dark mode in the stylesheets", () => {
  it("no prefers-color-scheme and no [data-theme=\"dark\"] outside the public pages", () => {
    const hits: string[] = [];
    for (const f of cssFiles()) {
      const css = stripCssComments(read(f));
      if (/prefers-color-scheme/.test(css)) hits.push(`${f}: prefers-color-scheme`);
      if (/data-theme=["']?dark/.test(css)) hits.push(`${f}: [data-theme="dark"]`);
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});
