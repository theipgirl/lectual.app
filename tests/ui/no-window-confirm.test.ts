import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Ratchet: confirm with InlineConfirm, never the browser's dialog. Ceilings only go down. */
const CEILING: Record<string, number> = {
  "src/components/lawmatics/LawmaticsImport.tsx": 1,
  "src/components/proposal-editor/ActionForm.tsx": 1,
};
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
describe("no window.confirm", () => {
  it("is not added anywhere", () => {
    for (const file of walk(join(process.cwd(), "src"))) {
      const rel = file.slice(process.cwd().length + 1);
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const n = (code.match(/(?<![\w.])(?:window\.)?confirm\(/g) ?? []).length;
      expect(n, rel).toBeLessThanOrEqual(CEILING[rel] ?? 0);
    }
  });
});
