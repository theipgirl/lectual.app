import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_STATE, EMPTY_INTAKE_FILTERS, intakeHref, intakeQueryString, parseIntakeViewState } from "@/lib/intake/rows";
import { INTAKE_LIST_PATH, intakeListHref } from "@/lib/intake/list-href";
import { MATTERS_LIST_PATH, mattersListHref, mattersViewFromParam } from "@/lib/matters/list-href";
import { NAV, mobileBarItems, moreSections, navLinkHref, railGroups } from "@/lib/nav";

describe("Intake opens on the Board", () => {
  it("no view in the address is the Board", () => {
    expect(parseIntakeViewState({}).view).toBe("board");
    expect(DEFAULT_VIEW_STATE.view).toBe("board");
    expect(parseIntakeViewState({ view: "" }).view).toBe("board");
  });
  it("the explicit list value, board, and an unknown value keep their old meaning", () => {
    expect(parseIntakeViewState({ view: "table" }).view).toBe("table");
    expect(parseIntakeViewState({ view: "board" }).view).toBe("board");
    expect(parseIntakeViewState({ view: "kanban" }).view).toBe("table");
  });
  it("the Board is the bare address, the list always writes its value", () => {
    expect(intakeHref(EMPTY_INTAKE_FILTERS, DEFAULT_VIEW_STATE)).toBe("/dashboard/intake/");
    expect(intakeQueryString(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, view: "table" })).toBe("view=table");
    expect(intakeHref(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, view: "table", set: "open" })).toBe("/dashboard/intake/?view=table&set=open");
  });
  it("round-trips: what the list writes parses back to the list", () => {
    const href = intakeHref(EMPTY_INTAKE_FILTERS, { ...DEFAULT_VIEW_STATE, view: "table" });
    const params = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseIntakeViewState(params).view).toBe("table");
  });
  it("the helper", () => {
    expect(INTAKE_LIST_PATH).toBe("/dashboard/intake/?view=table");
    expect(intakeListHref()).toBe(INTAKE_LIST_PATH);
    expect(intakeListHref("agent=today")).toBe("/dashboard/intake/?view=table&agent=today");
  });
});

describe("Matters opens on the Board", () => {
  it("no view is the Board; the list value and any other value are the list", () => {
    expect(mattersViewFromParam(undefined)).toBe("board");
    expect(mattersViewFromParam("")).toBe("board");
    expect(mattersViewFromParam("board")).toBe("board");
    expect(mattersViewFromParam("table")).toBe("table");
    expect(mattersViewFromParam("anything")).toBe("table");
  });
  it("the helper", () => {
    expect(MATTERS_LIST_PATH).toBe("/dashboard/matters/?view=table");
    expect(mattersListHref("group=all&seg=stalled")).toBe("/dashboard/matters/?view=table&group=all&seg=stalled");
  });
});

describe("links that mean the list keep landing on the list", () => {
  it("the rail, the phone bar and the More sheet link to the list; the active match stays on the bare path", () => {
    const visible = NAV.filter((i) => i.built !== false);
    expect(navLinkHref(visible.find((i) => i.slug === "intake")!)).toBe(INTAKE_LIST_PATH);
    expect(navLinkHref(visible.find((i) => i.slug === "matters")!)).toBe(MATTERS_LIST_PATH);
    const rail = railGroups(visible, "/dashboard/intake/").flat();
    const hrefs = rail.flatMap((e) => [e.href, ...e.kids.map((k) => k.href)]);
    expect(hrefs).toContain(INTAKE_LIST_PATH);
    expect(hrefs).toContain(MATTERS_LIST_PATH);
    expect(hrefs).not.toContain("/dashboard/intake/");
    expect(hrefs).not.toContain("/dashboard/matters/");
    const intakeKid = rail.flatMap((e) => e.kids).find((k) => k.key === "intake")!;
    expect(intakeKid.active).toBe(true);
    const bar = mobileBarItems(visible, "/dashboard/matters/");
    expect(bar.find((b) => b.slug === "intake")!.href).toBe(INTAKE_LIST_PATH);
    expect(bar.find((b) => b.slug === "matters")?.active ?? true).toBe(true);
    const more = moreSections(visible, "/dashboard/").flatMap((s) => s.items);
    for (const item of more) expect(item.href).not.toMatch(/^\/dashboard\/(intake|matters)\/$/);
  });
});

/** Source files that name a bare Intake or Matters address on purpose: each opens the BOARD (or is not a link). */
const BARE_ALLOWED = new Set<string>([
  "src/lib/nav.ts", // `href` is the pathname prefix the rail matches against, never a link (`linkHref` is)
  "src/lib/intake/list-href.ts",
  "src/lib/intake/rows.ts", // intakeHref: the Board is the bare address
  "src/lib/matters/list-href.ts",
  "src/app/dashboard/intake/_components/IntakeWorkspace.tsx", // builds the opened-card address from its own current address, every query key kept
  "src/app/dashboard/intake/page.tsx", // its own path for the opened card: the open and close links keep every query key
  "src/app/dashboard/matters/page.tsx", // its own href builder: the Board is the bare address
  "src/app/dashboard/pipeline/page.tsx", // column headers link to the boards, explicitly
  "src/lib/stage-keeper/moves.ts", // "Moved by agent today" opens the board explicitly
  "src/components/matters/MovedOutNotice.tsx", // links to a group's board explicitly
  "src/lib/onboarding/hub.ts", // the "board" and "move" steps want the Board
  "src/lib/stages/actions.ts", // the paths revalidated after a stage change (boards, reconcile, review, record pages as /[id] "page"), never a link
]);
const BARE = /["'`]\/dashboard\/(intake|matters)\/?(\?[^"'`]*)?["'`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no bare Intake or Matters link is left that meant the list", () => {
  const root = join(__dirname, "..", "..");
  it("every quoted /dashboard/intake or /dashboard/matters address either carries view= or is on the allow-list", () => {
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = file.slice(root.length + 1);
      if (BARE_ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/revalidatePath|^\s*(\*|\/\/)/.test(line)) return;
        for (const m of line.matchAll(BARE)) if (!/view=/.test(m[0])) offenders.push(`${rel}:${i + 1}: ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
