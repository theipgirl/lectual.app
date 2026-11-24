// Shared scanner for the design guards (type floor, no monospace, colour tokens, no dark mode).
// The guards are RATCHETS: each counts offenders per file and fails when a file is ABOVE its ceiling. A file that is not
// listed has a ceiling of 0. A rollout area only ever lowers a count; the integrator lowers every ceiling to the measured value.
// Public pages and sign-in are not part of the firm workspace and are skipped.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");

const SKIP_PREFIXES = [
  "src/app/p/",
  "src/app/i/",
  "src/app/r/",
  "src/app/q/",
  "src/app/auth/",
  "src/app/sign-in/",
  "src/components/client-proposal/",
];

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.test(e.name)) out.push(rel);
  }
  return out;
}

const skipped = (f: string) => SKIP_PREFIXES.some((p) => f.startsWith(p));
export const cssFiles = (): string[] => walk("src", /\.css$/).filter((f) => !skipped(f)).sort();
export const tsxFiles = (): string[] => walk("src", /\.tsx$/).filter((f) => !skipped(f)).sort();
export const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), "utf8");

/** CSS with comments removed (line structure kept). */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** The body of every top-level-or-nested `@media (max-width: 640px) { ... }` block (braces balanced). */
export function phoneBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media[^{]*max-width:\s*640px[^{]*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out.join("\n");
}

/** Remove every balanced `selector { ... }` block whose selector matches `head` (used to drop :root and @theme token blocks). */
export function removeBlocks(css: string, head: RegExp): string {
  let out = "";
  let i = 0;
  const re = new RegExp(head.source, head.flags.includes("g") ? head.flags : head.flags + "g");
  for (let m = re.exec(css); m; m = re.exec(css)) {
    out += css.slice(i, m.index);
    let depth = 1;
    let j = re.lastIndex;
    for (; j < css.length && depth > 0; j++) depth += css[j] === "{" ? 1 : css[j] === "}" ? -1 : 0;
    i = j;
    re.lastIndex = j;
  }
  return out + css.slice(i);
}

/** Every `font-size: Npx` and `font: ... Npx` size in a stylesheet (comments already stripped). Sizes of 0 are skipped. */
export function pxFontSizes(css: string): number[] {
  const sizes: number[] = [];
  for (const m of css.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(Number(m[1]));
  for (const m of css.matchAll(/(?:^|[;{\s])font:\s*[^;{}]*?([\d.]+)px/g)) sizes.push(Number(m[1]));
  return sizes.filter((n) => n > 0);
}

export function count<T>(rows: T[]): number {
  return rows.length;
}

/**
 * The other half of the ratchet, added at integration: a ceiling above what is measured excuses nothing and must be lowered (or
 * removed at 0), so a table only ever lists what is really left.
 */
export function staleCeilings(measured: Record<string, number>, ceiling: Record<string, number>): string[] {
  const stale: string[] = [];
  for (const [f, max] of Object.entries(ceiling)) {
    const n = measured[f] ?? 0;
    if (max > n) stale.push(`${f}: ceiling ${max}, measured ${n} (lower it${n === 0 ? " by removing the entry" : ""})`);
  }
  return stale;
}

/** Drop zero entries so a ceiling table lists only files that still have offenders. */
export function ceilingCheck(measured: Record<string, number>, ceiling: Record<string, number>): string[] {
  const bad: string[] = [];
  for (const [f, n] of Object.entries(measured)) {
    const max = ceiling[f] ?? 0;
    if (n > max) bad.push(`${f}: ${n} (ceiling ${max})`);
  }
  return bad;
}
