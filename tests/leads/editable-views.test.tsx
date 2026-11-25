import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { buildIntakeRows, parseIntakeFilters, parseIntakeViewState, type IntakeSearchParams } from "@/lib/intake/rows";
import { intakeStages } from "@/lib/intake/scope";
import { boardModel } from "@/lib/intake/board-columns";
import { LEADS_LIST_BUILTIN, LEADS_VIEW_KEYS, drawnLeadColumns, hideStageColumns, leadsBoardBase, leadsListColumns } from "@/lib/leads/views";
import { leadFirmColumns } from "@/lib/leads/firm-cells";
import { stageColumnKey, isStageBoardView } from "@/lib/views/layout/stage-columns";
import { isBuiltinKey } from "@/lib/views/layout/validate";
import { VIEW_KEYS } from "@/lib/views/layout/types";
import { visibleColumns } from "@/lib/intake/col-widths";
import IntakeWorkspace from "@/app/dashboard/intake/_components/IntakeWorkspace";
import type { CustomColumnsState } from "@/lib/custom-columns/rules";

/**
 * Editable views, step 6: the Leads List and Board take the firm's layout and the owner's controls, and keep everything Item L built.
 * The pure rules first, then the workspace rendered with fakes (a static render: no router, the actions only need to exist).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
vi.mock("@/app/dashboard/intake/actions", () => ({ assignLeadAction: vi.fn(), moveStageAction: vi.fn(), setLaneAction: vi.fn(), setSourceAction: vi.fn(), bulkMoveStageAction: vi.fn() }));
vi.mock("@/app/dashboard/leads/actions", () => ({ createLeadAction: vi.fn() }));
vi.mock("@/app/dashboard/intake/time-actions", () => ({ startTimerAction: vi.fn(), stopTimerAction: vi.fn(), logTimeAction: vi.fn() }));
vi.mock("@/lib/views/layout/actions", () => ({ changeLayoutAction: vi.fn(), addColumnAction: vi.fn(), firmColumnAction: vi.fn() }));
vi.mock("@/app/dashboard/review/actions", () => ({ addLeadFromReviewAction: vi.fn() }));

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const read = (p: string) => readFileSync(p, "utf8");
const col = (key: string, o: Partial<{ label: string | null; hidden: boolean; width: number | null }> = {}) => ({ key, label: null, hidden: false, width: null, ...o });

const FIELD_A = "11111111-1111-4111-8111-111111111111";
const FIELD_MONEY = "33333333-3333-4333-8333-333333333333";
const FIELDS = [
  { id: FIELD_A, section: "trademarks", label: "Priority", kind: "text", position: 1 },
  { id: "22222222-2222-4222-8222-222222222222", section: "contracts", label: "Renewal", kind: "date", position: 2 },
  { id: FIELD_MONEY, section: "both", label: "Fee", kind: "money", position: 3 },
] as const;

describe("the two views and their columns", () => {
  it("the Leads List and Board have their own layout keys, which the database knows", () => {
    expect(LEADS_VIEW_KEYS).toEqual({ list: "leads_list", board: "leads_board" });
    for (const k of Object.values(LEADS_VIEW_KEYS)) expect(VIEW_KEYS as readonly string[]).toContain(k);
    expect(isStageBoardView("leads_board")).toBe(true);
    expect(isStageBoardView("leads_list")).toBe(false);
  });
  it("the built-in columns are Item L's own keys, valid layout keys, with the link to the lead first and pinned", () => {
    for (const c of LEADS_LIST_BUILTIN) expect(isBuiltinKey(c.key), c.key).toBe(true);
    expect(LEADS_LIST_BUILTIN.map((c) => c.key)).toEqual(["lead", "stage", "temp", "source", "owner", "assistant", "touch", "next"]);
    expect(LEADS_LIST_BUILTIN[0]).toMatchObject({ key: "lead", pinned: true });
  });
  it("a firm column is a Trademarks-section column, and a Money column is a real owner's alone", () => {
    const keys = (money: boolean) => leadsListColumns(FIELDS as never, money).map((c) => c.key).slice(8);
    expect(keys(false)).toEqual([`cf:${FIELD_A}`]);
    expect(keys(true)).toEqual([`cf:${FIELD_A}`, `cf:${FIELD_MONEY}`]);
  });
  it("no saved layout draws the columns Item L drew; Owner and Assistant activity keep their own rule whatever the layout says", () => {
    const cols = leadsListColumns([], false);
    for (const owner of [false, true]) for (const assistant of [false, true]) {
      expect(drawnLeadColumns(cols, null, { owner, assistant }).map((c) => c.key)).toEqual(visibleColumns({ owner, assistant }));
    }
    // a layout that names the two as visible can't make them show when nobody has an owner / nothing to show
    const layout = cols.map((c) => col(c.key));
    expect(drawnLeadColumns(cols, layout, { owner: false, assistant: false }).map((c) => c.key)).not.toContain("owner");
    expect(drawnLeadColumns(cols, layout, { owner: true, assistant: true }).map((c) => c.key)).toContain("assistant");
  });
  it("a saved layout orders, renames, widens and hides; the pinned link can't be hidden and a firm column follows the layout", () => {
    const cols = leadsListColumns(FIELDS as never, false);
    const layout = [col("stage", { hidden: true }), col("lead", { hidden: true }), col(`cf:${FIELD_A}`), col("next", { label: "What now", width: 300 }), col("source")];
    const drawn = drawnLeadColumns(cols, layout, { owner: false, assistant: false });
    expect(drawn.map((c) => c.key)).toEqual(["lead", `cf:${FIELD_A}`, "next", "source", "temp", "touch"]);
    expect(drawn.find((c) => c.key === "next")).toMatchObject({ label: "What now", width: 300 });
    // a key the viewer doesn't have (a Money column for a non-owner) is dropped, never added
    expect(drawnLeadColumns(cols, [...layout, col(`cf:${FIELD_MONEY}`)], { owner: false, assistant: false }).map((c) => c.key)).not.toContain(`cf:${FIELD_MONEY}`);
  });
});

describe("the firm's columns on a lead", () => {
  const value = (leadId: string, text: string) => ({ id: `v-${leadId}`, fieldId: FIELD_A, leadId, matterId: null, text, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T00:00:00Z" });
  const state = (extra: unknown[] = []): CustomColumnsState =>
    ({ status: "ok", fields: [{ ...FIELDS[0], options: [] }, { ...FIELDS[2], options: [] }], values: [value("l1", "High"), ...extra], mergedInto: {}, leadOfMatter: {} }) as never;
  it("cells are keyed by the layout's own lowercase key, per lead; a lead with no value reads as a dash", () => {
    const f = leadFirmColumns({ leadIds: ["l1", "l2"], state: state(), canSeeMoney: true, members: [], today: "2026-11-25" });
    expect(f.cells.l1[`cf:${FIELD_A}`]).toMatchObject({ text: "High", tone: "value" });
    expect(f.cells.l2[`cf:${FIELD_A}`].tone).toBe("none");
    expect(f.meta[`cf:${FIELD_A}`]).toEqual({ kind: "text", options: [] });
    expect(f.unavailable).toBe(false);
  });
  it("Money never reaches a viewer who may not see it: the field, its meta and its cell are gone", () => {
    const money = { id: "v-m", fieldId: FIELD_MONEY, leadId: "l1", matterId: null, text: null, date: null, cents: 125000, choice: null, userId: null, updatedAt: "2026-11-01T00:00:00Z" };
    const owner = leadFirmColumns({ leadIds: ["l1"], state: state([money]), canSeeMoney: true, members: [], today: "2026-11-25" });
    const other = leadFirmColumns({ leadIds: ["l1"], state: state([money]), canSeeMoney: false, members: [], today: "2026-11-25" });
    expect(Object.keys(owner.cells.l1)).toContain(`cf:${FIELD_MONEY}`);
    expect(Object.keys(other.cells.l1)).not.toContain(`cf:${FIELD_MONEY}`);
    expect(Object.keys(other.meta)).not.toContain(`cf:${FIELD_MONEY}`);
    expect(JSON.stringify(other)).not.toContain("1,250");
  });
  it("three states: a failed read is said (unavailable), not set up says nothing, neither is 'no columns' drawn as data", () => {
    expect(leadFirmColumns({ leadIds: ["l1"], state: { status: "unavailable" }, canSeeMoney: true, members: [], today: "2026-11-25" }).unavailable).toBe(true);
    expect(leadFirmColumns({ leadIds: ["l1"], state: { status: "not-set-up" }, canSeeMoney: true, members: [], today: "2026-11-25" }).unavailable).toBe(false);
    expect(leadFirmColumns({ leadIds: ["l1"], state: null, canSeeMoney: true, members: [], today: "2026-11-25" }).unavailable).toBe(false);
  });
});

/* ── The stage board ── */

