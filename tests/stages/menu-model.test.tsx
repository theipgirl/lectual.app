import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { neighbours, stageMenuModel, type MenuStage } from "@/lib/stages/menu-model";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/stages/actions", () => ({ changeStageAction: vi.fn() }));
vi.mock("@/app/dashboard/matters/[id]/actions", () => ({ updateMatterStageAction: vi.fn() }));

/** What the owner's stage menu offers (spec-editable-views.md 3b): the database decides again; the menu never offers what it refuses. */

const LEADS: MenuStage[] = [
  { id: "new", name: "New", category: "open", role: "new_enquiry" },
  { id: "cs", name: "Consult", category: "open" },
  { id: "won", name: "Signed", category: "won", role: "signed_loe" },
  { id: "won2", name: "Hired", category: "won" },
  { id: "lost", name: "Lost", category: "lost" },
  { id: "nur", name: "Nurture", category: "nurture" },
];
const at = (id: string, holdings: Record<string, string[]> | null = {}, all = LEADS) =>
  stageMenuModel({ kind: "lead", stage: all.find((s) => s.id === id)!, all, prevId: null, nextId: null, holdings });

describe("lead stages", () => {
  it("type change only while empty and READ; unreadable holdings offer no delete", () => {
    expect(at("cs", { cs: [] }).canChangeType).toBe(true);
    expect(at("cs", { cs: ["l1"] }).canChangeType).toBe(false);
    const unread = at("cs", null);
    expect(unread.canChangeType).toBe(false);
    expect(unread.delete).toEqual({ available: false, reason: "unreadable" });
  });
  it("destinations: open, lost and nurture, never won and never itself", () => {
    const d = at("cs", { cs: ["l1", "l2"] }).delete;
    if (!d.available) throw new Error("expected delete");
    expect(d.ids).toEqual(["l1", "l2"]);
    expect(d.destinations.map((s) => s.id)).toEqual(["new", "lost", "nur"]);
  });
  it("from a won stage only another won stage", () => {
    const d = at("won2", { won2: ["l1"] }).delete;
    if (!d.available) throw new Error("expected delete");
    expect(d.destinations.map((s) => s.id)).toEqual(["won"]);
  });
  it("the role holder asks who takes the role; new_enquiry can't be dropped", () => {
    const d = at("new").delete;
    if (!d.available) throw new Error("expected delete");
    expect(d.role?.role).toBe("new_enquiry");
    expect(d.role?.targets.map((s) => s.id)).toEqual(["cs"]);
    expect(d.role?.canDrop).toBe(false);
  });
  it("signed_loe can be dropped only on the last won stage", () => {
    const two = at("won").delete;
    if (!two.available) throw new Error("expected delete");
    expect(two.role?.canDrop).toBe(false);
    expect(two.role?.targets.map((s) => s.id)).toEqual(["won2"]);
    const only = LEADS.filter((s) => s.id !== "won2");
    const last = at("won", {}, only);
    if (!last.delete.available) throw new Error("expected delete");
    expect(last.lastWon).toBe(true);
    expect(last.delete.lastWon).toBe(true);
    expect(last.delete.role?.canDrop).toBe(true);
  });
  it("the last open stage is not offered for deletion", () => {
    const one = [{ id: "a", name: "A", category: "open" }, { id: "w", name: "W", category: "won" }];
    expect(at("a", {}, one).delete).toEqual({ available: false, reason: "last-open" });
  });
  it("a stage holding only merged leads: no type change, and the delete needs a destination", () => {
    const m = stageMenuModel({ kind: "lead", stage: LEADS[1], all: LEADS, prevId: null, nextId: null, holdings: {}, merged: { cs: 2 } });
    expect(m.canChangeType).toBe(false);
    expect(m.merged).toBe(2);
    expect(m.total).toBe(2);
    if (!m.delete.available) throw new Error("expected delete");
    expect(m.delete.ids).toEqual([]);
    expect(m.delete.destinations.length).toBeGreaterThan(0);
  });
  it("a stage holding a category-bound role never offers Change type, even empty", () => {
    for (const id of ["new", "won"]) {
      const m = at(id, {});
      expect(m.typeHidden).toBe(true);
      expect(m.canChangeType).toBe(false);
    }
    const plain = at("cs", {});
    expect(plain.typeHidden).toBe(false);
    expect(plain.canChangeType).toBe(true);
    const withOther = at("cs", {}, LEADS.map((s) => (s.id === "cs" ? { ...s, role: "consult_scheduled" } : s)));
    expect(withOther.typeHidden).toBe(false);
  });
  it("neighbours are the visible columns", () => {
    expect(neighbours(["a", "b", "c"], "b")).toEqual({ prevId: "a", nextId: "c" });
    expect(neighbours(["a", "b", "c"], "a")).toEqual({ prevId: null, nextId: "b" });
    expect(neighbours(["a"], "z")).toEqual({ prevId: null, nextId: null });
  });
});

