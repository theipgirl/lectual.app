import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui";

const css = readFileSync("src/app/globals.css", "utf8");
/** The kit's own CSS: from its heading comment to the end of the `.sheet-empty` rule. */
const kitCss = css.slice(css.indexOf("the SHEET TABLE KIT"), css.indexOf(".sheet-tbl .sheet-empty td"));
const phoneCss = css.slice(css.indexOf("The sheet table kit on a phone"), css.indexOf("Touch screens and phones"));

describe("sheet table kit: the components only draw markup and forward every prop", () => {
  const html = renderToStaticMarkup(
    <SheetCard as="section" id="s1" aria-label="Rows" className="mine">
      <SheetScroll scroll={false} data-x="1">
        <SheetTable minWidth={900} fixed className="own" data-t="t" style={{ color: "red" }}>
          <tbody>
            <tr>
              <td className="pri">a</td>
            </tr>
          </tbody>
        </SheetTable>
      </SheetScroll>
    </SheetCard>,
  );

  it("the card is a lx-card with the kit class, any element, and keeps its own props", () => {
    expect(html).toMatch(/^<section [^>]*class="lx-card sheet-card mine"/);
    expect(html).toContain('id="s1"');
    expect(html).toContain('aria-label="Rows"');
  });

  it("the scroller says whether the table fits (data-scroll) and forwards data attributes", () => {
    expect(html).toContain('class="sheet-scroll"');
    expect(html).toContain('data-scroll="false"');
    expect(html).toContain('data-x="1"');
    expect(renderToStaticMarkup(<SheetScroll scroll>x</SheetScroll>)).toContain('data-scroll="true"');
    expect(renderToStaticMarkup(<SheetScroll>x</SheetScroll>)).not.toContain("data-scroll");
  });

  it("the table carries lx-tbl lx-stack sheet-tbl, the minimum width as a variable, fixed layout on request, and keeps style and class", () => {
    expect(html).toMatch(/<table [^>]*class="lx-tbl lx-stack sheet-tbl sheet-fixed own"/);
    expect(html).toContain("--sheet-min:900px");
    expect(html).toContain("color:red");
    expect(html).toContain('data-t="t"');
    const plain = renderToStaticMarkup(<SheetTable>{null}</SheetTable>);
    expect(plain).toContain('class="lx-tbl lx-stack sheet-tbl"');
    expect(plain).not.toContain("--sheet-min");
  });
});

describe("sheet table kit: the CSS", () => {
  it("is found", () => {
    expect(kitCss.length).toBeGreaterThan(500);
    expect(phoneCss.length).toBeGreaterThan(200);
  });

  it("uses tokens only (no colour literal, no dark block)", () => {
    expect(kitCss + phoneCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(kitCss + phoneCss).not.toContain("prefers-color-scheme");
  });

  it("draws the header plain: 13px token, sentence case, no letter spacing, sans face", () => {
    const th = /\.sheet-tbl thead th \{[^}]*\}/.exec(kitCss)![0];
    expect(th).toContain("font-size: var(--fs-1)");
    expect(th).toContain("text-transform: none");
    expect(th).toContain("letter-spacing: 0");
    expect(th).toContain("font-family: var(--sans)");
    expect(kitCss).not.toMatch(/var\(--mono\)|monospace|text-transform:\s*uppercase/);
  });

  it("has zebra rows, one row height, the sticky header only where the table fits, and right-aligned tabular numbers", () => {
    expect(kitCss).toContain(".sheet-tbl tbody tr:nth-child(even) td");
    expect(kitCss).toContain("height: var(--sheet-row-h, 44px)");
    expect(kitCss).toMatch(/\.sheet-scroll\[data-scroll="false"\] \.sheet-tbl thead th \{[^}]*position: sticky/);
    expect(kitCss).toMatch(/th\.num, \.sheet-tbl td\.num \{[^}]*text-align: right;[^}]*font-variant-numeric: tabular-nums/);
  });

  it("scrolls sideways inside the card only, and is visible when it fits", () => {
    expect(kitCss).toMatch(/\.sheet-scroll \{[^}]*overflow-x: auto/);
    expect(kitCss).toContain('.sheet-scroll[data-scroll="false"] { overflow: visible; }');
  });

  it("stacks rows into cards on a phone through .lx-stack, at 14px, with a 44px record link, and no inner scroll", () => {
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.lx-stack td\[data-label\]::before/);
    expect(phoneCss).toContain(".sheet-scroll { overflow: visible; }");
    expect(phoneCss).toMatch(/\.sheet-tbl\.lx-stack \{[^}]*min-width: 0/);
    expect(phoneCss).toMatch(/td\.pri > a[^{]*\{[^}]*min-height: 44px/);
    expect(phoneCss).toContain("font-size: var(--fs-2)");
  });
});
