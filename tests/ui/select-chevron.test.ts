import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return name.endsWith(".css") ? [p] : [];
  });
}

const files = cssFiles("src");
const globals = readFileSync("src/app/globals.css", "utf8");

describe("select chevron", () => {
  it("has one base select rule with our own arrow and room for it", () => {
    const m = globals.match(/select:not\(\[multiple\]\):not\(\[size\]\)\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/appearance:\s*none/);
    expect(body).toMatch(/background-image:\s*url\("data:image\/svg\+xml/);
    expect(body).toMatch(/background-position:\s*right 14px center/);
    const pad = body.match(/padding-right:\s*(\d+)px/);
    expect(pad).not.toBeNull();
    expect(Number(pad![1])).toBeGreaterThanOrEqual(36);
  });

  it("never writes a background shorthand on a select", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim();
        const hasShorthand = /(^|[;\s])background\s*:/.test(m[2]);
        const onSelect = /(^|[\s>+~,])select\b/.test(selector) || /\.(lx-input|ifm-input|rc-select|cp-pkg-sel)\b/.test(selector);
        if (hasShorthand && onSelect) offenders.push(`${f}: ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
