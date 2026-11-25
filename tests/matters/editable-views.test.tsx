import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import { isTrademarkRow } from "@/lib/review/sheet";
import { MATTER_TYPE_VALUES } from "@/lib/matters/matter-types";
import { isBuiltinKey } from "@/lib/views/layout/validate";
import {
  CLOSED_COLUMN_KEY,
  MATTER_LIST_BUILTIN,
  MATTER_VIEW_KEYS,
  UNSTAGED_COLUMN_KEY,
  filterByMatterKind,
  matterBoardBase,
  matterKindOf,
  matterListColumns,
  parseMatterKind,
  splitHiddenColumns,
  stageColumnKey,
} from "@/lib/matters/views";
import { VIEW_KEYS } from "@/lib/views/layout/types";

/**
 * Editable views, step 5: Matters and Contracts as two views, each a List and a Board over the shared components, with the firm's layout
 * and the owner's controls. The pure rules first, then the page with fakes.
 */
describe("the two views", () => {
  it("Contracts is the Weekly review's own type rule, for every matter type, and no type reads as a trademark matter", () => {
    for (const type of [...MATTER_TYPE_VALUES, null, undefined]) {
      expect(matterKindOf({ type }) === "trademarks", String(type)).toBe(isTrademarkRow({ kind: "matter", matterType: type ?? null }));
    }
    expect(matterKindOf({ type: "TM" })).toBe("trademarks");
    expect(matterKindOf({ type: "CR" })).toBe("trademarks");
    expect(matterKindOf({ type: "PATENT" })).toBe("trademarks");
    expect(matterKindOf({ type: "BL" })).toBe("contracts");
    expect(matterKindOf({ type: "LIT" })).toBe("contracts");
    expect(filterByMatterKind([{ type: "TM" }, { type: "BL" }, { type: null }], "trademarks")).toHaveLength(2);
  });
  it("`?kind=` keeps every old address meaning Trademarks", () => {
    expect(parseMatterKind(undefined)).toBe("trademarks");
    expect(parseMatterKind("contracts")).toBe("contracts");
    expect(parseMatterKind(["contracts", "x"])).toBe("contracts");
    expect(parseMatterKind("nope")).toBe("trademarks");
    expect(parseMatterKind(" contracts ")).toBe("contracts");
  });
  it("each view has its own layout key, and all four are layout keys the database knows", () => {
    expect(MATTER_VIEW_KEYS.trademarks).toEqual({ list: "matters_list", board: "matters_board" });
    expect(MATTER_VIEW_KEYS.contracts).toEqual({ list: "contracts_list", board: "contracts_board" });
    for (const k of ["matters_list", "matters_board", "contracts_list", "contracts_board"]) expect(VIEW_KEYS as readonly string[]).toContain(k);
  });
  it("the List's built-in keys are layout keys, the first is the pinned link, and a Money column is the owner's alone", () => {
    for (const c of MATTER_LIST_BUILTIN) expect(isBuiltinKey(c.key), c.key).toBe(true);
    expect(MATTER_LIST_BUILTIN[0]).toMatchObject({ key: "matter", pinned: true });
    const fields = [
      { id: "11111111-1111-4111-8111-111111111111", section: "trademarks", label: "Priority", kind: "text", position: 1 },
      { id: "22222222-2222-4222-8222-222222222222", section: "contracts", label: "Renewal", kind: "date", position: 2 },
      { id: "33333333-3333-4333-8333-333333333333", section: "both", label: "Fee", kind: "money", position: 3 },
    ] as const;
    const keys = (kind: "trademarks" | "contracts", money: boolean) => matterListColumns(fields as never, kind, money).map((c) => c.key);
    expect(keys("trademarks", false).slice(7)).toEqual(["cf:11111111-1111-4111-8111-111111111111"]);
    expect(keys("contracts", false).slice(7)).toEqual(["cf:22222222-2222-4222-8222-222222222222"]);
    expect(keys("trademarks", true).slice(7)).toEqual(["cf:11111111-1111-4111-8111-111111111111", "cf:33333333-3333-4333-8333-333333333333"]);
  });
  it("a stage column's key is a valid layout key (35 characters); the Board base is the two fixed columns and the OPEN stages", () => {
    const id = "0A1B2C3D-0000-4000-8000-00000000F001";
    expect(stageColumnKey(id)).toBe("st_0a1b2c3d000040008000" + "00000000f001");
    expect(isBuiltinKey(stageColumnKey(id))).toBe(true);
    const base = matterBoardBase([{ id, label: "A", is_open: true }, { id: "x", label: "Done", is_open: false }], "Not on the docket yet", "Closed");
    expect(base.map((b) => b.key)).toEqual([UNSTAGED_COLUMN_KEY, stageColumnKey(id), CLOSED_COLUMN_KEY]);
  });
  it("a Board layout only hides: order and names stay the stages' own, and it never hides every column", () => {
    const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const layout = [
      { key: "c", label: "Renamed", hidden: false, width: null },
      { key: "b", label: null, hidden: true, width: null },
    ];
    expect(splitHiddenColumns(cols, layout)).toEqual({ shown: [{ key: "a" }, { key: "c" }], hidden: [{ key: "b" }] });
    expect(splitHiddenColumns(cols, null)).toEqual({ shown: cols, hidden: [] });
    const all = cols.map((c) => ({ key: c.key, label: null, hidden: true, width: null }));
    expect(splitHiddenColumns(cols, all)).toEqual({ shown: cols, hidden: [] });
  });
});

