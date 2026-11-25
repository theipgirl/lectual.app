// Sprint 3 V3-V4: loads the two custom-columns screens rendered by run.mjs (out/<id>.html) in Chromium and checks what the
// contract measures. Run after `node scripts/design-harness/run.mjs review-sheet-edit-custom record-card-firm-columns-edit`. Exits 1 on any failure; prints one line per check. Fonts are not needed for these checks.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" };

const server = http.createServer((req, res) => {
  const file = path.join(OUT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const browser = await chromium.launch();
async function open(id, opts) {
  const page = await browser.newPage({ deviceScaleFactor: 1, colorScheme: "light", ...opts });
  await page.route(/^https:\/\/fonts\./, (route) => route.abort());
  await page.goto(`${base}/${id}.html`, { waitUntil: "load" });
  return page;
}

try {
  // V3: the owner Sheet at 1440: each custom popover starts inside its cell's column; its styles equal Sprint 1's.
  {
    const page = await open("review-sheet-edit-custom", { viewport: { width: 1440, height: 900 } });
    const m = await page.evaluate(() => {
      // Several editors carry autofocus in this static page; whichever won focus would carry the focus border. Compare at rest.
      document.activeElement?.blur?.();
      const cell = (key) => document.querySelector(`[data-rse-cell="${key}"]`)?.closest("td");
      const props = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "borderTopWidth", "borderTopStyle", "borderTopColor", "borderRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
      const pick = (el) => (el ? Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]])) : null);
      const within = (td) => {
        const pop = td?.querySelector(".rse-pop");
        if (!td || !pop) return { ok: false, why: "missing" };
        const a = td.getBoundingClientRect();
        const b = pop.getBoundingClientRect();
        return { ok: b.left >= a.left - 0.5 && b.left < a.right, why: `pop ${Math.round(b.left)} td ${Math.round(a.left)}-${Math.round(a.right)}` };
      };
      // The screen's field ids (custom-columns.screen.tsx): Priority 7102, Quoted fee 7101.
      const pri = cell("matter:1|cf:00000000-0000-4000-8000-000000007102");
      const fee = cell("matter:2|cf:00000000-0000-4000-8000-000000007101");
      const src = cell("lead:3|source");
      const nextDate = document.querySelector(".rse-next-ed input[type=date]");
      return {
        pri: within(pri),
        fee: within(fee),
        choicePop: JSON.stringify(pick(pri?.querySelector(".rse-pop"))),
        sourcePop: JSON.stringify(pick(src?.querySelector(".rse-pop"))),
        feeInput: JSON.stringify(pick(fee?.querySelector("input.rse-in"))),
        nextInput: JSON.stringify(pick(nextDate)),
      };
    });
    check("V3 Priority popover starts inside its column", m.pri.ok, m.pri.why);
    check("V3 Quoted fee popover starts inside its column", m.fee.ok, m.fee.why);
    check("V3 Priority ChoicePop font, border, padding = the Source popover's", m.choicePop !== "null" && m.choicePop === m.sourcePop, `${m.choicePop} vs ${m.sourcePop}`);
    check("V3 Quoted fee input font, border, padding = the Next step editor's input", m.feeInput !== "null" && m.feeInput === m.nextInput, `${m.feeInput} vs ${m.nextInput}`);
    await page.close();
  }

  // V4: the card: the Firm columns block sits after the facts; its labels are the card's lx-label size; the status line is quiet.
  {
    const page = await open("record-card-firm-columns-edit", { viewport: { width: 1440, height: 900 } });
    const m = await page.evaluate(() => {
      const facts = document.querySelector(".rv-cardx > dl.rv-cardx-facts");
      const firm = document.querySelector(".rv-cardx-firm");
      const after = !!facts && !!firm && (facts.compareDocumentPosition(firm) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 && firm.getBoundingClientRect().top >= facts.getBoundingClientRect().bottom - 0.5;
      const size = (el) => (el ? getComputedStyle(el).fontSize : null);
      const cardLabel = size(facts?.querySelector("dt.lx-label"));
      const firmLabels = [...(firm?.querySelectorAll("dt.lx-label") ?? [])].map(size);
      const status = firm?.querySelector("p.lx-note[role=status][aria-live=polite]");
      return { after, cardLabel, firmLabels, status: !!status, forms: firm?.querySelectorAll("form").length ?? 0 };
    });
    check("V4 the block sits after the facts", m.after);
    check("V4 its labels are the card's lx-label size", m.firmLabels.length > 0 && m.firmLabels.every((s) => s === m.cardLabel), `${m.cardLabel} vs ${m.firmLabels.join(",")}`);
    check("V4 two editable items and a quiet status line", m.forms === 2 && m.status, JSON.stringify(m));
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
