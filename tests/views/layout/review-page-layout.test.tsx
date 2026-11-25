import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIEW_LAYOUT_UNAVAILABLE } from "@/lib/ui/words";
import { rows, members, TODAY } from "../../review/columns-fixtures";
import { mockPage, renderPage } from "../../review/custom-page-harness";
import { layoutSpy, mockLayoutRead } from "../../review/layout-mock";
import { laneKey } from "@/lib/review/board-layout";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const load = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, closeStages: [], failed: [] };
const col = (key: string, over: object = {}) => ({ key, label: null, hidden: false, width: null, ...over });
/** Static markup escapes apostrophes. */
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const headers = (html: string) => [...html.matchAll(/<th[^>]*data-column="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const firstTable = (html: string) => html.slice(html.indexOf("<table"), html.indexOf("</table>"));
const SAVED = { status: "ok", rev: 2, layout: [col("client"), col("notes", { label: "What happened" }), col("status"), col("mark", { hidden: true }), col("legal_fee", { width: 300 })] };

beforeEach(() => vi.resetModules());

describe("the Weekly review List draws the firm's saved layout", () => {
  for (const [name, role, roleViews, editable] of [["a viewer (read-only List)", "viewer", false, false], ["an attorney in the standard look (editable List)", "attorney", false, true], ["an owner in the owner's look (editable List)", "owner", true, true]] as const) {
    it(`${name}: saved order, name, hidden column and width, no note`, async () => {
      mockPage({ load, role, roleViews });
      mockLayoutRead(SAVED);
      const html = decode(await renderPage({ view: "sheet" }));
      const first = firstTable(html);
      expect(first).toContain(editable ? "rse-tbl" : "rv-sheet");
      const keys = headers(first);
      expect(keys.slice(0, 3)).toEqual(["client", "notes", "status"]);
      expect(keys).not.toContain("mark");
      expect(first).toMatch(/<th[^>]*data-column="notes"[^>]*>What happened/);
      expect(html).not.toContain(VIEW_LAYOUT_UNAVAILABLE);
      expect(layoutSpy).toHaveBeenCalledWith("review_list");
      // A viewer, and anyone who may not see fees, is not given the fee column by a layout that names it.
      if (!["owner"].includes(role)) expect(first).not.toContain('data-column="legalFee"');
    });
  }

  it("the per-person Columns chooser offers the firm's columns under the firm's names, and not the ones the firm hid", async () => {
    mockPage({ load, role: "attorney" });
    mockLayoutRead(SAVED);
    // The chooser's panel is a closed popover: capture what the page hands it.
    vi.doMock("@/components/review/ColumnChooser", () => ({
      ColumnChooser: ({ sections }: { sections: { id: string; columns: { id: string; header: string }[] }[] }) => <div data-chooser={JSON.stringify(sections.map((s) => [s.id, s.columns.map((c) => c.header)]))} />,
    }));
    const html = await renderPage({ view: "sheet" });
    const chooser = JSON.parse(html.match(/data-chooser="([^"]*)"/)![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'")) as [string, string[]][];
    const trademarks = chooser.find(([id]) => id === "trademarks")![1];
    expect(trademarks.slice(0, 3)).toEqual(["Trademark Owner", "What happened", "Status"]);
    expect(trademarks).not.toContain("Trademark Name");
  });

  it("the owner's fee column takes its saved width in the column group", async () => {
    mockPage({ load, role: "owner", roleViews: true });
    mockLayoutRead(SAVED);
    const html = await renderPage({ view: "sheet" });
    expect(html).toContain('<col style="width:300px"/>');
  });

  it("not set up: the standard columns and no note; couldn't load: the standard columns and ONE note; never an empty table", async () => {
    mockPage({ load, role: "viewer" });
    mockLayoutRead({ status: "ok", layout: null, rev: null });
    const standard = headers(firstTable(await renderPage({ view: "sheet" })));
    expect(standard.length).toBeGreaterThan(5);
    for (const read of [{ status: "not-set-up" }, { status: "unavailable" }]) {
      vi.resetModules();
      mockPage({ load, role: "viewer" });
      mockLayoutRead(read);
      const html = decode(await renderPage({ view: "sheet" }));
      expect(headers(firstTable(html)), read.status).toEqual(standard);
      expect(html.split(VIEW_LAYOUT_UNAVAILABLE).length - 1, read.status).toBe(read.status === "unavailable" ? 1 : 0);
    }
  });

  it("the layout is read for the view being drawn and for no other: List -> review_list, Board -> review_board, Cards -> none", async () => {
    for (const [params, expected] of [[{ view: "sheet" }, ["review_list"]], [{}, ["review_board"]], [{ view: "cards" }, []]] as const) {
      vi.resetModules();
      mockPage({ load, role: "attorney" });
      mockLayoutRead();
      await renderPage(params as never);
      expect(layoutSpy.mock.calls.map((c) => c[0]), JSON.stringify(params)).toEqual(expected);
    }
  });
});

