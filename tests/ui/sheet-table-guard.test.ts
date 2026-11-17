import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, walk } from "./_scan";

/**
 * Guard: every table under src/app/dashboard and src/components is drawn with the sheet table kit (`sheet-tbl`, from the
 * `SheetTable` component in src/components/ui/SheetTable.tsx; see audit TABLE-KIT.md). A `<table>` without the kit's class fails.
 *
 * TODO_BY_AREA names the tables a rollout agent has not converted yet, by page area letter (A Intake, B Matters, C Review and
 * approvals, D Proposals, E Comms and forms, F Settings and AI tools, G Shell). Each area DELETES its own entries when it converts a
 * table: an entry that no longer matches a non-kit table fails too ("remove it"), so the list can only shrink.
 * EXEMPT is for good: public client pages and rendered prose are not part of the workspace look.
 */
const TODO_BY_AREA: Record<string, { area: string; count: number }> = {
  "src/app/dashboard/matters/page.tsx": { area: "B", count: 1 },
  "src/app/dashboard/documents/page.tsx": { area: "B", count: 1 },
  "src/components/review/ReviewSection.tsx": { area: "C", count: 1 },
  "src/app/dashboard/queue/page.tsx": { area: "C", count: 1 },
  "src/components/deck/DeckList.tsx": { area: "C", count: 1 },
  "src/components/proposal-list/ProposalsTable.tsx": { area: "D", count: 1 },
  "src/app/dashboard/quotes/page.tsx": { area: "D", count: 1 },
  "src/app/dashboard/campaigns/page.tsx": { area: "E", count: 1 },
  "src/app/dashboard/campaigns/[id]/page.tsx": { area: "E", count: 1 },
  "src/app/dashboard/campaigns/templates/page.tsx": { area: "E", count: 1 },
  "src/app/dashboard/meetings/page.tsx": { area: "E", count: 1 },
  "src/app/dashboard/forms/_components/StepTables.tsx": { area: "E", count: 2 },
  "src/app/dashboard/forms/_components/IntakePerformance.tsx": { area: "E", count: 1 },
  "src/app/dashboard/forms/_components/WhereTheyCameFrom.tsx": { area: "E", count: 1 },
  "src/app/dashboard/agents/page.tsx": { area: "F", count: 1 },
  "src/app/dashboard/settings/team/page.tsx": { area: "F", count: 1 },
  "src/components/settings/RoleTable.tsx": { area: "F", count: 1 },
};
const EXEMPT = new Set([
  "src/components/ui/SheetTable.tsx",
  "src/components/markdown/Markdown.tsx",
  "src/components/client-proposal/ProposalDocument.tsx",
  "src/components/client-proposal/LoeExhibitTable.tsx",
]);

/** Opening tags `<table ...>` (the tag text up to its closing `>`, quotes and braces respected loosely). */
function tableTags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<table\b/g)) {
    let depth = 0;
    let i = m.index! + 6;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index!, i + 1));
  }
  return out;
}

const files = [...walk("src/app/dashboard"), ...walk("src/components")].filter((f) => f.endsWith(".tsx"));
const found: Record<string, number> = {};
for (const f of files) {
  if (EXEMPT.has(f)) continue;
  const bad = tableTags(fs.readFileSync(path.join(ROOT, f), "utf8")).filter((t) => !t.includes("sheet-tbl"));
  if (bad.length) found[f] = bad.length;
}

describe("every table uses the sheet table kit", () => {
  it("no <table> outside the kit except the ones an area has not converted yet", () => {
    const over = Object.entries(found).filter(([f, n]) => n > (TODO_BY_AREA[f]?.count ?? 0)).map(([f, n]) => `${f}: ${n} table(s) without sheet-tbl. Use <SheetTable> (see TABLE-KIT.md).`);
    expect(over).toEqual([]);
  });

  it("an area's allow-list entry is removed once its table is converted (the list only shrinks)", () => {
    const stale = Object.entries(TODO_BY_AREA)
      .filter(([f, e]) => (found[f] ?? 0) < e.count)
      .map(([f, e]) => `${f} (area ${e.area}): ${found[f] ?? 0} non-kit table(s), allow-list says ${e.count}. Remove or lower the entry.`);
    expect(stale).toEqual([]);
  });

  it("every allow-listed file exists and names an area A to G", () => {
    for (const [f, e] of Object.entries(TODO_BY_AREA)) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
      expect(e.area).toMatch(/^[A-G]$/);
    }
  });

  it("finds the two tables that are already on the kit", () => {
    const sheetUsers = files.filter((f) => fs.readFileSync(path.join(ROOT, f), "utf8").includes("<SheetTable"));
    expect(sheetUsers).toEqual(expect.arrayContaining(["src/components/review/SheetEditTable.tsx", "src/app/dashboard/intake/_components/IntakeTable.tsx"]));
  });
});
