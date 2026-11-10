import fs from "node:fs";
import path from "node:path";
import type { Screen } from "./registry";

const REPO = path.resolve(__dirname, "../..");
const OUT = path.resolve(__dirname, "out");
export const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist:wght@400;500;600&family=Courier+Prime&display=swap";

/** Copies every compiled CSS file of the last `pnpm build` into out/css and returns their file names, globals first. */
export function copyCss(): string[] {
  const dir = path.join(REPO, ".next/static/chunks");
  let files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".css")) : [];
  // HARNESS_SKIP_CSS=<regex>: leave out compiled chunks that match (their rules come from the live src copies instead), so a stale build cannot hide a difference.
  const skip = process.env.HARNESS_SKIP_CSS ? new RegExp(process.env.HARNESS_SKIP_CSS) : null;
  if (skip) files = files.filter((f) => !skip.test(fs.readFileSync(path.join(dir, f), "utf8")));
  if (files.length === 0) throw new Error("No compiled CSS in .next/static/chunks. Run `pnpm build` once.");
  fs.mkdirSync(path.join(OUT, "css"), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(dir, f), path.join(OUT, "css", f));
  // The compiled CSS points at the next/font files as ../media/<hash>.woff2: copy them next to it.
  const media = path.join(REPO, ".next/static/media");
  if (fs.existsSync(media)) fs.cpSync(media, path.join(OUT, "media"), { recursive: true });
  const isGlobals = (f: string) => fs.readFileSync(path.join(dir, f), "utf8").includes("--serif:");
  return [...files.filter(isGlobals), ...files.filter((f) => !isGlobals(f)).sort()];
}

let cssFiles: string[] | null = null;

/**
 * Every plain component stylesheet under src (all but globals.css, which needs Tailwind) is copied AFTER the compiled CSS, so
 * edits show without a rebuild. The rules are the same, so the later copy only wins where a file changed since the build.
 */
export function copySourceCss(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".css") && e.name !== "globals.css") out.push(p);
    }
  };
  walk(path.join(REPO, "src"));
  fs.mkdirSync(path.join(OUT, "src-css"), { recursive: true });
  return out.sort().map((p) => {
    const name = path.relative(path.join(REPO, "src"), p).replace(/[\\/]/g, "__");
    fs.copyFileSync(p, path.join(OUT, "src-css", name));
    return name;
  });
}

/**
 * The real app gets --font-* from next/font classes on <html>; without them every `var(--font-*), "Name"` list is invalid and
 * the face silently falls back. They are set here to the Google Fonts family names.
 */
/** A full HTML document: all compiled CSS, the three fonts, light theme, the page body. */
export function documentHtml(screen: Screen, body: string): string {
  cssFiles ??= copyCss();
  const links = [
    ...cssFiles.map((f) => `<link rel="stylesheet" href="css/${f}">`),
    ...copySourceCss().map((f) => `<link rel="stylesheet" href="src-css/${f}">`),
  ].join("\n");
  return `<!doctype html>
<html lang="en" style="--font-instrument-serif: 'Instrument Serif'; --font-geist: 'Geist'; --font-courier-prime: 'Courier Prime'">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${screen.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="${FONTS_HREF}">
${links}
</head>
<body>${body}</body>
</html>
`;
}
