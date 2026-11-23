import { describe, expect, it, vi } from "vitest";
import { NOTES_PRESENT, columnsFor } from "@/lib/review/sheet-columns";
import { COL_COULDNT_LOAD, CUSTOM_FROM_LEAD, CUSTOM_FROM_MERGED, CUSTOM_NO_LONGER_ON_TEAM } from "@/lib/ui/words";
import { CF, cellOf, customFields, customFixture, renderOwnerSheet, renderReadOnly, rowOf, tableHeaders, text } from "../review/columns-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));

const TM_CUSTOM = ["Priority", "Review cycle", "Quoted fee", "Brand note", "Reviewer"];
const CT_CUSTOM = ["Signed on", "Review cycle"];
const builtin = (section: "trademarks" | "contracts", canSeeMoney: boolean) => columnsFor(section, { canSeeMoney, hasNotes: NOTES_PRESENT }).map((c) => c.header);

const tables = [
  ["the read-only List", (canSeeMoney: boolean, extra = {}) => renderReadOnly({ canSeeMoney, custom: customFixture, ...extra })],
  ["the owner's editable Sheet", (canSeeMoney: boolean, extra = {}) => renderOwnerSheet({ canSeeMoney, custom: customFixture, ...extra })],
] as const;

/** A `<td>` by its data-label, with its attributes. */
const td = (rowHtml: string, label: string) => cellOf(rowHtml, label);

describe.each(tables)("custom columns in %s", (_name, render) => {
  it("each section draws its own fields after the spreadsheet columns, in position order; a both field in both", async () => {
    for (const money of [true, false]) {
      const [tm, ct] = tableHeaders(await render(money));
      expect(tm).toEqual([...builtin("trademarks", money), ...TM_CUSTOM]);
      expect(ct).toEqual([...builtin("contracts", money), ...CT_CUSTOM]);
    }
  });

  it("formats per kind, with the lead and merged fallbacks titled quietly and a matter's own value untitled", async () => {
    const html = await render(true);
    const tmRow = rowOf(html, "Acme Studio");
    expect(td(tmRow, "Priority")).toContain(">High<");
    expect(td(tmRow, "Priority")).toContain(`title="${CUSTOM_FROM_LEAD}"`);
    expect(td(tmRow, "Review cycle")).toContain(">Quarterly<");
    expect(td(tmRow, "Review cycle")).not.toContain("title=");
    expect(td(tmRow, "Quoted fee")).toContain(">$1,250.00<");
    expect(td(tmRow, "Reviewer")).toContain(">Sam Park<");
    const blRow = rowOf(html, "Birch Goods");
    expect(td(blRow, "Signed on")).toContain(">Oct 15<");
    expect(td(blRow, "Review cycle")).toContain(">Yearly<");
    const lead = rowOf(html, "Jo Lee");
    expect(td(lead, "Priority")).toContain(">Urgent (old)<");
    expect(td(lead, "Brand note")).toContain(">Met at the expo<");
    expect(td(lead, "Brand note")).toContain(`title="${CUSTOM_FROM_MERGED}"`);
    expect(td(lead, "Reviewer")).toContain(CUSTOM_NO_LONGER_ON_TEAM);
    // nothing recorded is a quiet dash
    expect(td(lead, "Quoted fee")).toMatch(/<span class="[^"]*">—<\/span>/);
  });

  it("every custom td carries data-label = its header, no inline colour, existing classes only", async () => {
    const html = await render(true);
    for (const client of ["Acme Studio", "Birch Goods", "Jo Lee"]) {
      const r = rowOf(html, client);
      const labels = client === "Birch Goods" ? CT_CUSTOM : TM_CUSTOM;
      for (const l of labels) {
        const cell = td(r, l);
        expect(cell, `${client} ${l}`).not.toBe("");
        expect(cell).not.toMatch(/style="[^"]*colou?r/);
        for (const cls of [...cell.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(" "))) expect(["lx-note", "rse-locked", "rse-dash", "rv-fact-failed"]).toContain(cls);
      }
    }
  });

  it("with the member directory unreadable a person cell says Couldn't load and carries rv-fact-failed, never the no-longer sentence", async () => {
    const html = await render(true, { customMembers: null });
    for (const client of ["Acme Studio", "Jo Lee"]) {
      const cell = td(rowOf(html, client), "Reviewer");
      expect(text(cell)).toBe(COL_COULDNT_LOAD);
      expect(cell).toContain("rv-fact-failed");
      expect(cell).not.toContain(CUSTOM_NO_LONGER_ON_TEAM);
    }
  });

  it("the client link is still the first cell; custom cells hold no input, button or link", async () => {
    const html = await render(true);
    const r = rowOf(html, "Acme Studio");
    for (const l of TM_CUSTOM) expect(td(r, l)).not.toMatch(/<(input|button|a|select|form)\b/);
    expect(tableHeaders(html)[0][0]).toBe("Trademark Owner");
  });
});

