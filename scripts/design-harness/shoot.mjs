#!/usr/bin/env node
// Serves out/ and screenshots every screen in out/manifest.json with Playwright (chromium, deviceScaleFactor 1).
// desktop = 1440x900 full page, phone = 375x812 full page. Usage: node shoot.mjs [screenId...]
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
const SHOTS = path.join(OUT, "shots");
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

const wanted = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).filter((s) => !wanted.length || wanted.includes(s.id));
fs.mkdirSync(SHOTS, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// Chromium here does not use the sandbox proxy, but curl does: fetch Google Fonts (CSS + font files) with curl,
// cache them under out/font-cache, and hand them to the page. A cached run needs no network at all.
const CACHE = path.join(OUT, "font-cache");
fs.mkdirSync(CACHE, { recursive: true });
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function fontBody(url) {
  const file = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
  if (!fs.existsSync(file)) {
    // Write to a temp name and rename, so a second request for the same URL never reads a half-written file.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, execFileSync("curl", ["-sSf", "-m", "30", "-A", UA, url], { maxBuffer: 64 * 1024 * 1024 }));
    fs.renameSync(tmp, file);
  }
  return fs.readFileSync(file);
}
const FONT_TYPES = { ".woff2": "font/woff2", ".ttf": "font/ttf", ".woff": "font/woff" };

const browser = await chromium.launch();
try {
  for (const s of manifest) {
    const page = await browser.newPage({ viewport: VIEWPORTS[s.viewport], deviceScaleFactor: 1, colorScheme: "light" });
    page.on("requestfailed", (r) => console.log("requestfailed", r.url().slice(0, 90), r.failure()?.errorText));
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
      const url = route.request().url();
      try {
        const body = fontBody(url);
        const type = url.includes("googleapis.com") ? "text/css; charset=utf-8" : (FONT_TYPES[path.extname(new URL(url).pathname)] ?? "font/ttf");
        await route.fulfill({ status: 200, body, contentType: type, headers: { "access-control-allow-origin": "*" } });
      } catch (e) {
        console.log("font fetch failed", url.slice(0, 100), String(e.message).split("\n")[0]);
        await route.abort();
      }
    });
    try {
      // Google Fonts may be unreachable from a sandbox: do not hang on it, and say so.
      await page.goto(`${base}/${s.id}.html`, { waitUntil: "load", timeout: 30000 }).catch((e) => console.log("nav", s.id, e.message));
      const fonts = await page.evaluate(async () => {
        const names = ["Instrument Serif", "Geist", "Courier Prime"];
        await Promise.race([Promise.allSettled(names.map((f) => document.fonts.load(`16px "${f}"`))), new Promise((r) => setTimeout(r, 6000))]);
        // "loaded" = a face of the family finished loading; "unused" = defined but nothing on this page needed it; "FAILED" = the font request failed.
        return names.map((f) => {
          const faces = [...document.fonts].filter((x) => x.family.replace(/["']/g, "") === f);
          return `${f}:${faces.some((x) => x.status === "loaded") ? "loaded" : faces.some((x) => x.status === "error") ? "FAILED" : faces.length ? "unused" : "NOT-DEFINED"}`;
        }).join(" ");
      });
      await page.screenshot({ path: path.join(SHOTS, `${s.id}.png`), fullPage: true });
      console.log("shot", s.id, fonts);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
