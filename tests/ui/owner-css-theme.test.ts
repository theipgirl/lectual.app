import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The app is light-only: none of the shared or owner-view stylesheets may carry a dark-mode block (it used to guard dark values behind data-theme). */
describe.each([
  "src/components/deck/deck.css",
  "src/components/shell/owner-shell.css",
  "src/components/today/owner/owner-today.css",
  "src/components/shell/account-menu.css",
  "src/app/dashboard/intake/leads.css",
  "src/app/globals.css",
])("%s", (file) => {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("has no dark-mode block", () => {
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain('data-theme="dark"');
  });
});
