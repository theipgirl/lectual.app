// usage: node audit.mjs <harness-root> [ids...]  -> prints offenders per screen (font<13, contrast<4.5, mono sentence)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const root = path.resolve(process.argv[2]); const wanted = process.argv.slice(3);
const require = createRequire(path.join(root, "package.json")); const { chromium } = require("playwright");
const OUT = path.join(root, "scripts/design-harness/out");
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).filter((s) => !wanted.length || wanted.includes(s.id));
const server = http.createServer((req, res) => { const f = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": f.endsWith(".css") ? "text/css" : f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(); const summary = {};
for (const s of manifest) {
  const page = await browser.newPage({ viewport: s.viewport === "phone" ? { width: 375, height: 812 } : { width: 1440, height: 900 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(`${base}/${s.id}.html`, { waitUntil: "load" });
  const res = await page.evaluate(() => {
    const out = [];
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const comp = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (c && c.a > 0) chain.push(c); if (c && c.a === 1) break; } let base = { r: 255, g: 255, b: 255, a: 1 }; for (const c of chain.reverse()) base = comp(c, base); return base; };
    const opac = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n; (n = walker.nextNode()); ) {
      const t = n.textContent.replace(/\s+/g, " ").trim(); if (!t) continue; const el = n.parentElement; if (!el || seen.has(el + t)) continue; seen.add(el + t);
      if (["SCRIPT", "STYLE"].includes(el.tagName)) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      if (el.closest("[aria-hidden='true'],.sr-only") && r.width < 3) continue;
      const fs = parseFloat(cs.fontSize); const fam = cs.fontFamily.toLowerCase();
      const fg = parse(cs.color); const o = opac(el); const bg = bgOf(el); const fgc = comp({ ...fg, a: fg.a * o }, bg);
      const L1 = lum(fgc), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const mono = /courier/.test(fam); const words = t.split(" ").length;
      const lh = cs.lineHeight === "normal" ? 1.2 : parseFloat(cs.lineHeight) / fs;
      const cls = (el.className && el.className.baseVal === undefined ? el.className : "").toString().split(" ").slice(0, 2).join(".");
      out.push({ t: t.slice(0, 40), cls: el.tagName.toLowerCase() + (cls ? "." + cls : ""), fs, ratio: +ratio.toFixed(2), mono, words, upper: cs.textTransform === "uppercase", lh: +lh.toFixed(2), y: Math.round(r.top + scrollY) });
    }
    return out;
  });
  const bad = [];
  for (const r of res) {
    const probs = [];
    const limit = r.upper ? 12 : 13;
    if (r.fs < limit) probs.push(`size ${r.fs}`);
    if (r.ratio < 4.5) probs.push(`contrast ${r.ratio}`);
    if (r.mono && r.words >= 4) probs.push("mono-sentence");
    if (probs.length) bad.push({ ...r, probs });
  }
  summary[s.id] = bad;
  console.log(`\n## ${s.id}: ${res.length} texts, ${bad.length} flagged`);
  const agg = new Map(); for (const b of bad) { const k = b.cls + "|" + b.probs.join(","); const a = agg.get(k) ?? { n: 0, ex: b.t, fs: b.fs, ratio: b.ratio }; a.n++; agg.set(k, a); }
  for (const [k, a] of agg) console.log(`  ${k}  x${a.n}  e.g. "${a.ex}" fs=${a.fs} cr=${a.ratio}`);
  await page.close();
}
await browser.close(); server.close();
