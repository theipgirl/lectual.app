#!/usr/bin/env node
// Opens the temperature / source / row menus on the LAST row of out/l2-list-tech-d.html (the Popover is client state, so the
// panel markup it draws when open is injected) and checks they are not clipped and add no inner scrollbar.
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
const shots = process.argv[2];
const server = http.createServer((req, res) => {
  const file = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" }[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const CACHE = path.join(OUT, "font-cache");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const fontBody = (url) => { const f = path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex")); if (!fs.existsSync(f)) fs.writeFileSync(f, execFileSync("curl", ["-sSf", "-m", "30", "-A", UA, url], { maxBuffer: 64e6 })); return fs.readFileSync(f); };
const browser = await chromium.launch();
const results = [];
for (const [which, sel, items] of [
  ["temperature", '[data-col="temp"]', ["Hot", "Warm", "Cold", "Not rated"]],
  ["source", '[data-col="source"]', ["UGW", "Event", "Referral", "Website", "Instagram", "Facebook", "LinkedIn", "Search engine", "Social media", "Inbound", "Assessment", "Intake form", "Other", "Not set"]],
  ["menu", '[data-col="menu"]', ["Move to a stage", "Assign to", "Start timer", "Add time"]],
]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => { try { const u = route.request().url(); await route.fulfill({ status: 200, body: fontBody(u), contentType: u.includes("googleapis") ? "text/css" : "font/woff2", headers: { "access-control-allow-origin": "*" } }); } catch { await route.abort(); } });
  await page.goto(`${base}/l2-list-tech-d.html`, { waitUntil: "load" });
  const r = await page.evaluate(({ sel, items, align }) => {
    const rows = [...document.querySelectorAll("tr.ix-row")];
    const td = rows[rows.length - 1].querySelector(`td${sel}`);
    const host = td.querySelector(".lp-pop") ?? td;
    const panel = document.createElement("div");
    panel.className = "lp-pop-panel"; panel.setAttribute("role", "menu");
    panel.style[align] = "0"; panel.style.minWidth = "190px";
    panel.innerHTML = items.map((t) => `<button type="button" class="lp-pop-item" role="menuitemradio"><span class="lp-pop-dot"></span><span class="lp-pop-text">${t}</span></button>`).join("");
    host.appendChild(panel);
    const sc = document.querySelector(".ix-scroll");
    panel.scrollIntoView({ block: "center" });
    const pr = panel.getBoundingClientRect();
    const at = document.elementFromPoint(pr.left + pr.width / 2, pr.bottom - 4);
    return { scrollerOverflow: getComputedStyle(sc).overflowY, scrollerScrollH: sc.scrollHeight, scrollerClientH: sc.clientHeight, panelBottomHit: !!at && panel.contains(at), panelH: Math.round(pr.height) };
  }, { sel, items, align: which === "menu" ? "right" : "left" });
  results.push({ which, ...r });
  await page.screenshot({ path: path.join(shots, `after-popover-${which}-last-row.png`) });
  await page.close();
}
await browser.close(); server.close();
console.log(JSON.stringify(results, null, 1));
