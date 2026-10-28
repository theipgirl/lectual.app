import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Matters page header (Sprint 7, now the shared list-page header and toolbar): the shared Table | Board toggle sits in
 * the toolbar, after the search, with "Table" (not "List") as its first label.
 */

function mockLoaders() {
  vi.doMock("@/lib/matters", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/matters")>()),
    listMatters: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/pipeline", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/pipeline")>()),
    listLeads: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/components/matters/MatterForms", () => ({ NewMatterForm: () => null }));
  vi.doMock("@/components/matters/MatterBoard", () => ({ MatterBoard: () => null }));
}

async function render(params: { seg?: string; q?: string; view?: string } = {}) {
  const { default: MattersPage } = await import("../../src/app/dashboard/matters/page");
  return renderToStaticMarkup(await MattersPage({ searchParams: Promise.resolve(params) }));
}

/** The shared header and toolbar (everything up to the filter chips). */
function pageHead(html: string): string {
  return html.slice(html.indexOf('class="lp-header"'), html.indexOf('aria-label="Filter matters"'));
}

const anchor = (html: string, label: string) => html.match(new RegExp(`<a [^>]*>${label}</a>`))?.[0] ?? "";

describe("Matters page header", () => {
  beforeEach(() => {
    vi.resetModules();
    mockLoaders();
  });

  it("labels the toggle Table and Board, never List, inside the page-head", async () => {
    const head = pageHead(await render());
    expect(head).toContain("lx-view-toggle");
    expect(anchor(head, "Table")).not.toBe("");
    expect(anchor(head, "Board")).not.toBe("");
    expect(head).not.toContain(">List<");
  });

  it("links the table to no view param and the board to ?view=board", async () => {
    const head = pageHead(await render());
    expect(anchor(head, "Table")).toMatch(/href="\/dashboard\/matters\/?"/);
    expect(anchor(head, "Table")).not.toContain("view=");
    expect(anchor(head, "Board")).toMatch(/href="\/dashboard\/matters\/?\?view=board"/);
  });

  it("marks the table current by default and the board when ?view=board", async () => {
    const table = pageHead(await render());
    expect(anchor(table, "Table")).toContain('aria-current="page"');
    expect(anchor(table, "Board")).not.toContain("aria-current");

    const board = pageHead(await render({ view: "board" }));
    expect(anchor(board, "Board")).toContain('aria-current="page"');
    expect(anchor(board, "Table")).not.toContain("aria-current");
  });

  it("keeps the segment and the search term when switching view", async () => {
    const head = pageHead(await render({ seg: "court", q: "acme" }));
    expect(anchor(head, "Table")).toMatch(/href="[^"]*seg=court/);
    expect(anchor(head, "Table")).toMatch(/q=acme/);
    expect(anchor(head, "Table")).not.toContain("view=");
    expect(anchor(head, "Board")).toMatch(/seg=court/);
    expect(anchor(head, "Board")).toMatch(/q=acme/);
    expect(anchor(head, "Board")).toContain("view=board");
  });

  it("orders the search (with its Search button), then the toggle, and carries the shared class set", async () => {
    const head = pageHead(await render());
    for (const cls of ["lx-h1", "lx-sub lp-sub", "lp-toolbar", "lp-search"]) expect(head).toContain(`class="${cls}"`);
    expect(head).not.toContain("lx-label");
    expect(head.indexOf("lp-search")).toBeGreaterThan(0);
    expect(head.indexOf(">Search</button>")).toBeGreaterThan(head.indexOf("lp-search"));
    expect(head.indexOf("lx-view-toggle")).toBeGreaterThan(head.indexOf(">Search</button>"));
    expect(head).toContain('aria-label="Search matters"');
  });

  it("shows a Clear link only when a search term is set, and it returns to the list without the term", async () => {
    expect(pageHead(await render())).not.toContain(">Clear<");
    const head = pageHead(await render({ q: "acme", seg: "court" }));
    expect(head).toMatch(/<a class="lp-clear" href="[^"]*seg=court[^"]*">Clear<\/a>/);
    expect(head.match(/<a class="lp-clear" href="([^"]*)"/)?.[1]).not.toContain("q=");
  });

  it("keeps view and seg as hidden fields on the search form", async () => {
    const head = pageHead(await render({ seg: "court", view: "board" }));
    expect(head).toMatch(/<input type="hidden" name="view" value="board"/);
    expect(head).toMatch(/<input type="hidden" name="seg" value="court"/);
  });
});
