import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEntryFile } from "./_entry";

/**
 * Actions and route handlers decide with the SESSION. In a preview they are refused before deciding anything, so none may
 * read the viewer: no "use server" file and no route.ts imports @/lib/views/view-as (the flag module, view-as-flag.ts,
 * the pure rules and the route helpers are fine; they carry no viewer).
 */
const ROOT = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const VIEWER_IMPORT = /from\s+["']@\/lib\/views\/view-as["']|import\(\s*["']@\/lib\/views\/view-as["']\s*\)/;

describe("no server action or route handler imports the viewer", () => {
  const files = walk(path.join(ROOT, "src"));
  const entry = files.filter((f) => isEntryFile(f));

  it("finds the entry points", () => {
    expect(entry.length).toBeGreaterThan(80);
  });

  it("none of them imports @/lib/views/view-as", () => {
    const hits = entry.filter((f) => VIEWER_IMPORT.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("the route helpers and the write block don't either", () => {
    for (const f of ["src/lib/views/view-as-routes.ts", "src/lib/views/preview-safe.ts", "src/lib/views/view-as-flag.ts"]) {
      expect(VIEWER_IMPORT.test(readFileSync(path.join(ROOT, f), "utf8")), f).toBe(false);
    }
  });
});
