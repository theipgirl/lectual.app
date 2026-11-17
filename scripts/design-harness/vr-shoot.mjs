#!/usr/bin/env node
// Visual-review shots (screens/visual-review.screen.tsx, ids vr-*): for each screen, MEASURE the real layout (sideways scroll of
// the document and of the shell's scroller, text under the floor, monospace text, text that matches its background), then let the
// shell grow and take a full-page JPEG. Usage: VR_OUT=<dir> node vr-shoot.mjs [id ...]   (default dir: out/vr)
// Writes <dir>/<id>.jpg, <dir>/index.json (id, title, width, file) and <dir>/measure.json.
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
const OUT = path.join(here, "out");
const DEST = path.resolve(process.env.VR_OUT || path.join(OUT, "vr"));
const SIZES = { desktop: { width: 1440, height: 900 }, desktop1280: { width: 1280, height: 800 }, phone: { width: 375, height: 812 } };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const RELEASE = ".lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}";

const wanted = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).filter((s) => s.id.startsWith("vr-") && (!wanted.length || wanted.includes(s.id)));
fs.mkdirSync(DEST, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const CACHE = path.join(OUT, "font-cache");
fs.mkdirSync(CACHE, { recursive: true });
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function fontBody(url) {
  const file = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
  if (!fs.existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, execFileSync("curl", ["-sSf", "-m", "30", "-A", UA, url], { maxBuffer: 64 * 1024 * 1024 }));
    fs.renameSync(tmp, file);
  }
  return fs.readFileSync(file);
}
const FONT_TYPES = { ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff" };

const MEASURE = (minPx) => {
  const vw = window.innerWidth;
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const mix = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let acc = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) acc = mix(layers[i], acc);
    return acc;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const small = new Map(), mono = new Map(), faint = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (!t || !el || ["SCRIPT", "STYLE"].includes(el.tagName)) continue;
    if (el.closest("[hidden],[aria-hidden='true'] svg,.sr-only,.lx-sr,.visually-hidden")) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    if (r.width <= 1 && r.height <= 1) continue; // visually hidden
    const px = parseFloat(cs.fontSize);
    const key = `${px}px ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${t.slice(0, 40)}"`;
    if (px < minPx) small.set(key, 1);
    const fam = cs.fontFamily.toLowerCase();
    if (!el.closest("code,pre,kbd") && /courier|mono/.test(fam.split(",")[0])) mono.set(`${cs.fontFamily.slice(0, 30)} ${key}`, 1);
    const fg = parse(cs.color);
    if (fg) {
      const bg = bgOf(el);
      const c = ratio(mix(fg, bg), bg);
      if (c < 2.2) faint.set(`${c.toFixed(2)} ${key}`, 1);
    }
  }
  const over = [];
  const clipped = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox !== "visible") { const r = e.getBoundingClientRect(); if (r.right <= vw + 1) return true; } } return false; };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && !clipped(el) && getComputedStyle(el).position !== "fixed") over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
  }
  const content = document.querySelector(".lx-content");
  return {
    vw,
    docScroll: document.documentElement.scrollWidth,
    contentScroll: content ? content.scrollWidth : null,
    contentClient: content ? content.clientWidth : null,
    small: [...small.keys()].slice(0, 30), smallCount: small.size,
    mono: [...mono.keys()].slice(0, 30), monoCount: mono.size,
    faint: [...faint.keys()].slice(0, 30), faintCount: faint.size,
    over: over.slice(0, 12), overCount: over.length,
  };
};

const browser = await chromium.launch();
const index = [];
const measures = {};
try {
  for (const s of manifest) {
    const size = SIZES[s.viewport];
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, colorScheme: "light" });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
      const url = route.request().url();
      try {
        const body = fontBody(url);
        const type = url.includes("googleapis.com") ? "text/css; charset=utf-8" : (FONT_TYPES[path.extname(new URL(url).pathname)] ?? "font/ttf");
        await route.fulfill({ status: 200, body, contentType: type, headers: { "access-control-allow-origin": "*" } });
      } catch {
        await route.abort();
      }
    });
    try {
      await page.goto(`${base}/${s.id}.html`, { waitUntil: "load", timeout: 30000 }).catch((e) => console.log("nav", s.id, e.message));
      await page.evaluate(async () => { await Promise.race([Promise.allSettled(["Instrument Serif", "Geist"].map((f) => document.fonts.load(`16px "${f}"`))), new Promise((r) => setTimeout(r, 6000))]); });
      const m = await page.evaluate(MEASURE, s.viewport === "phone" ? 14 : 13);
      measures[s.id] = m;
      await page.addStyleTag({ content: RELEASE });
      const file = `${s.id}.jpg`;
      await page.screenshot({ path: path.join(DEST, file), fullPage: true, type: "jpeg", quality: 82 });
      index.push({ id: s.id, title: s.title, width: size.width, file });
      const flag = m.docScroll > m.vw || (m.contentScroll ?? 0) > (m.contentClient ?? 1e9) + 1 ? "  SIDEWAYS" : "";
      console.log(`${s.id} doc=${m.docScroll}/${m.vw} content=${m.contentScroll}/${m.contentClient} small=${m.smallCount} mono=${m.monoCount} faint=${m.faintCount} over=${m.overCount}${flag}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
const prevIdx = fs.existsSync(path.join(DEST, "index.json")) ? JSON.parse(fs.readFileSync(path.join(DEST, "index.json"), "utf8")) : [];
const prevM = fs.existsSync(path.join(DEST, "measure.json")) ? JSON.parse(fs.readFileSync(path.join(DEST, "measure.json"), "utf8")) : {};
const ids = new Set(index.map((e) => e.id));
fs.writeFileSync(path.join(DEST, "index.json"), JSON.stringify([...prevIdx.filter((e) => !ids.has(e.id)), ...index], null, 1));
fs.writeFileSync(path.join(DEST, "measure.json"), JSON.stringify({ ...prevM, ...measures }, null, 1));
