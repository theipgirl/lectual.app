import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A forced light theme must stay light on a dark OS: the dark values sit behind :not([data-theme="light"]) and a [data-theme="dark"] twin. */
describe.each(["src/components/deck/deck.css", "src/components/shell/owner-shell.css", "src/components/today/owner/owner-today.css"])("%s", (file) => {
  const css = readFileSync(file, "utf8");
  it("guards its dark colours with the repo's theme convention", () => {
    const media = css.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/g) ?? [];
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) expect(m).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });
});
