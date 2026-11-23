import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnChooser, ColumnChooserPanel, ColumnChooserSection, type ChooserSection } from "@/components/review/ColumnChooser";
import { COLUMN_PREFS_KEY, readPrefsDocument, serializePrefs, writePrefsDocument, type StorageLike } from "@/lib/review/column-prefs-storage";
import { applyColumnPrefs, columnsFor, defaultStoredPrefs, parseColumnPrefs, prefsReducer, type SectionPrefs } from "@/lib/review/sheet-columns";
import * as W from "@/lib/ui/words";
import { renderReadOnly, tableHeaders } from "./columns-fixtures";

const sections = (canSeeMoney: boolean): ChooserSection[] => [
  { id: "trademarks", title: "Trademarks", columns: columnsFor("trademarks", { canSeeMoney, hasNotes: false }) },
  { id: "contracts", title: "Contracts", columns: columnsFor("contracts", { canSeeMoney, hasNotes: false }) },
];

describe("chooser markup", () => {
  it("one checkbox per allowed non-pinned column, Move up / Move down per row, Reset per section, none for the pinned column", () => {
    const html = renderToStaticMarkup(<ColumnChooserPanel sections={sections(true)} />);
    const tmCols = columnsFor("trademarks", { canSeeMoney: true, hasNotes: false });
    const ctCols = columnsFor("contracts", { canSeeMoney: true, hasNotes: false });
    expect(html.match(/type="checkbox"/g)).toHaveLength(tmCols.length - 1 + (ctCols.length - 1));
    expect(html.match(/>Move up</g)).toHaveLength(tmCols.length - 1 + (ctCols.length - 1));
    expect(html.match(/>Move down</g)).toHaveLength(tmCols.length - 1 + (ctCols.length - 1));
    expect(html.match(new RegExp(`>${W.COLUMNS_RESET.replace("'", "&#x27;")}<`, "g"))).toHaveLength(2);
    // the pinned column is named, with no checkbox of its own
    expect(html).toContain(W.COLUMNS_ALWAYS_SHOWN);
    expect(html).not.toContain('aria-label="Show Trademark Owner"');
    expect(html).not.toContain('aria-label="Show Client Name"');
    expect(html).toContain('aria-label="Show Serial No."');
    expect(html).toContain('aria-label="Move up: Serial No."');
  });
  it("lists exactly the allowed columns: a viewer who may not see money gets no fee row", () => {
    const html = renderToStaticMarkup(<ColumnChooserPanel sections={sections(false)} />);
    expect(html).not.toMatch(/Legal Fee|Government Filing|Fee Due Date/);
    expect(html).toContain("Office Action Due Date");
    expect(renderToStaticMarkup(<ColumnChooserPanel sections={sections(true)} />)).toContain("Government Filing fee");
  });
  it("checkboxes reflect the person's choices; the first non-pinned row can't move up, the last can't move down", () => {
    const columns = columnsFor("trademarks", { canSeeMoney: false, hasNotes: false });
    const prefs = parseColumnPrefs({ order: [], hidden: ["serial"] }, columns.map((c) => c.id));
    const html = renderToStaticMarkup(<ColumnChooserSection title="Trademarks" columns={columns} prefs={prefs} onChange={() => {}} />);
    expect(html).toMatch(/<input type="checkbox" aria-label="Show Trademark Name" checked=""/);
    expect(html).toMatch(/<input type="checkbox" aria-label="Show Serial No\."\/>|<input type="checkbox" aria-label="Show Serial No\." \/>/);
    expect(html).toMatch(/aria-label="Move up: Trademark Name" disabled=""/);
    expect(html).toMatch(/aria-label="Move down: Last contact" disabled=""/);
  });
  it("the Columns button is the shared Popover's trigger, closed until clicked", () => {
    const html = renderToStaticMarkup(<ColumnChooser sections={sections(true)} />);
    expect(html).toContain('class="lp-pop"');
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>Columns<\/button>/);
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("custom columns in the chooser (Sprint 2)", () => {
  const customFields = [
    { id: "00000000-0000-4000-8000-00000000a001", section: "trademarks" as const, label: "Priority", kind: "choice" as const, position: 0 },
    { id: "00000000-0000-4000-8000-00000000a002", section: "contracts" as const, label: "Signed on", kind: "date" as const, position: 0 },
  ];
  const withCustom: ChooserSection[] = [
    { id: "trademarks", title: "Trademarks", columns: columnsFor("trademarks", { canSeeMoney: false, hasNotes: false, customFields }) },
    { id: "contracts", title: "Contracts", columns: columnsFor("contracts", { canSeeMoney: false, hasNotes: false, customFields }) },
  ];
  it("lists them after the spreadsheet columns with their kind word, each with a checkbox and moves", () => {
    const html = renderToStaticMarkup(<ColumnChooserPanel sections={withCustom} />);
    const tm = html.slice(0, html.indexOf('data-section-columns="Contracts"'));
    expect(tm.indexOf("Last contact")).toBeLessThan(tm.indexOf('aria-label="Show Priority"'));
    expect(tm).toMatch(/aria-label="Show Priority"[^>]*\/> Priority <span class="lx-note" data-column-kind="choice">Choice<\/span>/);
    expect(tm).toContain('aria-label="Move up: Priority"');
    expect(html.slice(html.indexOf('data-section-columns="Contracts"'))).toContain('data-column-kind="date">Date</span>');
    expect(tm).not.toContain("Signed on");
  });
  it("the checkbox reflects a hidden custom column (a checkbox carries its own pressed state)", () => {
    const cols = withCustom[0].columns;
    const prefs = { order: cols.map((c) => c.id), hidden: ["cf:00000000-0000-4000-8000-00000000a001" as const] };
    const html = renderToStaticMarkup(<ColumnChooserSection title="Trademarks" columns={cols} prefs={prefs} onChange={() => {}} />);
    expect(html).toMatch(/<input type="checkbox" aria-label="Show Priority"\/>/);
    expect(html).toMatch(/<input type="checkbox" aria-label="Show Serial No\." checked=""\/>/);
  });
});

describe("pure reducer: hide, move, reset", () => {
  const allowed = columnsFor("trademarks", { canSeeMoney: true, hasNotes: false }).map((c) => c.id);
  it("hide, then move, then Reset returns to the spreadsheet's order", () => {
    let p: SectionPrefs = parseColumnPrefs(null, allowed);
    p = prefsReducer(p, { type: "toggle", id: "serial" }, allowed);
    p = prefsReducer(p, { type: "move", id: "oaDue", dir: -1 }, allowed);
    const drawn = applyColumnPrefs(columnsFor("trademarks", { canSeeMoney: true, hasNotes: false }), p).map((c) => c.id);
    expect(drawn).not.toContain("serial");
    expect(drawn.indexOf("oaDue")).toBeLessThan(drawn.indexOf("govFeeDue"));
    p = prefsReducer(p, { type: "reset" }, allowed);
    expect(applyColumnPrefs(columnsFor("trademarks", { canSeeMoney: true, hasNotes: false }), p).map((c) => c.id)).toEqual(allowed);
  });
});

describe("storage key and shape", () => {
  const memory = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  it("is lx-review-sheet-columns with { v: 1, trademarks: { order, hidden }, contracts: { order, hidden } }", () => {
    expect(COLUMN_PREFS_KEY).toBe("lx-review-sheet-columns");
    const store = memory();
    const doc = defaultStoredPrefs({ trademarks: ["client", "mark"], contracts: ["client", "status"] });
    expect(writePrefsDocument(store, { trademarks: doc.trademarks, contracts: doc.contracts })).toBe(true);
    expect(JSON.parse(store.data.get("lx-review-sheet-columns")!)).toEqual({ v: 1, trademarks: { order: ["client", "mark"], hidden: [] }, contracts: { order: ["client", "status"], hidden: [] } });
    expect(readPrefsDocument(store)).toEqual({ trademarks: { order: ["client", "mark"], hidden: [] }, contracts: { order: ["client", "status"], hidden: [] } });
    expect(serializePrefs({})).toBe('{"v":1,"trademarks":null,"contracts":null}');
  });
  it("a stored document of another version reads as nothing stored", () => {
    const store = memory();
    store.setItem(COLUMN_PREFS_KEY, JSON.stringify({ v: 2, trademarks: { order: ["client"], hidden: [] } }));
    expect(readPrefsDocument(store)).toBeNull();
  });
});

describe("first render equals default order; throwing storage", () => {
  it("with nothing stored (and no browser at all) the List draws the default order, with no error shown", async () => {
    const [tm] = tableHeaders(await renderReadOnly({ canSeeMoney: true }));
    // Changed on purpose (merge with the Notes cell): Notes is drawn after Source.
    expect(tm).toEqual(["Trademark Owner", "Trademark Name", "Serial No.", "Status", "Source", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date", "Office Action Due Date", "Next step", "Waiting on", "Last contact"]);
  });
  it("throwing storage: reads give nothing and writes are dropped quietly, so the default order stays", () => {
    const throwing: StorageLike = {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("QuotaExceededError"); },
    };
    expect(readPrefsDocument(throwing)).toBeNull();
    expect(writePrefsDocument(throwing, { trademarks: { order: ["client"], hidden: [] } })).toBe(false);
    expect(readPrefsDocument(null)).toBeNull();
    const allowed = columnsFor("trademarks", { canSeeMoney: true, hasNotes: false });
    expect(applyColumnPrefs(allowed, readPrefsDocument(throwing)?.trademarks ?? null).map((c) => c.id)).toEqual(allowed.map((c) => c.id));
  });
});