/* ── The page ── */

const NOW = Date.now();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const st = (id: string, label: string, phase: string | null, order: number, open = true, role: string | null = null): MatterStage =>
  ({ id, code: id, label, order_index: order, is_open: open, waiting_on: "firm", phase, role }) as unknown as MatterStage;
const STAGES = [
  st("s-intake", "Intake call", "pipeline", 1),
  st("s-hired", "Signed LOE / Deposit Received", "pipeline", 2),
  st("s-pre", "Application Preparation", "pre_filing", 3),
  st("s-post", "Application Filed", "post_filing", 4),
  st("s-done", "Registered", "maintenance", 5, false),
];
let n = 0;
const matter = (type: string, stage: MatterStage | null, o: Partial<Matter> = {}) =>
  ({
    id: `m${++n}`,
    matter_number: `${type}-${n}`,
    mark_text: `Mk${n}z`,
    title: null,
    owner_name: "Dana",
    status: "open",
    type,
    assigned_to: null,
    lead_id: null,
    stage,
    stage_id: stage?.id ?? null,
    stage_entered_at: daysAgo(2),
    ...o,
  }) as unknown as Matter;

type Opts = {
  matters: Matter[];
  stages?: MatterStage[];
  layout?: unknown;
  owner?: "owner" | "not-owner" | "unreadable";
  preview?: boolean;
  role?: string;
  params?: Record<string, string>;
  extras?: unknown;
  holdings?: unknown;
  extrasFn?: unknown;
  staff?: boolean;
};

async function render(o: Opts) {
  vi.resetModules();
  vi.doMock("@/lib/matters", async (orig) => ({ ...(await orig<typeof import("@/lib/matters")>()), listMatters: vi.fn(async () => o.matters) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({ ...(await orig<typeof import("@/lib/pipeline")>()), listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "unconfigured" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []), loadMatterStages: vi.fn(async () => ({ status: "ok", stages: o.stages ?? STAGES })) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: o.role ?? "attorney" })) }));
  vi.doMock("@/lib/views/view-as", async (orig) => ({
    ...(await orig<typeof import("@/lib/views/view-as")>()),
    inPreview: vi.fn(async () => o.preview === true),
    resolveViewSession: vi.fn(async () => ({ kind: "ok", role: o.role ?? "owner", actingAsStaff: o.staff === true, user: { id: "u1" } })),
  }));
  vi.doMock("@/lib/views/layout/load", () => ({ loadViewLayout: vi.fn(async () => o.layout ?? { status: "not-set-up" }) }));
  vi.doMock("@/lib/views/layout/owner-load", () => ({ loadOwnerState: vi.fn(async () => o.owner ?? "not-owner") }));
  vi.doMock("@/lib/stages/holdings", () => ({ loadStageHoldings: vi.fn(async () => o.holdings ?? { status: "ok", byStage: {}, merged: {} }) }));
  vi.doMock("@/lib/matters/list-extras", () => ({ loadMatterListExtras: o.extrasFn ?? vi.fn(async () => o.extras ?? { custom: { status: "not-set-up" }, notes: { status: "ok", byKey: new Map() } }) }));
  vi.doMock("@/components/matters/MatterForms", () => ({ NewMatterForm: () => null }));
  vi.doMock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));
  vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
  const { default: MattersPage } = await import("../../src/app/dashboard/matters/page");
  return renderToStaticMarkup(await MattersPage({ searchParams: Promise.resolve(o.params ?? {}) }));
}