describe("the field list the registry was given decides the columns", () => {
  it("no fields: exactly the Sprint 1 columns", async () => {
    const [tm, ct] = tableHeaders(await renderReadOnly({ canSeeMoney: false, custom: { status: "ok", fields: [], values: [], mergedInto: {}, leadOfMatter: {} } }));
    expect(tm).toEqual(builtin("trademarks", false));
    expect(ct).toEqual(builtin("contracts", false));
  });

  it("the chooser can hide and move a custom column in both tables (P1, P2)", async () => {
    const id = `cf:${CF.priority}` as const;
    const allowed = columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields }).map((c) => c.id);
    const moved = [...allowed];
    moved.splice(moved.indexOf(id), 1);
    moved.splice(1, 0, id);
    const prefs = { trademarks: { order: moved, hidden: [`cf:${CF.note}`] } };
    for (const html of [await renderReadOnly({ canSeeMoney: false, custom: customFixture, initialPrefs: prefs }), await renderOwnerSheet({ canSeeMoney: false, custom: customFixture, initialPrefs: prefs })]) {
      const [tm] = tableHeaders(html);
      expect(tm[1]).toBe("Priority");
      expect(tm).not.toContain("Brand note");
      expect(tm.indexOf("Priority")).toBeLessThan(tm.indexOf("Trademark Name"));
    }
  });
});

/* ── Sprint 3: what Settings -> Columns changes shows on the List (F3, F8 R1) ── */

describe("F3 / F8: the List follows the one column order", () => {
  const withFields = (fields: typeof customFields) => ({ ...customFixture, fields }) as typeof customFixture;
  it("F3: a new Trademarks column (last position) comes after the spreadsheet columns, last", async () => {
    const added = { id: "00000000-0000-4000-8000-00000000c0aa", section: "trademarks" as const, label: "Urgency", kind: "choice" as const, position: 99, options: ["High", "Low"] };
    const [tm] = tableHeaders(await renderReadOnly({ canSeeMoney: false, custom: withFields([...customFields, added]) }));
    expect(tm.slice(-6)).toEqual([...TM_CUSTOM, "Urgency"]);
    expect(tm.slice(0, builtin("trademarks", false).length)).toEqual(builtin("trademarks", false));
  });
  it("R1: after a Move puts Trademarks 'Quoted fee' (position 4) above Both 'Review cycle' (position 3), it is drawn before it", async () => {
    const moved = customFields.map((f) => (f.id === CF.quote ? { ...f, position: 3 } : f.id === CF.review ? { ...f, position: 4 } : f));
    const [tm, ct] = tableHeaders(await renderReadOnly({ canSeeMoney: false, custom: withFields(moved) }));
    expect(tm.slice(-5)).toEqual(["Priority", "Quoted fee", "Review cycle", "Brand note", "Reviewer"]);
    expect(ct.slice(-2)).toEqual(["Signed on", "Review cycle"]);
  });
});