describe("the Weekly review List edits for any role that may edit, not only in the owner's look", () => {
  const WRITERS = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"];
  const READERS = ["viewer", "social_media"];
  it("every role that may edit gets the editable List without role views; the others get the read-only List", async () => {
    for (const role of [...WRITERS, ...READERS]) {
      vi.resetModules();
      mockPage({ load, role, roleViews: false });
      const html = await renderPage({ view: "sheet" });
      const editable = WRITERS.includes(role);
      expect(html.includes("rse-tbl"), role).toBe(editable);
      expect(html.includes('class="rv-sheets"'), role).toBe(!editable);
      // The save line belongs wherever editing does.
      expect(html.includes("rse-status-wrap"), role).toBe(editable);
    }
  });

  it("the owner's look is unchanged around it: the KPI strip and filters stay with the owner view only", async () => {
    mockPage({ load, role: "owner", roleViews: true });
    const owner = await renderPage({ view: "sheet" });
    expect(owner).toContain("rv-owner");
    vi.resetModules();
    mockPage({ load, role: "owner", roleViews: false });
    const standard = await renderPage({ view: "sheet" });
    expect(standard).not.toContain("rv-owner");
    expect(standard).toContain("rse-tbl");
  });
});

describe("the Weekly review Board draws the firm's saved layout of people", () => {
  const A = "u-reb";
  it("a saved order and name apply; a hidden person is said once, never silently dropped", async () => {
    mockPage({ load: { ...load, rows: rowsForBoard() }, role: "attorney" });
    mockLayoutRead({ status: "ok", rev: 1, layout: [col(laneKey("u-sam"), { label: "Sam (paralegal)" }), col(laneKey(A), { hidden: true })] });
    const html = decode(await renderPage({}));
    expect(html).toContain("Sam (paralegal)");
    expect(html).toContain("1 person's column is hidden in this firm's layout.");
    // The List, where those records still show, is one link away (the same review URL, view=sheet).
    expect(html).toMatch(/<a class="lx-link" href="[^"]*view=sheet[^"]*">See them in the List<\/a>/);
    expect(layoutSpy).toHaveBeenCalledWith("review_board");
  });

  it("couldn't load: the standard lanes and the one note", async () => {
    mockPage({ load: { ...load, rows: rowsForBoard() }, role: "attorney" });
    mockLayoutRead({ status: "unavailable" });
    const html = decode(await renderPage({}));
    expect(html).toContain(VIEW_LAYOUT_UNAVAILABLE);
    expect(html).toContain("rv-board");
  });
});

/** Two records on the Board: one for each of two people. */
function rowsForBoard() {
  return rows.map((r, i) => ({ ...r, waiting: "us", nextStep: { id: `00000000-0000-4000-8000-00000000010${i}`, title: "Call", dueDate: "2026-11-20", assigneeId: i === 0 ? "u-reb" : "u-sam" } }));
}

describe("View as: a preview draws the read-only List (every save would be refused)", () => {
  it("an owner previewing a writing teammate gets no editors, no save line; outside a preview the same role gets them", async () => {
    mockPage({ load, role: "paralegal" });
    vi.doMock("@/lib/views/view-as", async (importOriginal) => ({ ...(await importOriginal<object>()), inPreview: async () => true }));
    const previewing = await renderPage({ view: "sheet" });
    expect(previewing).toContain('class="rv-sheets"');
    expect(previewing).not.toContain("rse-tbl");
    expect(previewing).not.toContain("rse-status-wrap");
    vi.resetModules();
    vi.doUnmock("@/lib/views/view-as");
    mockPage({ load, role: "paralegal" });
    expect(await renderPage({ view: "sheet" })).toContain("rse-tbl");
  });
});

describe("the hidden-lane sentence", () => {
  it("counts Unassigned apart from people", async () => {
    const { boardLanesHidden } = await import("@/lib/ui/words");
    expect(boardLanesHidden(2, true)).toBe("Unassigned and 2 people's columns are hidden in this firm's layout.");
    expect(boardLanesHidden(1, true)).toBe("Unassigned and 1 person's column are hidden in this firm's layout.");
    expect(boardLanesHidden(0, true)).toBe("The Unassigned column is hidden in this firm's layout.");
    expect(boardLanesHidden(1, false)).toBe("1 person's column is hidden in this firm's layout.");
    expect(boardLanesHidden(3, false)).toBe("3 people's columns are hidden in this firm's layout.");
  });
});
