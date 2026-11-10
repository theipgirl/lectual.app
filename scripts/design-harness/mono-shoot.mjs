#!/usr/bin/env node
// Mono screens: shoot (desktop 1440 x HARNESS_DESKTOP_HEIGHT, phone 375x812 full page) AND audit the rendered text.
//   MONO_OUT=<dir with the rendered html> MONO_FONTS=<font cache dir> node mono-shoot.mjs [id ...]
// Writes <out>/shots/<id>.png and <out>/audit/<id>.json: sentence-like Courier text, text under 13px, muted text under 4.5:1.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.MONO_OUT || path.join(here, "out"));
const CACHE = path.resolve(process.env.MONO_FONTS || path.join(here, "out/font-cache"));
const H = Number(process.env.HARNESS_DESKTOP_HEIGHT) || 2400;
const VIEWPORTS = { d: { width: 1440, height: H }, p: { width: 375, height: 812 } };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const wanted = process.argv.slice(2);
const ids = fs.readdirSync(OUT).filter((f) => /^mono-.*\.html$/.test(f)).map((f) => f.replace(/\.html$/, "")).filter((id) => !wanted.length || wanted.includes(id));
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
fs.mkdirSync(path.join(OUT, "audit"), { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function fontBody(url) {
  const file = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, execFileSync("curl", ["-sSf", "-m", "30", "-A", UA, url], { maxBuffer: 64 * 1024 * 1024 }));
    fs.renameSync(tmp, file);
  }
  return fs.readFileSync(file);
}
const FONT_TYPES = { ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff" };

const AUDIT = () => {
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const bgOf = (el) => {
    let acc = null;
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { if (c[3] >= 1) return acc ? mix(acc, c) : c; acc = acc ? mix(acc, c) : c; }
    }
    const base = [255, 255, 255, 1];
    return acc ? mix(acc, base) : base;
  };
  const mix = (top, bot) => [top[0] * top[3] + bot[0] * (1 - top[3]), top[1] * top[3] + bot[1] * (1 - top[3]), top[2] * top[3] + bot[2] * (1 - top[3]), 1];
  const sig = (el) => { const c = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).slice(0, 2).join("."); return el.tagName.toLowerCase() + (c ? "." + c : ""); };
  const SHELL = "header.lx-top, nav[aria-label=Navigate], [class*=lx-rail], [class*=lx-mbar], [class*=lx-more], [class*=lx-bell], [class*=lx-avatar], [class*=lx-acct], [class*=lx-menu]";
  const out = { shell: [], courierSentences: [], courier: [], courierAll: 0, small: [], badge: [], lowContrast: [], texts: 0 };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TITLE"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // hidden via ancestor (details closed, etc.)
    let hidden = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === "none" || s.visibility === "hidden") { hidden = true; break; }
      if (a.tagName === "DETAILS" && !a.open && el.closest("summary") === null) { hidden = true; break; }
    }
    if (hidden) continue;
    if (el.closest(SHELL)) { if (parseFloat(cs.fontSize) < 13 && !out.shell.some((x) => x.el === sig(el))) out.shell.push({ text: t.slice(0, 30), size: parseFloat(cs.fontSize), el: sig(el) }); continue; }
    out.texts++;
    const size = parseFloat(cs.fontSize);
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const upper = cs.textTransform === "uppercase" || (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length > 1);
    const words = t.split(" ").length;
    const isCourier = /courier/i.test(fam) || (/mono|courier/i.test(cs.fontFamily.split(",")[0]));
    if (isCourier) {
      out.courierAll++;
      out.courier.push({ text: t.slice(0, 70), size, el: sig(el), upper });
      const bare = /^[\d\s.,:$%\/·–—\-+#A-Za-z]{0,24}$/.test(t) && words <= 3;
      const dateish = /^(\w{3} \d{1,2}(, \d{4})?|\d+[dhm]|\d{1,2}:\d{2}.*|TM-\d+|[A-Z]{2,5}-\d+.*|\d+)$/.test(t);
      if (words >= 4 && !upper && !dateish) out.courierSentences.push({ text: t.slice(0, 80), size, el: sig(el) });
    }
    const key = sig(el) + "|" + size + "|" + upper;
    if (size < 13 && !seen.has(key + t.slice(0, 20))) {
      seen.add(key + t.slice(0, 20));
      const rec = { text: t.slice(0, 50), size, upper, mono: isCourier, el: sig(el) };
      if (size >= 11.5 && (upper ? true : false) === false && /(badge|count|avatar|initial|pill|\bnum\b|dot)/i.test(el.className + " " + (el.parentElement?.className || ""))) out.badge.push(rec);
      else if (upper && size >= 12) { /* ok: uppercase label at 12px */ }
      else out.small.push(rec);
    }
    const fg = parse(cs.color);
    if (fg) {
      const bg = bgOf(el);
      const f = fg[3] < 1 ? mix(fg, bg) : fg;
      const l1 = lum(f), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < 4.5 && !(el.closest("button:disabled,[disabled],[aria-disabled=true]"))) out.lowContrast.push({ text: t.slice(0, 40), ratio: Math.round(ratio * 100) / 100, size, el: sig(el) });
    }
  }
  return out;
};

const browser = await chromium.launch();
try {
  for (const id of ids) {
    const vp = VIEWPORTS[id.endsWith("-p") ? "p" : "d"];
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1, colorScheme: "light" });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
      const url = route.request().url();
      try {
        const body = fontBody(url);
        const type = url.includes("googleapis.com") ? "text/css; charset=utf-8" : (FONT_TYPES[path.extname(new URL(url).pathname)] ?? "font/ttf");
        await route.fulfill({ status: 200, body, contentType: type, headers: { "access-control-allow-origin": "*" } });
      } catch { await route.abort(); }
    });
    try {
      await page.goto(`${base}/${id}.html`, { waitUntil: "load", timeout: 30000 }).catch((e) => console.log("nav", id, e.message));
      await page.evaluate(async () => { await Promise.race([Promise.allSettled(["Instrument Serif", "Geist", "Courier Prime"].map((f) => document.fonts.load(`16px "${f}"`))), new Promise((r) => setTimeout(r, 6000))]); });
      await page.screenshot({ path: path.join(OUT, "shots", `${id}.png`), fullPage: true });
      const audit = await page.evaluate(AUDIT);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      fs.writeFileSync(path.join(OUT, "audit", `${id}.json`), JSON.stringify({ ...audit, overflowX: overflow }, null, 1));
      console.log(id, `texts=${audit.texts} courier=${audit.courierAll} sentenceCourier=${audit.courierSentences.length} small=${audit.small.length} lowContrast=${audit.lowContrast.length} overflowX=${overflow}`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); server.close(); }
