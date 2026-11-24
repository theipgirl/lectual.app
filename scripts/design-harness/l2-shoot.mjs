#!/usr/bin/env node
// Item L2: screenshot out/<id>.html at the width in the id's last letter (d 1440, m 1280, p 375) and measure sideways overflow.
//   node l2-shoot.mjs <label> <outDir> [id ...]      e.g. node l2-shoot.mjs before /path/shots
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
const [label, shotsDir, ...wanted] = process.argv.slice(2);
fs.mkdirSync(shotsDir, { recursive: true });
const WIDTH = { d: 1440, m: 1280, p: 375 };
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).filter((s) => s.id.startsWith("l2-") && (!wanted.length || wanted.includes(s.id)));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
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
const browser = await chromium.launch();
const report = [];
try {
  for (const s of manifest) {
    const w = WIDTH[s.id.slice(-1)];
    const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
      const url = route.request().url();
      try {
        await route.fulfill({ status: 200, body: fontBody(url), contentType: url.includes("googleapis.com") ? "text/css; charset=utf-8" : (FONT_TYPES[path.extname(new URL(url).pathname)] ?? "font/ttf"), headers: { "access-control-allow-origin": "*" } });
      } catch {
        await route.abort();
      }
    });
    try {
      await page.goto(`${base}/${s.id}.html`, { waitUntil: "load", timeout: 30000 }).catch(() => {});
      await page.evaluate(async () => { await Promise.race([Promise.allSettled(["Geist", "Courier Prime"].map((f) => document.fonts.load(`16px "${f}"`))), new Promise((r) => setTimeout(r, 6000))]); });
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const box = (sel) => { const e = document.querySelector(sel); return e ? { sw: e.scrollWidth, cw: e.clientWidth } : null; };
        const table = document.querySelector(".ix-table");
        const scroller = document.querySelector(".ix-scroll");
        return { page: { sw: de.scrollWidth, cw: de.clientWidth }, content: box(".lx-content"), root: box(".intake-root"), scroller: scroller ? { sw: scroller.scrollWidth, cw: scroller.clientWidth } : null, board: box(".ix-board"), table: table ? { sw: table.scrollWidth, cw: table.clientWidth } : null };
      });
      report.push({ id: s.id, width: w, ...m });
      await page.screenshot({ path: path.join(shotsDir, `${label}-${s.id.slice(3)}.png`), fullPage: true });
      console.log("shot", label, s.id, JSON.stringify(m.page), JSON.stringify(m.content), JSON.stringify(m.scroller ?? m.table));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(shotsDir, `overflow-${label}.json`), JSON.stringify(report, null, 1));
