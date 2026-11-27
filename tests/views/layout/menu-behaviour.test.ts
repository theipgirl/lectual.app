import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Source checks on what a markup-only test can't see (there is no DOM environment): the panel's listeners, its roles, the success state. */
const menu = readFileSync("src/components/views/layout/ColumnMenu.tsx", "utf8");
const add = readFileSync("src/components/review/AddRow.tsx", "utf8");
const hidden = readFileSync("src/components/views/layout/HiddenColumnsMenu.tsx", "utf8");

describe("the column menu stays open while it is used", () => {
  it("a scroll inside the panel doesn't close it, and a resize only closes when the width changes (the phone keyboard)", () => {
    expect(menu).toMatch(/panel\.current\.contains\(e\.target\)\) return/);
    expect(menu).toMatch(/window\.innerWidth !== width\) setOpen\(false\)/);
    expect(menu).not.toMatch(/addEventListener\("resize", onMove\)/);
  });
});

describe("accessibility", () => {
  it("only the items are role=menu: the note and the error sit outside it; the panel itself has no menu role", () => {
    expect(menu).toMatch(/<div role="menu" aria-label=\{aria\} className="cm-items">/);
    const items = menu.slice(menu.indexOf('role="menu"'), menu.indexOf("</div>", menu.indexOf('role="menu"')));
    expect(items).not.toContain("cm-foot");
    expect(items).not.toContain('role="alert"');
    expect(menu).not.toMatch(/role=\{mode === "menu" \? "menu"/);
  });
  it("the hidden-columns error is outside the popover's menu", () => {
    expect(hidden.indexOf('role="alert"')).toBeGreaterThan(hidden.indexOf("</Popover>"));
  });
});

describe("Add a lead", () => {
  it("the success state says where the lead is, and links to the lead and to Leads", () => {
    const done = add.slice(add.indexOf("state.saved && state.leadId"), add.indexOf("return (\n    <form"));
    expect(done).toContain("ADD_ROW_AFTER");
    expect(done).toContain("ADD_ROW_OPEN_LEAD");
    expect(done).toContain("href={INTAKE_LIST_PATH}");
  });
});