const NOW = new Date("2026-10-20T12:00:00.000Z");
const STAGES = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", org_id: "o", name: "New enquiry", order_index: 1, category: "open", aging_threshold_days: 30 },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", org_id: "o", name: "Contacted", order_index: 2, category: "open", aging_threshold_days: 30 },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", org_id: "o", name: "Proposal sent", order_index: 3, category: "open", aging_threshold_days: 30 },
  { id: "aaaaaaaa-0000-4000-8000-000000000009", org_id: "o", name: "Signed", order_index: 9, category: "won", aging_threshold_days: null },
] as unknown as Stage[];
const [S1, S2, S3] = STAGES.map((s) => s.id);
const MEMBERS: MemberIdentity[] = [{ userId: "u-1", email: "rebecca@example.com", displayName: "Rebecca Beliard", role: "owner", identified: true }];
const lead = (id: string, first: string, stageId: string, o: Record<string, unknown> = {}) =>
  ({ id, org_id: "o", first_name: first, last_name: "Tester", email: `${id}@example.com`, current_stage_id: stageId, stage_entered_at: NOW.toISOString(), assigned_to: null, temperature: null, lane: null, lane_set_by: null, lane_set_at: null, ai_summary: null, last_activity_at: null, last_outbound_at: null, last_inbound_at: null, mark_text: null, business_name: null, referral_source: null, referral_detail: null, ...o }) as unknown as Lead;
