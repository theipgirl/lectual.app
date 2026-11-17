import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Ratchet: only 640 / 641 / 900 / 901 are breakpoints. Files that still use others have a ceiling that may only go down. */
const ALLOWED = new Set([640, 641, 900, 901]);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}
const BASELINE: Record<string, number> = {
  "src/app/dashboard/copilot/copilot.css": 1,
  "src/app/dashboard/forms/_components/event.css": 1,
  "src/app/dashboard/forms/forms.css": 5,
  "src/app/dashboard/proposals/proposals.css": 12,
  "src/app/globals.css": 5,
  "src/app/i/intake-public.css": 1,
  "src/components/copilot/copilot.css": 1,
  "src/components/deck/deck.css": 1,
  "src/components/onboarding/hub.css": 1,
  "src/components/review/review.css": 1,
  "src/components/setup/setup.css": 1,
};
const counts: Record<string, number> = {};
for (const file of walk(join(process.cwd(), "src"))) {
  const css = readFileSync(file, "utf8");
  let n = 0;
  for (const m of css.matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)) if (!ALLOWED.has(Number(m[1]))) n++;
  if (n) counts[file.slice(process.cwd().length + 1)] = n;
}

describe("breakpoints", () => {
  it("no file adds an off-scale breakpoint", () => {
    for (const [file, n] of Object.entries(counts)) expect(n, file).toBeLessThanOrEqual(BASELINE[file] ?? 0);
  });
});
