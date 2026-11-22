import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetFactTd } from "@/components/review/SheetFactTd";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { COL_COULDNT_LOAD } from "@/lib/ui/words";
import { cmpSpec, computedTextWrapMode, findAll, parseHtml, parseSheets } from "./css-cascade";

/**
 * D6 / F9: "Couldn't load" in the read-only List's fee cell stays on one line. Sprint 1's `td.rv-fact-failed { white-space: nowrap }`
 * never reached the text: it sits in `span.lx-note`, and `.lx-note { text-wrap: pretty }` sets the span's OWN text-wrap-mode to wrap.
 * The cascade below runs over the stylesheets the List loads (globals, list-page, review, in that order) at 1440px.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const FROZEN = "tests/review/__fixtures__/review-css-7a05b8c.css";
/** sha256 of `git show 7a05b8c:src/components/review/review.css`, byte for byte. */
const FROZEN_SHA256 = "001699cb79d08985ddea754caf1080647d73bb423ca5bc7845693313c1af78bb";
const WIDTH = 1440;

/** The read-only List's markup around one failed fee cell, drawn by the real components. */
const html = renderToStaticMarkup(
  <html>
    <body>
      <div className="lp-root rv-root">
        <div className="rv-sheets">
          <SheetCard as="section" className="rv-sheet-sec">
            <SheetScroll>
              <SheetTable className="rv-sheet" minWidth={980}>
                <tbody>
                  <tr>
                    <SheetFactTd cell={{ text: COL_COULDNT_LOAD, tone: "failed" }} label="Legal Fee" />
                  </tr>
                </tbody>
              </SheetTable>
            </SheetScroll>
          </SheetCard>
        </div>
      </div>
    </body>
  </html>,
);

function cascade(reviewCss: string) {
  const { rules, problems } = parseSheets(
    [
      { name: "globals.css", css: read("src/app/globals.css") },
      { name: "list-page.css", css: read("src/components/list-page/list-page.css") },
      { name: "review.css", css: reviewCss },
    ],
    WIDTH,
  );
  const tree = parseHtml(html);
  const td = findAll(tree, (e) => e.tag === "td" && e.classes.includes("rv-fact-failed"));
  expect(td).toHaveLength(1);
  const span = td[0].children.find((c) => c.tag === "span");
  expect(span?.classes).toEqual(["lx-note"]);
  return { problems, td: computedTextWrapMode(td[0], rules), span: computedTextWrapMode(span!, rules) };
}

describe("the failed fee cell's text-wrap-mode (computed from the shipped stylesheets)", () => {
  it("the frozen copy is byte-identical to 7a05b8c's review.css", () => {
    expect(createHash("sha256").update(readFileSync(path.join(ROOT, FROZEN))).digest("hex")).toBe(FROZEN_SHA256);
  });

  it("(1) on 7a05b8c the span wraps: won by .lx-note at (0,1,0), whatever the td says", () => {
    const r = cascade(read(FROZEN));
    expect(r.problems).toEqual([]);
    expect(r.td.mode).toBe("nowrap");
    expect(r.span.mode).toBe("wrap");
    expect(r.span.selector).toBe(".lx-note");
    expect(r.span.specificity).toEqual([0, 1, 0]);
  });

  it("(2) on the working tree the span stays on one line: nowrap, won by a rule above (0,1,0)", () => {
    const r = cascade(read("src/components/review/review.css"));
    expect(r.problems).toEqual([]);
    expect(r.span.mode).toBe("nowrap");
    expect(r.span.inheritedFrom).toBeNull();
    expect(cmpSpec(r.span.specificity!, [0, 1, 0])).toBeGreaterThan(0);
    expect(r.span.selector).toBe("td.rv-fact-failed > span");
    expect(r.span.specificity).toEqual([0, 1, 2]);
    // the old td rule stays
    expect(read("src/components/review/review.css")).toContain("td.rv-fact-failed { white-space: nowrap; }");
  });
});

describe("the matcher itself", () => {
  it("reports a rule it cannot parse that declares one of the properties", () => {
    const { problems } = parseSheets([{ name: "x.css", css: ".a:has(.b) { white-space: nowrap; } .c::before { white-space: nowrap; } @supports (display: grid) { .d { text-wrap: nowrap; } } .e { white-space: weird; }" }], WIDTH);
    expect(problems).toEqual(['x.css: selector ".a:has(.b)"', 'x.css: media under ".d"', 'x.css: value "white-space: weird" under ".e"']);
  });
  it("evaluates media at the given width and lets !important, then specificity, then source order decide", () => {
    const tree = parseHtml('<div class="t"><p><span class="x y">a</span></p></div>');
    const span = findAll(tree, (e) => e.tag === "span")[0];
    const at = (css: string) => computedTextWrapMode(span, parseSheets([{ name: "t.css", css }], WIDTH).rules);
    expect(at(".x { white-space: nowrap; } .y { text-wrap: pretty; }").mode).toBe("wrap");
    expect(at(".x.y { white-space: nowrap; } .y { text-wrap: pretty; }").mode).toBe("nowrap");
    expect(at(".x { white-space: nowrap !important; } .t .y { text-wrap: pretty; }").mode).toBe("nowrap");
    expect(at("@media (max-width: 640px) { .x { white-space: nowrap; } }").inheritedFrom).not.toBeNull();
    expect(at("@media (min-width: 641px) { .x { white-space: nowrap; } }").mode).toBe("nowrap");
    expect(at("div > span { white-space: nowrap; }").mode).toBe("wrap");
    expect(at("p > span:first-child { white-space: nowrap; }").mode).toBe("nowrap");
    expect(at(".t { white-space: nowrap; }")).toMatchObject({ mode: "nowrap", inheritedFrom: "p" });
  });
});
