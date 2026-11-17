#!/usr/bin/env node
// D1: render each given id at 1440, 1280 and 375 and report page sideways overflow and the view switch's box. node d1-shoot.mjs <shotsDir> id...
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const [shots, ...ids] = process.argv.slice(2);
fs.mkdirSync(shots, { recursive: true });
const server = http.createServer((req, res) => {
  const f = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".css": "text/css" }[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const CACHE = path.join(OUT, "font-cache");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const fontBody = (u) => { const f = path.join(CACHE, crypto.createHash("sha1").update(u).digest("hex")); if (!fs.existsSync(f)) fs.writeFileSync(f, execFileSync("curl", ["-sSf", "-m", "30", "-A", UA, u], { maxBuffer: 64e6 })); return fs.readFileSync(f); };
const browser = await chromium.launch();
for (const id of ids) for (const w of [1440, 1280, 375]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: "light" });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => { try { const u = route.request().url(); await route.fulfill({ status: 200, body: fontBody(u), contentType: u.includes("googleapis") ? "text/css" : "font/woff2", headers: { "access-control-allow-origin": "*" } }); } catch { await route.abort(); } });
  await page.goto(`${base}/${id}.html`, { waitUntil: "load" }).catch(() => {});
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const sw = document.querySelector("[data-view-switch]");
    const r = sw?.getBoundingClientRect();
    const on = sw?.querySelector("[aria-current]");
    return { sw: de.scrollWidth, cw: de.clientWidth, switchRight: r ? Math.round(r.right) : null, switchW: r ? Math.round(r.width) : null, fill: on ? getComputedStyle(on).backgroundColor : null, fg: on ? getComputedStyle(on).color : null, fs: sw ? getComputedStyle(sw.querySelector("a,button")).fontSize : null };
  });
  console.log(id, w, JSON.stringify(m));
  if (w === 1440) await page.screenshot({ path: path.join(shots, `d1-${id}.png`), clip: { x: 0, y: 0, width: 1440, height: 420 } });
  await page.close();
}
await browser.close(); server.close();