const LEADS = [lead("l1", "Ann", S1), lead("l2", "Bo", S2), lead("l3", "Cy", S2), lead("l4", "Di", S3)];

type View = Parameters<typeof IntakeWorkspace>[0]["listView"];
function render(params: IntakeSearchParams, extra: { listView?: View; boardView?: Parameters<typeof IntakeWorkspace>[0]["boardView"]; addRow?: Parameters<typeof IntakeWorkspace>[0]["addRow"]; leads?: Lead[] } = {}) {
  const rows = buildIntakeRows({ leads: extra.leads ?? LEADS, stages: STAGES, members: MEMBERS, now: NOW });
  return decode(
    renderToStaticMarkup(
      <IntakeWorkspace
        rows={rows}
        stages={STAGES}
        intakeStages={intakeStages(STAGES)}
        members={MEMBERS}
        initialFilters={parseIntakeFilters(params)}
        initialViewState={parseIntakeViewState(params)}
        time={null}
        now={NOW.toISOString()}
        {...(extra.listView ? { listView: extra.listView } : {})}
        {...(extra.boardView ? { boardView: extra.boardView } : {})}
        {...(extra.addRow !== undefined ? { addRow: extra.addRow } : {})}
      />,
    ),
  );
}

describe("the stage board: the layout hides and shows only", () => {
  const model = (rows = buildIntakeRows({ leads: LEADS, stages: STAGES, members: MEMBERS, now: NOW }), showEmpty = false) =>
    boardModel({ rows, stages: intakeStages(STAGES), members: MEMBERS, group: "stage", pinned: [], extra: {}, showEmpty });
  const hide = (...ids: string[]) => ids.map((id) => col(stageColumnKey(id), { hidden: true }));

  it("the Board's base is one column per intake stage, in pipeline order, by the stage's own key", () => {
    expect(leadsBoardBase(STAGES).map((b) => b.key)).toEqual([S1, S2, S3].map(stageColumnKey));
    expect(leadsBoardBase(STAGES).map((b) => b.label)).toEqual(["New enquiry", "Contacted", "Proposal sent"]);
  });
  it("a hidden column's leads are counted, never silently gone; renderedIds follows what is drawn", () => {
    const m = model();
    const out = hideStageColumns(m, hide(S2));
    expect(out.model.columns.map((c) => c.key)).toEqual([S1, S3]);
    expect(out.hidden).toEqual([{ key: stageColumnKey(S2), stageId: S2, label: "Contacted", leads: 2 }]);
    expect(out.model.renderedIds.sort()).toEqual(["l1", "l4"]);
    expect(m.renderedIds).toHaveLength(4);
  });
  it("order and names stay the stages' own: a saved order or label changes nothing", () => {
    const layout = [col(stageColumnKey(S3), { label: "Last" }), col(stageColumnKey(S1), { label: "First" })];
    expect(hideStageColumns(model(), layout)).toEqual({ model: model(), hidden: [] });
  });
  it("nothing hidden returns the model itself; a layout that would hide every drawn column hides none", () => {
    const m = model();
    expect(hideStageColumns(m, null).model).toBe(m);
    expect(hideStageColumns(m, [col("x")]).model).toBe(m);
    const all = hideStageColumns(m, hide(S1, S2, S3));
    expect(all.hidden).toEqual([]);
    expect(all.model).toBe(m);
  });
  it("the named empty stages are hidden the same way, with no leads to count", () => {
    const m = model(buildIntakeRows({ leads: [LEADS[0]], stages: STAGES, members: MEMBERS, now: NOW }));
    expect(m.empty.map((e) => e.stageId)).toEqual([S2, S3]);
    const out = hideStageColumns(m, hide(S3));
    expect(out.model.empty.map((e) => e.stageId)).toEqual([S2]);
    expect(out.hidden).toMatchObject([{ stageId: S3, leads: 0 }]);
  });

  it("a hidden column that holds a card moved this session stays drawn, marked, and is not counted as hidden", () => {
    const m = model();
    const out = hideStageColumns(m, hide(S2, S3), ["l2"]);
    expect(out.model.columns.map((c) => c.key)).toEqual([S1, S2]);
    expect(out.model.columns[1].hiddenByLayout).toBe(true);
    expect(out.hidden.map((h) => h.stageId)).toEqual([S3]);
    expect(out.model.renderedIds).toContain("l2");
    // only pinned in a column nothing hides: unchanged
    expect(hideStageColumns(m, hide(S3), ["l1"]).model.columns.map((c) => c.hiddenByLayout)).toEqual([undefined, undefined]);
  });
  it("only a stage the layout write knows gets the Hide menu (the Nurture column of a stage past the first won one has none)", () => {
    const html = render({ view: "board" }, { boardView: { layout: null, edit: { view: "leads_board", rev: 1 }, hidden: null, note: null } });
    expect(html.match(/aria-label="Column options for /g)).toHaveLength(3);
    const src = read("src/app/dashboard/intake/_components/IntakeBoard.tsx");
    expect(src).toContain("hideableKeys.includes(stageColumnKey(stageId))");
  });
  it("ViewTable puts its own attributes last, so a caller's props can't overwrite them", async () => {
    const { ViewTable } = await import("@/components/views/table/ViewTable");
    const html = renderToStaticMarkup(
      <ViewTable columns={[{ key: "a", label: "A" }]} rows={[{ key: "r1" }]} cell={() => <td>x</td>} headProps={() => ({ scope: "row", "data-column": "evil" })} rowProps={() => ({ "data-row": "evil" })} />,
    );
    expect(html).toContain('scope="col"');
    expect(html).toContain('data-column="a"');
    expect(html).toContain('data-row="r1"');
  });
  it("rendered: a hidden stage's column is gone, one line says how many columns and leads, and its cards are not drawn", () => {
    const html = render({ view: "board" }, { boardView: { layout: hide(S2), edit: null, hidden: null, note: null } });
    expect(html).toContain("1 column is hidden in your firm&#x27;s view (2 leads).".replace("&#x27;", "'"));
    expect(html).toContain(">Ann Tester<");
    expect(html).toContain(">Di Tester<");
    expect(html).not.toContain(">Bo Tester<");
    expect(html).not.toContain("aria-label=\"Contacted, 2 leads\"");
  });
  it("no layout draws the board exactly as before (no note, every column)", () => {
    const html = render({ view: "board" });
    expect(html).not.toContain("hidden in your firm");
    expect(html).toContain("aria-label=\"Contacted, 2 leads\"");
  });
  it("the owner board is untouched by the layout (its columns are people)", () => {
    const html = render({ view: "board", group: "owner" }, { boardView: { layout: hide(S2), edit: null, hidden: null, note: null } });
    expect(html).not.toContain("hidden in your firm");
    expect(html).toContain(">Bo Tester<");
  });
  it("an owner gets the column menu on each stage column and the Hidden columns control; everyone else gets neither", () => {
    const edit = { view: "leads_board" as const, rev: 2 };
    const owner = render({ view: "board" }, { boardView: { layout: hide(S2), edit, hidden: { view: "leads_board", rev: 2, items: [{ key: stageColumnKey(S2), label: "Contacted" }] }, note: null } });
    expect(owner.match(/aria-label="Column options for /g)).toHaveLength(2);
    expect(owner).toContain("Hidden columns (1)");
    const other = render({ view: "board" }, { boardView: { layout: hide(S2), edit: null, hidden: null, note: null } });
    expect(other).not.toContain("Column options for");
    expect(other).not.toContain("Hidden columns");
  });
  it("a layout that couldn't be read says so once and draws every column", () => {
    const html = render({ view: "board" }, { boardView: { layout: null, edit: null, hidden: null, note: "We couldn't load your firm's layout for this view. The standard columns are shown." } });
    expect(html).toContain("The standard columns are shown.");
    expect(html).toContain(">Bo Tester<");
  });
});

/* ── The List ── */

describe("the List through the shared table", () => {
  const cols = leadsListColumns(FIELDS as never, false);
  const view = (o: Partial<NonNullable<View>> = {}): NonNullable<View> => ({ columns: cols, layout: null, edit: null, fieldMeta: {}, firmCells: {}, hidden: null, note: null, firmUnavailable: false, ...o });

  it("keeps Item L's row: the ix-row, its data hooks, the standard columns in order and the paging foot", () => {
    const html = render({ view: "table" }, { listView: view() });
    expect(html).toContain("ix-tbl");
    expect(html).toMatch(/<tr(?=[^>]*class="ix-row")(?=[^>]*data-lead-row="l1")[^>]*>/);
    const heads = [...html.matchAll(/<th[^>]*data-col="(\w+)"/g)].map((m) => m[1]);
    expect(heads).toEqual(["lead", "stage", "temp", "source", "touch", "next"]);
    // 30 leads: the page still shows 25 at a time, "Showing N of M" over the whole filtered set
    const many = Array.from({ length: 30 }, (_, i) => lead(`m${i}`, `Person${i}`, S1));
    const paged = render({ view: "table" }, { listView: view(), leads: many });
    expect(paged).toContain("Showing 25 of 30");
    expect(paged.match(/data-lead-row=/g)).toHaveLength(25);
    expect(html).toMatch(/aria-label="Sort by Last contact"/);
  });
  it("the firm's layout renames, hides, orders and widens; a firm column is a column with its cells", () => {
    const layout = [col("source", { hidden: true }), col("next", { label: "What now" }), col(`cf:${FIELD_A}`), col("lead")];
    const html = render(
      { view: "table" },
      { listView: view({ layout, firmCells: { l1: { [`cf:${FIELD_A}`]: { text: "High", tone: "value" } } }, fieldMeta: { [`cf:${FIELD_A}`]: { kind: "text", options: [] } } }) },
    );
    const heads = [...html.matchAll(/<th[^>]*data-col="([^"]+)"/g)].map((m) => m[1]);
    expect(heads).toEqual(["lead", "next", `cf:${FIELD_A}`, "stage", "temp", "touch"]);
    expect(html).toContain("What now");
    expect(html).not.toContain('data-col="source" data-label');
    expect(html).toContain(">High<");
  });
  it("only an owner gets the column menu on each header (the link to the lead included, for its name only); Hidden columns only when something is hidden", () => {
    const edit = { view: "leads_list" as const, rev: 3 };
    const owner = render({ view: "table" }, { listView: view({ edit, hidden: [{ view: "leads_list", rev: 3, items: [{ key: "source", label: "Source" }] }] }) });
    expect(owner.match(/aria-label="Column options: /g)).toHaveLength(7); // six built-ins and the firm's Priority column
    expect(owner).toContain("Hidden columns (1)");
    const nobody = render({ view: "table" }, { listView: view() });
    expect(nobody).not.toContain("Column options");
    expect(nobody).not.toContain("Hidden columns");
  });
  it("a layout read that failed says so once and the standard columns are drawn; a failed firm-column read says so too", () => {
    const html = render({ view: "table" }, { listView: view({ note: "We couldn't load your firm's layout for this view. The standard columns are shown.", firmUnavailable: true }) });
    expect(html).toContain("The standard columns are shown.");
    expect(html).toContain("Some details couldn&#x27;t load (your firm&#x27;s columns).".replace(/&#x27;/g, "'"));
    expect([...html.matchAll(/<th[^>]*data-col="([^"]+)"/g)]).toHaveLength(7);
  });
  it("the layout never touches the Board's view or the paging: the Board still draws its columns, the foot still counts", () => {
    const html = render({ view: "board" }, { listView: view({ layout: [col("stage", { hidden: true })] }) });
    expect(html).toContain("aria-label=\"New enquiry, 1 leads\"");
  });
});

describe("Add a lead under the List", () => {
  const addRow = { stages: [{ id: S1, name: "New enquiry" }, { id: S2, name: "Contacted" }], defaultStageId: S1 };
  it("is drawn under the Table for a role that can create a lead, closed until asked, and not on the Board", () => {
    const table = render({ view: "table" }, { addRow });
    expect(table).toContain('aria-label="Add to the list"');
    expect(table).toContain("rv-addrow");
    expect(table).not.toContain('name="firstName"');
    expect(render({ view: "board" }, { addRow })).not.toContain("rv-addrow");
  });
  it("is not drawn for a role that can't (no row given), nor in the Lost set", () => {
    expect(render({ view: "table" }, { addRow: null })).not.toContain("rv-addrow");
    expect(render({ view: "table" })).not.toContain("rv-addrow");
  });
  it("the form is the Weekly review's own, with Start in and Leads' own words (no Go to Leads link, no weekly-review sentence)", async () => {
    const { AddLeadForm } = await import("@/components/review/AddRow");
    const html = decode(renderToStaticMarkup(<AddLeadForm onAnother={() => {}} onCancel={() => {}} stages={addRow.stages} defaultStageId={S1} onLeads />));
    expect(html).toContain("Start in");
    expect(html).toContain("the same as the Add a lead button above");
    expect(html).not.toContain("joins this list once it moves past first contact");
    expect(html).not.toMatch(/name="(currentStageId|assignedTo|org_id|orgId)"/);
  });
  it("creates through the one action (addLeadFromReviewAction), which checks the role and the stage on the server", () => {
    const row = read("src/components/review/AddRow.tsx");
    expect(row).toContain("addLeadFromReviewAction");
    const action = read("src/app/dashboard/review/actions.ts");
    expect(action).toContain('chooseStartStage(await listStages(), formData.get("stageId"))');
    expect(action).toContain('revalidatePath("/dashboard/intake/")');
  });
});

describe("the page", () => {
  const page = read("src/app/dashboard/intake/page.tsx");
  it("reads both layouts, the firm columns and the owner row once, scoped, and never the service role", () => {
    expect(page).toContain("loadViewLayout(LEADS_VIEW_KEYS.list)");
    expect(page).toContain("loadViewLayout(LEADS_VIEW_KEYS.board)");
    expect(page).toContain("loadLeadListExtras");
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code(page)).not.toMatch(/db\/admin|service[-_ ]?role/);
    expect(code(read("src/lib/leads/list-extras.ts"))).not.toMatch(/db\/admin|service[-_ ]?role/);
  });
  it("hands the menus only to an owner membership row outside a preview, and Add a lead only to a role that can write a lead outside a preview", () => {
    expect(page).toContain("const listEdit = ownerNow && listLayoutRead.status === \"ok\"");
    expect(page).toContain("const boardEdit = ownerNow && boardLayoutRead.status === \"ok\"");
    expect(page).toContain("const canAddLead = !previewing && session?.kind === \"ok\" && CAN_WRITE_LEAD.includes(session.role);");
  });
  it("reads the firm's columns only for the List, never for the Board or the Lost set", () => {
    expect(page).toContain('viewState.view === "table" && !lostView ? await loadLeadListExtras');
  });
  it("Money for the firm's columns comes from the re-resolved session, never from the browser", () => {
    expect(page).toContain("canSeeCustomMoney(session.role, session.actingAsStaff)");
  });
});
