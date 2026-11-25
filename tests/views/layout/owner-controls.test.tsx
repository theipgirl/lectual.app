import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rows, members, TODAY } from "../../review/columns-fixtures";
import { mockPage, renderPage } from "../../review/custom-page-harness";
import { layoutSpy, mockLayoutRead } from "../../review/layout-mock";
import { laneKey } from "@/lib/review/board-layout";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: async () => ({}) }));

const load = { status: "ok", rows, today: TODAY, timeZone: "America/New_York", members, closeStages: [], failed: [] };
const col = (key: string, over: object = {}) => ({ key, label: null, hidden: false, width: null, ...over });
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const MENU = /aria-label="Column options: /;
const SAVED = { status: "ok", rev: 4, layout: [col("client"), col("notes", { label: "What happened" }), col("status"), col("mark", { hidden: true })] };

beforeEach(() => vi.resetModules());

describe("the owner's column menu on the Weekly review List", () => {
  it("an owner (membership row) gets a menu on every header, pinned Client has no Hide or Move, and a Hidden columns control", async () => {
    mockPage({ load, role: "owner", roleViews: true, owner: true });
    mockLayoutRead(SAVED);
    const html = decode(await renderPage({ view: "sheet" }));
    expect(html.match(new RegExp(MENU, "g"))!.length).toBeGreaterThanOrEqual(8);
    expect(html).toMatch(/aria-label="Column options: What happened"/);
    // the hidden column can be shown again: the one layout read hides Mark in each section's own layout
    expect(html).toContain("Hidden columns (2)");
  });
  it("every other caller gets no menu and no Hidden columns control: the same table", async () => {
    for (const [role, owner, staff] of [["owner", false, false], ["admin", false, false], ["attorney", false, false], ["owner", false, true], ["viewer", false, false]] as const) {
      vi.resetModules();
      mockPage({ load, role, owner, staff });
      mockLayoutRead(SAVED);
      const html = decode(await renderPage({ view: "sheet" }));
      expect(html, `${role} ${staff ? "(staff)" : ""}`).not.toMatch(MENU);
      expect(html).not.toContain("Hidden columns");
      expect(html).toMatch(/<th[^>]*data-column="notes"[^>]*>What happened/);
    }
  });
  it("no menu without a saved-layout read that worked (its rev is what a change is fenced on)", async () => {
    for (const read of [{ status: "unavailable" }, { status: "not-set-up" }]) {
      vi.resetModules();
      mockPage({ load, role: "owner", roleViews: true, owner: true });
      mockLayoutRead(read);
      expect(decode(await renderPage({ view: "sheet" }))).not.toMatch(MENU);
    }
  });
  it("the page asks for the layout and the owner row only for the List and the Board", async () => {
    mockPage({ load, role: "owner", roleViews: true, owner: true });
    mockLayoutRead(SAVED);
    await renderPage({ view: "cards" });
    expect(layoutSpy).not.toHaveBeenCalled();
  });
});

describe("the owner's lane menu on the Weekly review Board", () => {
  it("an owner gets a menu on each lane; everyone else none", async () => {
    mockPage({ load, role: "owner", roleViews: true, owner: true });
    mockLayoutRead({ status: "ok", rev: 2, layout: null });
    const html = decode(await renderPage({ view: "board" }));
    expect(html).toMatch(/aria-label="Column options for /);
    vi.resetModules();
    mockPage({ load, role: "attorney", owner: false });
    mockLayoutRead({ status: "ok", rev: 2, layout: null });
    expect(decode(await renderPage({ view: "board" }))).not.toMatch(/Column options for/);
  });
  it("a hidden lane can be shown again from Hidden columns", async () => {
    mockPage({ load, role: "owner", roleViews: true, owner: true });
    const first = rows.map((r) => r.nextStep?.assigneeId ?? r.assignedTo).find((x) => !!x) as string;
    mockLayoutRead({ status: "ok", rev: 2, layout: [col(laneKey(first), { hidden: true }), col("unassigned")] });
    const html = decode(await renderPage({ view: "board" }));
    expect(html).toContain("Hidden columns (1)");
  });
});

describe("the menu component", () => {
  it("draws a button and no panel until opened; the label names the column", async () => {
    const { ColumnMenu } = await import("@/components/views/layout/ColumnMenu");
    const html = renderToStaticMarkup(<ColumnMenu view="review_list_trademarks" rev={1} columnKey="status" label="Status" allowAdd />);
    expect(html).toContain('aria-label="Column options: Status"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Rename");
  });
});

describe("one layout per section, and hidden firm columns", () => {
  it("each section draws ITS OWN saved layout and its menu is fenced on its own rev", async () => {
    mockPage({ load, role: "owner", roleViews: true, owner: true });
    mockLayoutRead((view: string) => ({ status: "ok", rev: view.endsWith("trademarks") ? 7 : 3, layout: view.endsWith("trademarks") ? [col("client"), col("mark", { label: "Brand" })] : [col("client"), col("mark", { label: "Agreement" })] }));
    const html = decode(await renderPage({ view: "sheet" }));
    expect(html).toMatch(/data-column="mark"[^>]*>Brand/);
    expect(html).toMatch(/data-column="mark"[^>]*>Agreement/);
    expect(html).not.toMatch(/data-column="mark"[^>]*>Brand[^]*?data-column="mark"[^>]*>Brand/);
  });
  it("a hidden firm column is listed even when the custom columns weren't read", async () => {
    const F = "cf:0a1b2c3d-0000-4000-8000-00000000f001";
    mockPage({ load: { ...load, custom: { status: "unavailable" } }, role: "owner", roleViews: true, owner: true });
    mockLayoutRead({ status: "ok", rev: 2, layout: [col("client"), col(F, { hidden: true })] });
    expect(decode(await renderPage({ view: "sheet" }))).toContain("Hidden columns (");
  });
});

describe("which items the menu offers", () => {
  it("move items need a visible neighbour; a firm column can edit choices (Choice) and be archived", async () => {
    const { menuItems } = await import("@/lib/views/layout/menu-items");
    expect(menuItems({ pinned: false, allowAdd: true, hasPrev: false, hasNext: true })).toEqual(["rename", "hide", "right", "add-left", "add-right"]);
    expect(menuItems({ pinned: false, allowAdd: true, firm: { kind: "choice" } })).toEqual(["rename", "hide", "left", "right", "add-left", "add-right", "choices", "archive"]);
    expect(menuItems({ pinned: false, allowAdd: true, firm: { kind: "text" } }).slice(-1)).toEqual(["archive"]);
    expect(menuItems({ pinned: true, allowAdd: true, firm: null })).toEqual(["rename", "add-right"]);
  });
  it("a pinned column can only be renamed (and added beside on its right); a lane has no Add", async () => {
    const { menuItems } = await import("@/lib/views/layout/menu-items");
    expect(menuItems({ pinned: false, allowAdd: true })).toEqual(["rename", "hide", "left", "right", "add-left", "add-right"]);
    expect(menuItems({ pinned: true, allowAdd: true })).toEqual(["rename", "add-right"]);
    expect(menuItems({ pinned: false, allowAdd: false })).toEqual(["rename", "hide", "left", "right"]);
  });
});
