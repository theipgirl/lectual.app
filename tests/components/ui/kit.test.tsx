import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Pill } from "@/components/ui/Pill";
import { PageTabs } from "@/components/ui/PageTabs";
import { BoardCard, BoardColumn } from "@/components/ui/Board";
import { ShowingCount } from "@/components/ui/ShowingCount";
import { ViewToggle } from "@/components/ViewToggle";

describe("Pill", () => {
  it("is a lx-pill with its tone and nothing else by default", () => {
    expect(renderToStaticMarkup(<Pill>Draft</Pill>)).toBe('<span class="lx-pill lx-pill-mute">Draft</span>');
    expect(renderToStaticMarkup(<Pill tone="risk" title="Past due">Overdue</Pill>)).toBe('<span class="lx-pill lx-pill-risk" title="Past due">Overdue</span>');
  });
  it("can wrap and use tabular digits", () => {
    expect(renderToStaticMarkup(<Pill tone="warn" wrap num>3d</Pill>)).toContain("lx-pill-wrap lx-pill-num");
  });
  it("passes an extra class and data attributes through (one prop shape for every area)", () => {
    expect(renderToStaticMarkup(<Pill tone="ok" className="x-hook" data-state="connected">On</Pill>)).toBe(
      '<span class="lx-pill lx-pill-ok x-hook" data-state="connected">On</span>',
    );
  });
});

describe("PageTabs", () => {
  const html = renderToStaticMarkup(
    <PageTabs label="Settings tabs" tabs={[{ href: "/a", label: "One", current: true }, { href: "/b", label: "Two", current: false, count: 3 }]} />,
  );
  it("is a labelled nav with the chosen tab marked", () => {
    expect(html).toContain('<nav class="lx-tabs" aria-label="Settings tabs">');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page" href="\/a">One<\/a>/);
  });
  it("shows a count when given one", () => {
    expect(html).toContain('<span class="lx-tabs-count">3</span>');
  });
});

describe("Board", () => {
  it("a column has a title, a plain count, a list of cards, and an empty sentence when it has none", () => {
    const full = renderToStaticMarkup(
      <BoardColumn title="Filed" count={3}>
        <li>x</li>
      </BoardColumn>,
    );
    expect(full).toContain('<section class="lx-board-col" aria-label="Filed">');
    expect(full).toContain('<span class="lx-board-title">Filed</span><span class="lx-board-count">3</span>');
    expect(full).toContain('<ul class="lx-board-cards"><li>x</li></ul>');
    const empty = renderToStaticMarkup(<BoardColumn title="Filed" count={0} empty="No matters here yet." />);
    expect(empty).toContain('<p class="lx-board-empty">No matters here yet.</p>');
    expect(empty).not.toContain("<ul");
    // A page that maps zero cards passes an empty array: that is still "none", never an empty list with no sentence.
    const mapped = renderToStaticMarkup(<BoardColumn title="Filed" count={0} empty="No matters here yet.">{[].map((x) => <li key={x}>{x}</li>)}</BoardColumn>);
    expect(mapped).toContain('<p class="lx-board-empty">No matters here yet.</p>');
    expect(mapped).not.toContain("<ul");
  });
  it("a column title can link, and passes drag attributes through", () => {
    const html = renderToStaticMarkup(<BoardColumn title="Filed" titleHref="/x" count="3 · 2 gone quiet" data-stage="s1" />);
    expect(html).toContain('<a href="/x">Filed</a>');
    expect(html).toContain('data-stage="s1"');
  });
  it("a card is the Weekly review card: bold name link, quiet line, step, chip, tone, a menu not a button", () => {
    const html = renderToStaticMarkup(
      <BoardCard
        href="/m/1"
        title="Acme"
        meta="Word mark · Application"
        step="Call back"
        chip={<Pill tone="warn">Due Nov 20</Pill>}
        tone="warn"
        menu={
          <button type="button" className="lx-board-menu" aria-label="Move">
            ⋯
          </button>
        }
      />,
    );
    expect(html).toContain('<li class="lx-board-card" data-tone="warn">');
    expect(html).toContain('<a class="lx-rowlink" href="/m/1">Acme</a>');
    expect(html).toContain('<div class="lx-board-card-meta">Word mark · Application</div>');
    expect(html).toContain('<div class="lx-board-card-step">Call back</div>');
    expect(html).toContain("lx-pill-warn");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("lx-board-menu");
  });
  it("a bare card has no empty rows", () => {
    const html = renderToStaticMarkup(<BoardCard href="/m/1" title="Acme" />);
    expect(html).not.toContain("lx-board-card-meta");
    expect(html).not.toContain("lx-board-card-foot");
  });
});

describe("ShowingCount", () => {
  it("draws nothing when everything is shown", () => {
    expect(renderToStaticMarkup(<ShowingCount shown={5} total={5} />)).toBe("");
  });
  it("says 'Showing N of M' and offers Show more as a link or a button", () => {
    expect(renderToStaticMarkup(<ShowingCount shown={40} total={112} />)).toBe('<p class="lx-note lx-showing">Showing 40 of 112</p>');
    expect(renderToStaticMarkup(<ShowingCount shown={40} total={112} moreHref="?all=1" />)).toContain('<a class="lx-btn lx-btn-sec lx-btn-sm" href="?all=1">Show more</a>');
    expect(renderToStaticMarkup(<ShowingCount shown={40} total={112} onMore={() => {}} />)).toContain("<button");
  });
});

describe("one switch for every pick-one", () => {
  it("any list of options draws the same shared pill, with the chosen one marked", () => {
    const html = renderToStaticMarkup(
      <ViewToggle value="90" label="Period" views={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} hrefFor={(v) => `?days=${v}`} />,
    );
    expect(html).toContain('class="vs-switch"');
    expect(html).toMatch(/aria-current="page" href="\?days=90">90 days/);
  });
});
