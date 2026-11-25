import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewTable, type ListColumn } from "@/components/views/table/ViewTable";
import { ViewBoard, type BoardColumnSpec } from "@/components/views/board/ViewBoard";

const cols: ListColumn[] = [
  { key: "client", label: "Client", pinned: true },
  { key: "status", label: "Where it stands", title: "Status", editable: true },
  { key: "notes", label: "Notes", width: 260 },
];
const rows = [{ key: "r1", height: null }, { key: "r2", height: 90 }];
const cell = (r: { key: string }, c: ListColumn) => <td data-label={c.label}>{r.key}:{c.key}</td>;

describe("ViewTable: one List, read-only and editable", () => {
  it("draws the kit's table with a header per column (the firm's label, the fixed key as a hook) and a row per record", () => {
    const html = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} tableClass="rv-sheet" />);
    expect(html).toContain('class="lx-tbl lx-stack sheet-tbl rv-sheet"');
    expect(html).toContain('<th scope="col" data-column="status" title="Status">Where it stands</th>');
    expect(html).toContain('data-row="r1"');
    expect(html).toContain('<tr data-row="r2" style="height:90px">');
    expect(html).toContain("r2:notes");
    expect(html).toContain('data-cells="read-only"');
  });

  it("read-only and editable are the same markup but for the mode flag (and the caller's table class)", () => {
    const a = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} tableClass="x" />);
    const b = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} tableClass="x" canEditCells />);
    expect(b).toContain('data-cells="editable"');
    expect(b.replace("editable", "read-only")).toBe(a);
  });

  it("a column group only where a width is in force; a firm width draws, the caller's widthOf wins", () => {
    const none = renderToStaticMarkup(<ViewTable columns={cols.map((c) => ({ ...c, width: null }))} rows={rows} cell={cell} />);
    expect(none).not.toContain("<colgroup");
    const some = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} />);
    expect(some).toContain('<colgroup><col/><col/><col style="width:260px"/></colgroup>');
    const over = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} widthOf={(c) => (c.key === "status" ? 111 : null)} fixed />);
    // widthOf decides alone: its null for Notes is flexible, so the column's own 260 is not drawn.
    expect(over).toContain('<colgroup><col/><col style="width:111px"/><col/></colgroup>');
    expect(over).toContain("sheet-fixed");
  });

  it("no rows with an empty line: that line, spanning every column; without one: an empty body", () => {
    const html = renderToStaticMarkup(<ViewTable columns={cols} rows={[]} cell={cell} emptyText="Nothing here yet." />);
    expect(html).toContain('<tr class="sheet-empty"><td colSpan="3">Nothing here yet.</td></tr>');
    expect(renderToStaticMarkup(<ViewTable columns={cols} rows={[]} cell={cell} />)).toContain("<tbody></tbody>");
  });

  it("a header render hook replaces the label (an editable List adds its pencil there)", () => {
    const html = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} renderHead={(c) => <b>{c.label}!</b>} />);
    expect(html).toContain("<b>Where it stands!</b>");
  });
});

type Card = { id: string; title: string };
const card = (id: string): Card => ({ id, title: `Card ${id}` });
const render = (c: Card) => <li key={c.id}>{c.title}</li>;

describe("ViewBoard: one Board for people lanes and stage columns", () => {
  const lanes: BoardColumnSpec<Card>[] = [
    {
      key: "u1", title: "Ana", count: 3, countTitle: "Cards", ariaLabel: "Ana · 3", className: "rv-person", attrs: { "data-lane": "u1" }, note: <p data-lane-load>1 overdue</p>,
      groups: [
        { key: "our", heading: "Our turn · 2", empty: "Nothing for us", cards: [card("a"), card("b")], attrs: { "data-half": "our" } },
        { key: "client", heading: "Waiting on client · 0", empty: "Nobody waiting", cards: [] },
      ],
    },
  ];

  it("a headed column holds each group as its own list, and an empty group says so", () => {
    const html = renderToStaticMarkup(<ViewBoard columns={lanes} renderCard={render} className="rv-board" headingLevel={2} />);
    expect(html).toContain('class="lx-board rv-board"');
    expect(html).toContain('data-lane="u1"');
    expect(html).toContain('<h2 class="lx-board-title lx-board-heading">Ana</h2>');
    expect(html).toContain('<h3 class="rv-lane-head lx-label">Our turn · 2</h3>');
    expect(html).toContain('data-half="our"');
    expect(html).toContain("Card a");
    expect(html).toContain('<p class="lx-board-empty">Nobody waiting</p>');
    expect(html).toContain("data-lane-load");
  });

  it("a plain stage column (one group, no heading) is the Board kit's column with its empty sentence: the shape a Matters board needs", () => {
    const stage: BoardColumnSpec<Card>[] = [
      { key: "s1", title: "Filed", count: 1, groups: [{ key: "all", empty: "No matters here.", cards: [card("m1")] }] },
      { key: "s2", title: "Drafting", count: 0, groups: [{ key: "all", empty: "No matters here.", cards: [] }] },
    ];
    const html = renderToStaticMarkup(<ViewBoard columns={stage} renderCard={render} role="region" aria-label="Docket board" />);
    expect(html).toContain('<ul class="lx-board-cards"><li>Card m1</li></ul>');
    expect(html).toContain('<p class="lx-board-empty">No matters here.</p>');
    expect(html).not.toContain("rv-lane-head");
    expect(html).toContain('role="region"');
  });
});

describe("ViewTable widthOf", () => {
  it("when given it decides alone: null is flexible, not the column's own width", () => {
    const html = renderToStaticMarkup(<ViewTable columns={cols} rows={rows} cell={cell} widthOf={() => null} />);
    expect(html).not.toContain("<colgroup");
    expect(html).not.toContain("width:260px");
  });
});