describe("matter stages", () => {
  const M: MenuStage[] = [
    { id: "s1", name: "Signed", isOpen: true, role: "signed_loe" },
    { id: "s2", name: "Drafting", isOpen: true },
    { id: "s3", name: "Registered", isOpen: false, role: "registered" },
    { id: "s4", name: "Closed out", isOpen: false },
  ];
  const mat = (id: string) => stageMenuModel({ kind: "matter", stage: M.find((s) => s.id === id)!, all: M, prevId: null, nextId: null, holdings: { [id]: ["m1"] } });
  it("same open/closed by default; the others only with the tick", () => {
    const d = mat("s2").delete;
    if (!d.available) throw new Error("expected delete");
    expect(d.destinations.map((s) => s.id)).toEqual(["s1"]);
    expect(d.otherOpenDestinations.map((s) => s.id)).toEqual(["s3", "s4"]);
  });
  it("the count differs from the column: said; every matter role hides open/closed", () => {
    const m = stageMenuModel({ kind: "matter", stage: M[1], all: M, prevId: null, nextId: null, holdings: { s2: ["m1", "m2"] }, shown: 1 });
    expect(m.countDiffers).toBe(true);
    expect(stageMenuModel({ kind: "matter", stage: M[1], all: M, prevId: null, nextId: null, holdings: { s2: ["m1"] }, shown: 1 }).countDiffers).toBe(false);
    expect(mat("s3").typeHidden).toBe(true);
  });
  it("signed_loe never drops; registered goes to a closed stage or drops", () => {
    const signed = mat("s1").delete;
    const reg = mat("s3").delete;
    if (!signed.available || !reg.available) throw new Error("expected delete");
    expect(signed.role).toEqual({ role: "signed_loe", targets: [M[1]], canDrop: false });
    expect(reg.role).toEqual({ role: "registered", targets: [M[3]], canDrop: true });
  });
});

describe("the menu is drawn only where the page hands it", () => {
  it("MatterBoard: a stage menu on open stage columns with stageAdmin, none without", async () => {
    const { MatterBoard } = await import("@/components/matters/MatterBoard");
    const stages = [
      { id: "s2", code: "2", label: "Drafting", order_index: 2, is_open: true, waiting_on: "firm" as const },
      { id: "s3", code: "3", label: "Registered", order_index: 3, is_open: false, waiting_on: "firm" as const },
    ];
    const matter = { id: "m1", stage_id: "s2", title: "Fox", matter_number: "TM-1", type: "TM", status: "open", assigned_to: null, stage_entered_at: null } as never;
    const admin = { all: stages.map((s) => ({ id: s.id, name: s.label, isOpen: s.is_open })), holdings: { s2: ["m1"] } };
    const owner = renderToStaticMarkup(<MatterBoard stages={stages} matters={[matter]} canMove reviewIds={new Set()} ownerName={() => null} stageAdmin={admin} />);
    expect(owner).toContain('aria-label="Stage options: Drafting"');
    // The panel is closed in a static render; the delete dialog's wording is covered by the model tests.
    expect(owner).not.toContain("Stage options: Registered");
    const other = renderToStaticMarkup(<MatterBoard stages={stages} matters={[matter]} canMove reviewIds={new Set()} ownerName={() => null} />);
    expect(other).not.toContain("Stage options");
  });

  it("the pages hand it only to an owner membership row outside a preview, and the Leads board only on the stage board", () => {
    const root = process.cwd();
    const intake = readFileSync(path.join(root, "src/app/dashboard/intake/page.tsx"), "utf8");
    expect(intake).toMatch(/isOwner\(await loadOwnerState\(\)\) && !\(await inPreview\(\)\)/);
    // Matters reads the owner row and the preview flag ONCE, beside its other reads (the layout menus need them too), and joins them.
    const matters = readFileSync(path.join(root, "src/app/dashboard/matters/page.tsx"), "utf8");
    expect(matters).toMatch(/loadOwnerState\(\),\s*inPreview\(\)/);
    expect(matters).toMatch(/const ownerNow = isOwner\(ownerRead\) && !previewing;/);
    expect(matters).toMatch(/const stageOwner = boardView && stageRead\.status !== "unavailable" && ownerNow;/);
    const board = readFileSync(path.join(root, "src/app/dashboard/intake/_components/IntakeBoard.tsx"), "utf8");
    expect(board).toContain('group !== "stage"');
  });
});
