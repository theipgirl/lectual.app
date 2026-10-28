import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ListHeader } from "@/components/list-page/ListHeader";
import { ListToolbar, showClear } from "@/components/list-page/ListToolbar";
import { Chip, FilterChips, chipClass } from "@/components/list-page/Chips";
import { ViewToggle } from "@/components/ViewToggle";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("ListHeader", () => {
  const html = renderToStaticMarkup(<ListHeader title="Leads" sub="3 leads. Newest activity first." count={3} />);

  it("is one h1 and one sub-line, with no eyebrow label", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/class="lx-sub lp-sub"/g)).toHaveLength(1);
    expect(html).not.toContain("lx-label");
    expect(html).toContain("Newest activity first.");
  });

  it("carries the page's data-tour token on the h1 when given one", () => {
    expect(renderToStaticMarkup(<ListHeader title="Matters" sub="x" tour="matters-head" />)).toContain('data-tour="matters-head"');
  });
});

describe("ListToolbar", () => {
  const toolbar = (term: string, extra: Partial<Parameters<typeof ListToolbar>[0]> = {}) =>
    renderToStaticMarkup(
      <ListToolbar
        search={{ label: "Search things", placeholder: "Find", defaultValue: term, clearHref: "/list/" }}
        toggle={<ViewToggle value="table" hrefFor={() => "/x/"} />}
        primary={<button>Add thing</button>}
        more={<span>More-slot</span>}
        {...extra}
      />,
    );

  it("has a search input with a submit button, the Table | Board toggle, the primary action and the More slot", () => {
    const html = toolbar("");
    expect(html).toContain('role="search"');
    expect(html).toMatch(/<input class="lx-input"[^>]*aria-label="Search things"/);
    expect(html).toContain('<button type="submit" class="lp-search-submit">Search</button>');
    expect(html).toContain("lx-view-toggle");
    expect(html).toContain("Add thing");
    expect(html).toContain("More-slot");
  });

  it("shows Clear only when a term is set", () => {
    expect(toolbar("")).not.toContain("Clear");
    expect(toolbar("   ")).not.toContain("Clear");
    expect(toolbar("acme")).toContain('<a class="lp-clear" href="/list/">Clear</a>');
    expect(showClear("acme")).toBe(true);
    expect(showClear(undefined)).toBe(false);
  });

  it("a page that filters in the browser gets a Clear button instead of a link", () => {
    const html = renderToStaticMarkup(<ListToolbar search={{ label: "s", placeholder: "p", value: "abc", onChange: () => {}, onClear: () => {} }} />);
    expect(html).toContain('<button type="button" class="lp-clear">Clear</button>');
  });

  it("posts hidden fields with a plain GET search", () => {
    expect(toolbar("", { search: { label: "s", placeholder: "p", hidden: { view: "board", seg: "court" } } })).toMatch(/<input type="hidden" name="view" value="board"\/>/);
  });
});

describe("Chip and FilterChips", () => {
  it("a link chip marks the current one, a button chip is pressed, both wear the same class", () => {
    const html = renderToStaticMarkup(
      <>
        <FilterChips as="nav" label="Filter x">
          <Chip href="/a/" active count={4}>
            Open
          </Chip>
          <Chip href="/b/">Closed</Chip>
        </FilterChips>
        <FilterChips label="Filters">
          <Chip active onClick={() => {}}>
            Needs attorney
          </Chip>
        </FilterChips>
      </>,
    );
    expect(html).toContain('aria-label="Filter x"');
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*class="lp-chip lp-chip-on"|<a [^>]*class="lp-chip lp-chip-on"[^>]*aria-current="page"/);
    expect(html).toContain('<span class="lp-chip-count">4</span>');
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="lp-chip lp-chip-on">Needs attorney<\/button>/);
    expect(chipClass(false)).toBe("lp-chip");
  });
});

describe("Leads and Matters share the pattern", () => {
  const leads = read("src/app/dashboard/intake/_components/IntakeWorkspace.tsx");
  const matters = read("src/app/dashboard/matters/page.tsx");

  it("both pages import the shared header and toolbar", () => {
    for (const source of [leads, matters]) {
      expect(source).toContain('from "@/components/list-page/ListHeader"');
      expect(source).toContain('from "@/components/list-page/ListToolbar"');
    }
    expect(matters).toContain('from "@/components/list-page/Chips"');
    expect(leads).toContain('from "@/components/list-page/MoreMenu"');
  });

  it("no inline-styled one-off header is left on either page", () => {
    expect(leads).not.toContain("lx-page-head");
    expect(matters).not.toContain("lx-page-head");
    expect(leads).not.toContain("lx-label");
    expect(matters).not.toContain("lx-label");
  });

  it("the Leads table row and the Matters table row use the same row class, and the same pill", () => {
    expect(read("src/app/dashboard/intake/_components/IntakeTable.tsx")).toContain('className="lp-row lp-row-grid"');
    expect(matters).toContain('className="lp-row"');
    expect(read("src/app/dashboard/intake/_components/IntakeTable.tsx")).toContain("lp-pill");
    expect(matters).toContain("lp-pill");
    expect(read("src/app/dashboard/intake/_components/IntakeCard.tsx")).toContain("lp-board-card");
    expect(read("src/components/matters/MatterBoard.tsx")).toContain("lp-board-card");
  });

  it("intake.css no longer defines a page header, status strip or filter chip, and nothing references them", () => {
    const css = read("src/app/dashboard/intake/intake.css");
    for (const gone of [".intake-statusline", ".lx-view-toggle", ".intake-chip", ".intake-header"]) expect(css).not.toContain(gone);
    const all = ["src/app/dashboard/intake", "src/components"].flatMap((d) => walkSources(d));
    for (const file of all) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toContain("intake-statusline");
      expect(text, file).not.toMatch(/\bfilterChip\(|\bgroupPill\(/);
    }
    const styles = read("src/app/dashboard/intake/_components/styles.ts");
    expect(styles).not.toMatch(/export (function|const) (filterChip|groupPill|PANEL|PRIMARY_BUTTON|OUTLINE_BUTTON|STAGE_PILL)\b/);
  });
});

import fs from "node:fs";
function walkSources(dir: string): string[] {
  const abs = path.join(root, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) return walkSources(path.relative(root, p));
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("list-page.css", () => {
  const css = read("src/components/list-page/list-page.css");

  it("uses the design tokens only: no hex or rgb colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
  });

  it("sets no text below 12.5px", () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12.5);
  });

  it("gives one row height, pill and spacing to both pages", () => {
    expect(css).toContain("--lp-row-h: 46px");
    expect(css).toMatch(/\.lp-row \{ height: var\(--lp-row-h\)/);
    expect(css).toContain(".lp-pill {");
    expect(css).toContain(".lp-board-card {");
  });
});