const LAYOUT = (cols: { key: string; label?: string | null; hidden?: boolean; width?: number | null }[], rev = 3) => ({
  status: "ok",
  rev,
  layout: cols.map((c) => ({ key: c.key, label: c.label ?? null, hidden: c.hidden ?? false, width: c.width ?? null })),
});
const heads = (html: string) => [...html.matchAll(/<th scope="col" data-column="([a-z0-9_:-]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  n = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Matters and Contracts pages", () => {
  const list = { view: "table" };

  it("Matters shows trademark matters past the signed engagement; Contracts shows the contracts, uncut", async () => {
    const all = () => ((n = 0), [matter("TM", STAGES[0]), matter("TM", STAGES[2]), matter("CR", STAGES[3]), matter("BL", STAGES[0]), matter("BL", null)]);
    const tm = await render({ matters: all(), params: { ...list, group: "all" } });
    expect(tm).toContain("Mk2z");
    expect(tm).toContain("Mk3z");
    for (const hidden of ["Mk1z", "Mk4z", "Mk5z"]) expect(tm).not.toContain(`${hidden}<`);
    expect(tm).toContain("1 matter is in intake stages");
    const ct = await render({ matters: all(), params: { ...list, kind: "contracts" } });
    expect(ct).toContain("Mk4z");
    expect(ct).toContain("Mk5z");
    expect(ct).not.toContain("Mk2z<");
    expect(ct).not.toContain("in intake stages");
  });

  it("the kind chips are links; the other view starts fresh and every old address stays the Matters view", async () => {
    const html = await render({ matters: [matter("TM", STAGES[2]), matter("BL", null)], params: { ...list, group: "all", seg: "closed" } });
    const nav = html.slice(html.indexOf('aria-label="Kind of matter"'), html.indexOf("</nav>", html.indexOf('aria-label="Kind of matter"')));
    expect(nav).toMatch(/aria-current="page"[^>]*>Matters</);
    // switching keeps the status chip and the view but not the Matters-only group
    expect(nav).toMatch(/href="\/dashboard\/matters\/?\?seg=closed&amp;kind=contracts&amp;view=table"[^>]*>Contracts</);
    const ct = await render({ matters: [matter("TM", STAGES[2]), matter("BL", null)], params: { ...list, kind: "contracts" } });
    expect(ct).not.toContain("Matter group");
    expect(ct).toMatch(/name="kind" value="contracts"/);
  });

  it("with a saved layout, the List draws the firm's order, names and hidden columns", async () => {
    const layout = LAYOUT([
      { key: "matter" },
      { key: "owner", label: "Paralegal" },
      { key: "stage" },
      { key: "type", hidden: true },
      { key: "in_stage", hidden: true },
      { key: "next_step", hidden: true },
      { key: "notes", hidden: true },
    ]);
    const html = await render({ matters: [matter("TM", STAGES[2])], params: list, layout });
    expect(heads(html)).toEqual(["matter", "owner", "stage", "actions"]);
    expect(html).toContain(">Paralegal</th>");
    // no layout: the standard columns
    const plain = await render({ matters: [matter("TM", STAGES[2])], params: list });
    expect(heads(plain)).toEqual(["matter", "type", "stage", "in_stage", "owner", "next_step", "notes", "actions"]);
  });

  it("a layout that couldn't be read draws the standard columns and says so once; not set up says nothing", async () => {
    const bad = await render({ matters: [matter("TM", STAGES[2])], params: list, layout: { status: "unavailable" } });
    expect(heads(bad)).toContain("notes");
    expect(bad).toContain("Saved column layout couldn&#x27;t load");
    const quiet = await render({ matters: [matter("TM", STAGES[2])], params: list, layout: { status: "not-set-up" } });
    expect(quiet).not.toContain("Saved column layout");
  });

  it("firm columns are drawn in the List from the extras read (the kind's section only), read-only", async () => {
    const field = { id: "11111111-1111-4111-8111-111111111111", section: "trademarks", label: "Priority", kind: "text", position: 1, options: [] };
    const m1 = matter("TM", STAGES[2]);
    const extras = {
      custom: { status: "ok", fields: [field], values: [{ id: "v1", fieldId: field.id, leadId: null, matterId: m1.id, text: "High", date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T00:00:00Z" }], mergedInto: {}, leadOfMatter: {} },
      notes: { status: "ok", byKey: new Map() },
    };
    const html = await render({ matters: [m1], params: list, extras });
    expect(heads(html)).toContain("cf:11111111-1111-4111-8111-111111111111");
    expect(html).toContain(">Priority</th>");
    expect(html).toContain("High");
    // a Contracts-only view of the same field shows nothing: the field belongs to Trademarks
    const ct = await render({ matters: [matter("BL", null)], params: { ...list, kind: "contracts" }, extras });
    expect(heads(ct)).not.toContain("cf:11111111-1111-4111-8111-111111111111");
  });

  it("the Notes cell follows the matter page's write roles: a writer can add a note in place, a viewer only reads, a preview writes nothing", async () => {
    const one = () => ((n = 0), [matter("TM", STAGES[2])]);
    const writer = await render({ matters: one(), params: list, role: "attorney" });
    expect(writer).toContain("Add a note");
    const viewer = await render({ matters: one(), params: list, role: "viewer" });
    expect(viewer).not.toContain("Add a note");
    const previewing = await render({ matters: one(), params: list, role: "attorney", preview: true });
    expect(previewing).not.toContain("Add a note");
  });

  it("a hidden Notes column reads no notes (the extras read is asked without them); a shown one reads them", async () => {
    const extrasFn = vi.fn(async () => ({ custom: { status: "not-set-up" }, notes: null }));
    await render({ matters: [matter("TM", STAGES[2])], params: list, layout: LAYOUT([{ key: "matter" }, { key: "notes", hidden: true }]), role: "attorney", extrasFn });
    // Money columns are the real owner's alone: an attorney's read asks for none
    expect(extrasFn).toHaveBeenCalledWith(expect.objectContaining({ withNotes: false, canSeeMoney: false }));
    extrasFn.mockClear();
    await render({ matters: [matter("TM", STAGES[2])], params: list, extrasFn });
    expect(extrasFn).toHaveBeenCalledWith(expect.objectContaining({ withNotes: true }));
    // the Board makes neither read
    extrasFn.mockClear();
    await render({ matters: [matter("TM", STAGES[2])], extrasFn });
    expect(extrasFn).not.toHaveBeenCalled();
  });

  describe("the owner's controls", () => {
    const m = () => ((n = 0), [matter("TM", STAGES[2]), matter("TM", STAGES[3])]);
    const owned = { layout: LAYOUT([{ key: "matter" }]), owner: "owner" as const };

    it("an owner gets the column menu on every List header and the Open a matter button under the List", async () => {
      const html = await render({ matters: m(), params: list, ...owned });
      expect(html).toContain('aria-label="Column options: Stage"');
      expect(html).toContain('aria-label="Column options: Matter"');
      // the actions column has no menu, and the bottom button is a second one
      expect(html).not.toContain("Column options: Actions");
      expect(html.split('aria-label="Open a matter"').length - 1).toBe(2);
    });
    it("a non-owner, a preview, an unreadable owner row and an unread layout get none", async () => {
      for (const o of [{ owner: "not-owner" as const }, { owner: "owner" as const, preview: true }, { owner: "unreadable" as const }, { owner: "owner" as const, layout: { status: "unavailable" } }]) {
        const html = await render({ matters: m(), params: list, layout: LAYOUT([{ key: "matter" }]), ...o });
        expect(html, JSON.stringify(o)).not.toContain("Column options");
      }
    });
    it("a viewer sees no Open a matter row under the List", async () => {
      const html = await render({ matters: m(), params: list, role: "viewer" });
      expect(html.split('aria-label="Open a matter"').length - 1).toBe(1);
    });
    it("hidden columns: the owner gets the control, with Show", async () => {
      const layout = LAYOUT([{ key: "matter" }, { key: "type", hidden: true }]);
      const html = await render({ matters: m(), params: list, layout, owner: "owner" });
      expect(html).toContain("Hidden columns (1)");
      const other = await render({ matters: m(), params: list, layout, owner: "not-owner" });
      expect(other).not.toContain("Hidden columns");
      expect(heads(other)).not.toContain("type");
    });
    it("Board: a stage column menu (Hide) beside the stage menu for an owner; the Contracts board has the same", async () => {
      const html = await render({ matters: m(), ...owned });
      expect(html).toContain('aria-label="Column options for Application Preparation"');
      expect(html).toContain('aria-label="Stage options: Application Preparation"');
      const ct = await render({ matters: [matter("BL", STAGES[2])], params: { kind: "contracts" }, ...owned });
      expect(ct).toContain('aria-label="Column options for Application Preparation"');
    });
    it("Board: a hidden column is out of the board, said in one line, with the owner's Show; a non-owner sees the line, not the control", async () => {
      const hiddenKey = stageColumnKey("s-pre");
      const layout = LAYOUT([{ key: hiddenKey, hidden: true }]);
      const html = await render({ matters: m(), layout, owner: "owner" });
      expect(html).toContain("1 column is hidden in your firm&#x27;s view (1 matter).");
      expect(html).not.toContain('<span class="lx-board-title">Application Preparation</span>');
      expect(html).toContain("Hidden columns (1)");
      const other = await render({ matters: m(), layout, owner: "not-owner" });
      expect(other).toContain("1 column is hidden in your firm&#x27;s view (1 matter).");
      expect(other).not.toContain("Hidden columns (1)");
    });
  });

  describe("Manage stages", () => {
    const manage = (html: string) => html.slice(html.indexOf("data-manage-stages"), html.indexOf("</details>", html.indexOf("data-manage-stages")));
    const data = () => ((n = 0), [matter("TM", STAGES[0]), matter("TM", STAGES[2]), matter("TM", STAGES[4], { status: "closed" })]);

    it("lists EVERY matter stage, the intake and closed ones included, each with the stage menu, for an owner on the Board", async () => {
      const html = await render({ matters: data(), owner: "owner", holdings: { status: "ok", byStage: { "s-intake": ["m1"], "s-pre": ["m2"], "s-done": ["m3"] }, merged: {} } });
      const panel = manage(html);
      for (const s of STAGES) expect(panel, s.label).toContain(s.label);
      for (const s of STAGES) expect(panel).toContain(`aria-label="Stage options: ${s.label}"`);
      expect(panel).toContain("Closed stage · 1 matter");
      expect(panel).toContain("Left out of Matters (before the signed engagement) · 1 matter");
      expect(panel).toContain("Open stage · 1 matter");
      // the intake stage is NOT a column of the board, the manage list is how it is reached
      expect(html.replace(panel, "")).not.toContain('<span class="lx-board-title">Intake call</span>');
    });
    it("is the same on the Contracts board", async () => {
      const html = await render({ matters: [matter("BL", STAGES[2])], owner: "owner", params: { kind: "contracts" } });
      expect(manage(html)).toContain('aria-label="Stage options: Intake call"');
    });
    it("is not drawn for a non-owner, an unreadable owner row, a preview, or the List", async () => {
      for (const o of [{ owner: "not-owner" as const }, { owner: "unreadable" as const }, { owner: "owner" as const, preview: true }, { owner: "owner" as const, params: { view: "table" } }]) {
        const html = await render({ matters: data(), ...o });
        expect(html, JSON.stringify(o)).not.toContain("Manage stages");
      }
    });
    it("a holdings read that failed says so per stage and offers no delete (never an empty count)", async () => {
      const html = await render({ matters: data(), owner: "owner", holdings: { status: "unavailable" } });
      expect(manage(html)).toContain("Count couldn&#x27;t be read");
      expect(manage(html)).not.toContain(" · 0 matters");
    });
  });
});

describe("one List and one Board", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("the Matters List draws through the shared ViewTable and the Board through the shared ViewBoard, with no table markup of its own", () => {
    expect(src("src/components/matters/MatterListTable.tsx")).toContain("<ViewTable");
    expect(src("src/components/matters/MatterBoard.tsx")).toContain("<ViewBoard");
    expect(src("src/components/matters/MatterBoard.tsx")).not.toMatch(/<BoardColumn\b/);
    const page = src("src/app/dashboard/matters/page.tsx");
    expect(page).not.toMatch(/<SheetTable|<thead|<colgroup/);
    // the type rule is the Weekly review's, in one place
    expect(src("src/lib/matters/views.ts")).toContain("isTrademarkRow");
  });
  it("every structure control is gated on the page's owner row and the action asks again (no control without the owner state and the read layout)", () => {
    const page = src("src/app/dashboard/matters/page.tsx");
    expect(page).toMatch(/const layoutEdit = ownerNow && layoutRead\.status === "ok"/);
    expect(page).toMatch(/\{boardView && manageStages && stageAdmin &&/);
    const actions = src("src/lib/views/layout/actions.ts");
    expect(actions).toMatch(/owner: \(\) => loadOwnerState\(\)/);
  });
  it("a layout change redraws the Matters page as well as the Weekly review", () => {
    const actions = src("src/lib/views/layout/actions.ts");
    expect(actions).toMatch(/revalidatePath\(REVIEW_PATH\);\s*revalidatePath\(MATTERS_PATH\)/);
  });
});

const FIELD = (id: string, over: Record<string, unknown> = {}) => ({ id, section: "trademarks", label: "Priority", kind: "text", position: 1, options: [], ...over });
const stateWith = (fields: unknown[], values: unknown[] = []) => ({ custom: { status: "ok", fields, values, mergedInto: {}, leadOfMatter: {} }, notes: { status: "ok", byKey: new Map() } });

describe("step 5 review fixes", () => {
  const list = { view: "table" };
  const one = () => ((n = 0), [matter("TM", STAGES[2])]);

  it("firm columns that couldn't be read say so once; not set up says nothing", async () => {
    const bad = await render({ matters: one(), params: list, extras: { custom: { status: "unavailable" }, notes: { status: "ok", byKey: new Map() } } });
    expect(bad).toContain("Some details couldn&#x27;t load (your firm&#x27;s columns). Refresh to try again.");
    expect(bad.split("your firm&#x27;s columns").length - 1).toBe(1);
    const quiet = await render({ matters: one(), params: list, extras: { custom: { status: "not-set-up" }, notes: { status: "ok", byKey: new Map() } } });
    expect(quiet).not.toContain("your firm&#x27;s columns");
  });

  it("the other view's matches for the same status chip and search are one line with a link; no matches, no line", async () => {
    const mixed = () => ((n = 0), [matter("TM", STAGES[2]), matter("BL", null), matter("BL", null, { status: "closed" })]);
    const html = await render({ matters: mixed(), params: list });
    expect(html).toMatch(/<a href="\/dashboard\/matters\/?\?kind=contracts&amp;view=table">Contracts has 1<\/a>/);
    // the closed chip counts the other view's closed matters, and the link keeps it
    const closed = await render({ matters: mixed(), params: { ...list, seg: "closed" } });
    expect(closed).toMatch(/\?seg=closed&amp;kind=contracts&amp;view=table">Contracts has 1</);
    // reverse, with a search that matches only one side
    const rev = await render({ matters: mixed(), params: { ...list, kind: "contracts" } });
    expect(rev).toMatch(/kind=contracts/);
    expect(rev).toMatch(/>Matters has 1</);
    const searched = await render({ matters: mixed(), params: { ...list, q: "Mk2z" } });
    expect(searched).toContain("Contracts has 1");
    const none = await render({ matters: mixed(), params: { ...list, q: "nothing-matches" } });
    expect(none).not.toContain(" has ");
    // a firm with no contracts gets no line
    expect(await render({ matters: one(), params: list })).not.toContain("Contracts has");
  });

  it("firm columns are ordered by position, label, id, however they arrive; the layout write builds its base the same way", () => {
    const f = (id: string, label: string, position: number) => ({ id, section: "both", label, kind: "text", position });
    const a = f("00000000-0000-4000-8000-00000000000b", "Beta", 2);
    const b = f("00000000-0000-4000-8000-00000000000a", "Alpha", 2);
    const c = f("00000000-0000-4000-8000-00000000000c", "Zed", 1);
    const keys = (fields: unknown[]) => matterListColumns(fields as never, "trademarks", true).slice(7).map((x) => x.label);
    expect(keys([a, b, c])).toEqual(["Zed", "Alpha", "Beta"]);
    expect(keys([c, b, a])).toEqual(keys([a, b, c]));
    expect(readFileSync("src/lib/views/layout/actions.ts", "utf8")).toMatch(/matterListColumns\(\(await fieldStore\(db\)\.readLiveFields\(\)\) as CustomColumnField\[\], kind, true\)/);
  });

  describe("Money stays the real owner's", () => {
    const money = FIELD("11111111-1111-4111-8111-1111111111aa", { label: "Retainer", kind: "money" });
    const value = { id: "v9", fieldId: money.id, leadId: null, matterId: "m1", text: null, date: null, cents: 123456, choice: null, userId: null, updatedAt: "x" };
    const leaked = () => stateWith([FIELD("22222222-2222-4222-8222-2222222222bb", { label: "Priority" }), money], [value]);
    const noMoney = (html: string) => {
      expect(html).not.toContain("Retainer");
      expect(html).not.toContain("1,234.56");
      expect(html).not.toContain("123456");
      expect(heads(html)).not.toContain("cf:11111111-1111-4111-8111-1111111111aa");
    };
    it("Lectual staff acting in the firm with an owner role see no Money header, cell or menu data", async () => {
      noMoney(await render({ matters: one(), params: list, role: "owner", staff: true, extras: leaked(), layout: LAYOUT([{ key: "matter" }]), owner: "not-owner" }));
    });
    it("a non-owner sees none either, even if the read leaked one", async () => {
      noMoney(await render({ matters: one(), params: list, role: "attorney", extras: leaked() }));
    });
    it("the real owner sees the column", async () => {
      const html = await render({ matters: one(), params: list, role: "owner", extras: leaked() });
      expect(heads(html)).toContain("cf:11111111-1111-4111-8111-1111111111aa");
      expect(html).toContain("Retainer");
    });
  });

  it("a Board layout refuses every operation but hide and show, with one fixed sentence, and writes nothing", async () => {
    const { changeLayout } = await import("@/lib/views/layout/save");
    const calls: string[] = [];
    const deps = {
      owner: async () => "owner" as const,
      orgId: async () => "o",
      read: async () => ({ status: "ok" as const, layout: null, rev: null }),
      base: async () => ({ defaults: [{ key: "not_on_docket", label: "Not on the docket yet" }, { key: "closed", label: "Closed" }] }),
      insert: async () => (calls.push("insert"), { error: null }),
      update: async () => (calls.push("update"), { error: null, rev: 2 }),
      revalidate: () => calls.push("revalidate"),
    };
    for (const view of ["matters_board", "contracts_board"]) {
      for (const op of [{ op: "rename", key: "closed", label: "X" }, { op: "move", key: "closed", dir: "left" }, { op: "width", key: "closed", px: 100 }]) {
        expect(await changeLayout(deps, view, op, null), `${view} ${op.op}`).toEqual({ ok: false, error: "On this board a column can only be hidden or shown. Rename and move stages from the stage menu." });
      }
      expect((await changeLayout(deps, view, { op: "hide", key: "closed" }, null)).ok).toBe(true);
    }
    expect(calls.filter((c) => c !== "revalidate")).toEqual(["insert", "insert"]);
  });

  it("the board with empty stages is drawn ONCE (empty columns last and marked, hidden by the page's CSS until Show)", async () => {
    n = 0;
    const html = await render({ matters: [matter("TM", STAGES[2])] });
    expect(html.split('id="matter-card-m1"').length - 1).toBe(1);
    expect(html).toContain("empty stage");
    expect(html).toMatch(/data-shown="false"/);
    expect(html).toContain('data-empty-stage="true"');
    expect(readFileSync("src/app/dashboard/matters/matters.css", "utf8")).toMatch(/\[data-shown="false"\] \[data-empty-stage\] \{ display: none; \}/);
  });

  it("the List is fixed-layout with default widths until a layout sets one", async () => {
    const plain = await render({ matters: one(), params: list });
    expect(plain).toMatch(/<col style="width:230px"\/>/);
    const set = await render({ matters: one(), params: list, layout: LAYOUT([{ key: "matter", width: 300 }]) });
    expect(set).toMatch(/<col style="width:300px"\/>/);
  });

  it("the words the page shows live in words.ts", () => {
    const page = readFileSync("src/app/dashboard/matters/page.tsx", "utf8");
    expect(page).not.toMatch(/No contracts yet|No matters yet|<summary>Open a matter/);
  });
});
