import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * On a firm's proposals domain the old lectual project rewrites only these prefixes to this app
 * (its next.config.ts). A root-relative asset anywhere else 404s there, so it cannot be added silently.
 */
const REWRITTEN = ["/_next/static/", "/brand/"];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx|css)$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("the client page only references assets lectual rewrites", () => {
  const files = [...sources("src/app/p"), ...sources("src/components/client-proposal")];
  it.each(files)("%s", (f) => {
    const text = readFileSync(f, "utf8");
    const refs = [...text.matchAll(/(?:src|poster)=["']\/(?!\/)([^"']*)["']|url\(\s*["']?\/(?!\/)([^"')]*)/g)].map((m) => "/" + (m[1] ?? m[2]));
    for (const ref of refs) expect(REWRITTEN.some((p) => ref.startsWith(p)), ref).toBe(true);
  });
  it("scans something", () => expect(files.length).toBeGreaterThan(0));
});
