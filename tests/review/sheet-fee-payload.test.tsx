import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { members, OWNER_PERMS, params, rows } from "./columns-fixtures";
import { TODAY } from "./fixtures";
import { MONEY_COLUMNS } from "@/lib/review/sheet-columns";
import { SheetFactTd } from "@/components/review/SheetFactTd";
import { BLANK } from "@/lib/ui/words";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

// Capture what the server hands to the two client tables.
const seen = vi.hoisted(() => ({ view: [] as unknown[], edit: [] as unknown[] }));
vi.mock("@/components/review/SheetViewTable", () => ({ SheetViewTable: (p: unknown) => (seen.view.push(p), null) }));
vi.mock("@/components/review/SheetEditTable", () => ({ SheetEditTable: (p: unknown) => (seen.edit.push(p), null) }));

beforeEach(() => {
  seen.view.length = 0;
  seen.edit.length = 0;
});

type ViewProps = { rows: { cells: Record<string, unknown> }[] };
type EditProps = { sections: { rows: { facts?: Record<string, unknown> }[] }[]; columns: Record<string, { id: string }[]> };

describe("no fee cell is built for a viewer who may not see fees", () => {
  it("the List hands SheetViewTable no money cell (non-owner), and does for the owner", async () => {
    const { SheetView } = await import("@/components/review/SheetView");
    const draw = (canSeeMoney: boolean) =>
      renderToStaticMarkup(<SheetView rows={rows} owner={false} today={TODAY} members={members} canWrite={false} params={params} canSeeMoney={canSeeMoney} />);
    draw(false);
    expect(seen.view.length).toBe(2);
    for (const p of seen.view as ViewProps[]) for (const r of p.rows) for (const id of MONEY_COLUMNS) expect(Object.keys(r.cells)).not.toContain(id);
    seen.view.length = 0;
    draw(true);
    expect((seen.view[0] as ViewProps).rows.some((r) => MONEY_COLUMNS.every((id) => id in r.cells))).toBe(true);
  });

  it("the owner Sheet's rows carry no money fact (non-owner), only the other facts; the owner keeps all eight", async () => {
    const { SheetEdit } = await import("@/components/review/SheetEdit");
    const draw = (canSeeMoney: boolean) =>
      renderToStaticMarkup(<SheetEdit rows={rows} perms={OWNER_PERMS} owner today={TODAY} members={members} canWrite params={params} canSeeMoney={canSeeMoney} />);
    draw(false);
    const props = seen.edit[0] as EditProps;
    const facts = props.sections.flatMap((s) => s.rows.map((r) => r.facts ?? {}));
    expect(facts.length).toBe(rows.length);
    for (const f of facts) {
      for (const id of MONEY_COLUMNS) expect(Object.keys(f)).not.toContain(id);
      expect(Object.keys(f).sort()).toEqual(["oaDue", "practiceArea", "serial", "start"]);
    }
    expect(JSON.stringify(props)).not.toMatch(/\$1,250|Couldn't load|legalFee|govFee/);
    seen.edit.length = 0;
    draw(true);
    const owner = (seen.edit[0] as EditProps).sections.flatMap((s) => s.rows.map((r) => r.facts ?? {}));
    for (const f of owner) expect(Object.keys(f)).toHaveLength(8);
  });
});

describe("fee cell polish", () => {
  it("SheetFactTd falls back to the BLANK word, and a failed read keeps one line", () => {
    const empty = renderToStaticMarkup(<table><tbody><tr><SheetFactTd cell={undefined} label="Legal Fee" /></tr></tbody></table>);
    expect(empty).toContain(`>${BLANK}<`);
    const failed = renderToStaticMarkup(<table><tbody><tr><SheetFactTd cell={{ text: "Couldn't load", tone: "failed" }} label="Legal Fee" /></tr></tbody></table>);
    expect(failed).toContain("rv-fact-failed");
  });
  it("the fee columns are wide enough for 'Couldn't load'", async () => {
    const { DEFAULT_COL_WIDTHS } = await import("@/lib/review/sheet-edit");
    for (const c of ["legalFee", "legalFeeDue", "govFee", "govFeeDue"] as const) expect(DEFAULT_COL_WIDTHS[c]).toBeGreaterThanOrEqual(124);
  });
  it("the owner Sheet draws each section's title above its 'Not tracked' note, and both above the column header", async () => {
    vi.doUnmock("@/components/review/SheetEditTable");
    vi.resetModules();
    vi.doUnmock("@/components/review/SheetEditTable");
    const { renderOwnerSheet } = await import("./columns-fixtures");
    const html = await renderOwnerSheet({ canSeeMoney: true });
    for (const sec of ["trademarks", "contracts"]) {
      const title = html.indexOf(`id="rse-sheet-${sec}"`);
      const note = html.indexOf(`data-section-note="${sec}"`);
      const header = html.indexOf("<thead>", note);
      expect(title).toBeGreaterThan(-1);
      expect(title).toBeLessThan(note);
      expect(note).toBeLessThan(header);
    }
    expect(html).not.toContain('class="sheet-sec"');
  });
});
