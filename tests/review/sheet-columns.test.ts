import { describe, it, expect } from "vitest";
import {
  COLUMN_IDS,
  MONEY_COLUMNS,
  NOT_TRACKED,
  SHEET_SECTION_COLUMNS,
  applyColumnPrefs,
  columnsFor,
  parseColumnPrefs,
  parseStoredDocument,
  prefsReducer,
  sheetColumn,
  type ColumnId,
} from "@/lib/review/sheet-columns";
import * as W from "@/lib/ui/words";

const ids = (section: "trademarks" | "contracts", opts: { canSeeMoney: boolean; hasNotes: boolean }) => columnsFor(section, opts).map((c) => c.id);
const headers = (section: "trademarks" | "contracts", opts: { canSeeMoney: boolean; hasNotes: boolean }) => columnsFor(section, opts).map((c) => c.header);

describe("section orders", () => {
  it("Trademarks reads as the spreadsheet does, Lectual's own columns after it", () => {
    expect(headers("trademarks", { canSeeMoney: true, hasNotes: true })).toEqual([
      "Trademark Owner", "Trademark Name", "Serial No.", "Status", "Source", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date",
      "Government Filing fee", "Government Filing Fee Due Date", "Office Action Due Date", "Next step", "Waiting on", "Last contact",
    ]);
  });
  it("Contracts reads as the spreadsheet does", () => {
    expect(headers("contracts", { canSeeMoney: true, hasNotes: true })).toEqual([
      "Client Name", "Practice Area", "Contract Type", "Status", "Next step", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Waiting on", "Last contact",
    ]);
  });
  it("SHEET_SECTION_COLUMNS holds exactly the ids of the spec", () => {
    expect([...SHEET_SECTION_COLUMNS.trademarks]).toEqual(["client", "mark", "serial", "status", "source", "notes", "owner", "start", "legalFee", "legalFeeDue", "govFee", "govFeeDue", "oaDue", "next", "waiting", "contact"]);
    expect([...SHEET_SECTION_COLUMNS.contracts]).toEqual(["client", "practiceArea", "mark", "status", "next", "notes", "owner", "start", "legalFee", "legalFeeDue", "waiting", "contact"]);
    for (const section of ["trademarks", "contracts"] as const) for (const id of SHEET_SECTION_COLUMNS[section]) expect(COLUMN_IDS).toContain(id);
  });
  it("every header word and title is a words.ts export (nothing typed inline)", () => {
    const wordValues = new Set(Object.values(W).filter((v): v is string => typeof v === "string"));
    for (const section of ["trademarks", "contracts"] as const) {
      for (const c of columnsFor(section, { canSeeMoney: true, hasNotes: true })) {
        expect(wordValues.has(c.header), c.header).toBe(true);
        if (c.title) expect(wordValues.has(c.title), c.title).toBe(true);
      }
    }
  });
  it("the header words differ per section for client and mark; Owner, Next step, Start Date and Contract Type carry a title", () => {
    expect(sheetColumn("client", "trademarks").header).toBe("Trademark Owner");
    expect(sheetColumn("client", "contracts").header).toBe("Client Name");
    expect(sheetColumn("mark", "trademarks").header).toBe("Trademark Name");
    expect(sheetColumn("mark", "contracts").header).toBe("Contract Type");
    expect(sheetColumn("owner", "trademarks").title).toBe("Assigned To in your spreadsheet: the next step's person, else the record's");
    expect(sheetColumn("next", "contracts").title).toBe("Task in your spreadsheet");
    expect(sheetColumn("start", "trademarks").title).toContain("The day it was opened in Lectual.");
    expect(sheetColumn("mark", "contracts").title).toBe("The matter's title in Lectual.");
    expect(sheetColumn("mark", "trademarks").title).toBeUndefined();
  });
  it("only the four typed columns are editable; only client is pinned", () => {
    const all = columnsFor("trademarks", { canSeeMoney: true, hasNotes: true });
    expect(all.filter((c) => c.editable).map((c) => c.id)).toEqual(["status", "source", "owner", "next"].sort((a, b) => all.findIndex((c) => c.id === a) - all.findIndex((c) => c.id === b)));
    expect(all.filter((c) => c.pinned).map((c) => c.id)).toEqual(["client"]);
  });
});

describe("columnsFor removes money", () => {
  it("drops the four fee columns for a viewer who may not see money, in both sections", () => {
    for (const section of ["trademarks", "contracts"] as const) {
      const shown = ids(section, { canSeeMoney: false, hasNotes: true });
      for (const m of MONEY_COLUMNS) expect(shown).not.toContain(m);
      expect(shown).toContain("start");
    }
    expect(MONEY_COLUMNS).toEqual(["legalFee", "legalFeeDue", "govFee", "govFeeDue"]);
  });
  it("keeps them, in place, for the owner", () => {
    expect(ids("trademarks", { canSeeMoney: true, hasNotes: false })).toContain("govFeeDue");
    expect(ids("contracts", { canSeeMoney: true, hasNotes: false })).toContain("legalFeeDue");
  });
  it("notes is left out without the Notes cell and held in its slot with it (pure level)", () => {
    expect(ids("trademarks", { canSeeMoney: false, hasNotes: false })).not.toContain("notes");
    const t = ids("trademarks", { canSeeMoney: false, hasNotes: true });
    expect(t[t.indexOf("source") + 1]).toBe("notes");
    const c = ids("contracts", { canSeeMoney: false, hasNotes: true });
    expect(c[c.indexOf("next") + 1]).toBe("notes");
  });
});

describe("NOT_TRACKED equals words.ts", () => {
  it("names the columns with no home, once per section", () => {
    expect(NOT_TRACKED.trademarks).toEqual([W.NT_PRIORITY, W.NT_OPINION_LETTER_DUE, W.NT_COMPLETION_DATE, W.NT_OFFICE_ACTION_FEE]);
    expect(NOT_TRACKED.contracts).toEqual([W.NT_PRIORITY, W.NT_COMPLETION_DATE]);
    expect(W.notTrackedNote(NOT_TRACKED.trademarks)).toBe("Not tracked in Lectual yet: Priority, Opinion Letter Due Date, Completion Date, Office Action Fee.");
    expect(W.notTrackedNote(NOT_TRACKED.contracts)).toBe("Not tracked in Lectual yet: Priority, Completion Date.");
  });
  it("no fee column is ever named as 'not tracked' (that would tell a non-owner they exist)", () => {
    for (const names of Object.values(NOT_TRACKED)) for (const n of names) expect(n).not.toMatch(/legal fee|filing fee/i);
  });
});

describe("client pinned", () => {
  it("is first in every default order and has no way to be hidden or moved", () => {
    const allowed = ids("trademarks", { canSeeMoney: true, hasNotes: false });
    expect(allowed[0]).toBe("client");
    const base = { order: allowed, hidden: [] as ColumnId[] };
    expect(prefsReducer(base, { type: "toggle", id: "client" }, allowed).hidden).toEqual([]);
    expect(prefsReducer(base, { type: "move", id: "client", dir: 1 }, allowed).order).toEqual(allowed);
    expect(prefsReducer(base, { type: "move", id: "mark", dir: -1 }, allowed).order).toEqual(allowed);
  });
});

describe("parseColumnPrefs", () => {
  const allowed = ids("trademarks", { canSeeMoney: false, hasNotes: false });
  it("a stored money id never shows for a non-owner", () => {
    const p = parseColumnPrefs({ order: ["client", "legalFee", "mark", "govFeeDue"], hidden: ["legalFee"] }, allowed);
    expect(p.order).not.toContain("legalFee");
    expect(p.order).not.toContain("govFeeDue");
    expect(p.hidden).toEqual([]);
  });
  it("drops unknown ids and duplicates, and never hides client", () => {
    const p = parseColumnPrefs({ order: ["mark", "nope", "mark", 7, "client"], hidden: ["client", "mark", "mark", "zzz"] }, allowed);
    expect(p.order.filter((x) => x === "mark")).toHaveLength(1);
    expect(p.order[0]).toBe("client");
    expect(p.hidden).toEqual(["mark"]);
    expect(new Set(p.order).size).toBe(p.order.length);
    expect(p.order.sort()).toEqual([...allowed].sort());
  });
  it("cuts an over-long list instead of trusting it", () => {
    const huge = Array.from({ length: 5000 }, () => "mark");
    const p = parseColumnPrefs({ order: huge, hidden: huge }, allowed);
    expect(p.order).toHaveLength(allowed.length);
    expect(p.hidden).toEqual(["mark"]);
  });
  it("appends allowed ids missing from the stored order at their default position", () => {
    const p = parseColumnPrefs({ order: ["client", "status", "next"], hidden: [] }, allowed);
    // serial follows mark's default place: after client (its default predecessor `mark` is missing too, so after `client`).
    expect(p.order.indexOf("mark")).toBe(1);
    expect(p.order.indexOf("serial")).toBe(2);
    expect(p.order.indexOf("status")).toBeGreaterThan(p.order.indexOf("serial"));
    expect(p.order.indexOf("source")).toBe(p.order.indexOf("status") + 1);
    expect(p.order).toHaveLength(allowed.length);
  });
  it("malformed values give the default order", () => {
    for (const bad of [null, undefined, 5, "x", [], { order: "x", hidden: 3 }]) {
      expect(parseColumnPrefs(bad, allowed)).toEqual({ order: [...allowed], hidden: [] });
    }
  });
  it("parseStoredDocument: malformed JSON, a non-object and another version read as nothing stored", () => {
    expect(parseStoredDocument("{not json")).toBeNull();
    expect(parseStoredDocument("[]")).toBeNull();
    expect(parseStoredDocument("null")).toBeNull();
    expect(parseStoredDocument(JSON.stringify({ v: 2, trademarks: {} }))).toBeNull();
    expect(parseStoredDocument(null)).toBeNull();
    expect(parseStoredDocument(JSON.stringify({ v: 1, trademarks: { order: ["client"] } }))).toEqual({ trademarks: { order: ["client"] }, contracts: undefined });
  });
});

describe("applyColumnPrefs", () => {
  const allowed = columnsFor("trademarks", { canSeeMoney: false, hasNotes: false });
  it("no prefs = the server's list, untouched", () => {
    expect(applyColumnPrefs(allowed, null).map((c) => c.id)).toEqual(allowed.map((c) => c.id));
  });
  it("hides and reorders, and can only ever draw allowed columns", () => {
    const rest = allowed.map((c) => c.id).filter((id) => !["client", "status", "mark"].includes(id));
    const drawn = applyColumnPrefs(allowed, { order: ["client", "status", "mark", "legalFee", ...rest], hidden: ["serial", "legalFee"] }).map((c) => c.id);
    expect(drawn.slice(0, 3)).toEqual(["client", "status", "mark"]);
    expect(drawn).not.toContain("serial");
    expect(drawn).not.toContain("legalFee");
  });
  it("a hidden client is ignored", () => {
    expect(applyColumnPrefs(allowed, { order: [], hidden: ["client"] })[0].id).toBe("client");
  });
});

describe("prefsReducer", () => {
  const allowed = ids("contracts", { canSeeMoney: false, hasNotes: false });
  it("hides, shows, moves and resets", () => {
    let p = parseColumnPrefs(null, allowed);
    p = prefsReducer(p, { type: "toggle", id: "owner" }, allowed);
    expect(p.hidden).toEqual(["owner"]);
    p = prefsReducer(p, { type: "toggle", id: "owner" }, allowed);
    expect(p.hidden).toEqual([]);
    p = prefsReducer(p, { type: "move", id: "status", dir: -1 }, allowed);
    expect(p.order.slice(0, 4)).toEqual(["client", "practiceArea", "status", "mark"]);
    p = prefsReducer(p, { type: "move", id: "status", dir: 1 }, allowed);
    expect(p.order.slice(0, 4)).toEqual(["client", "practiceArea", "mark", "status"]);
    p = prefsReducer(p, { type: "toggle", id: "mark" }, allowed);
    p = prefsReducer(p, { type: "reset" }, allowed);
    expect(p).toEqual({ order: allowed, hidden: [] });
  });
  it("cannot move past either end, or touch an id that is not allowed", () => {
    const base = parseColumnPrefs(null, allowed);
    expect(prefsReducer(base, { type: "move", id: "contact", dir: 1 }, allowed).order).toEqual(allowed);
    expect(prefsReducer(base, { type: "toggle", id: "legalFee" }, allowed)).toEqual(base);
  });
});

/* ── Sprint 3: labelKey, builtinHeaders, notTrackedFor ── */

import { builtinHeaders as builtinHeadersS3, labelKey as labelKeyS3, notTrackedFor as notTrackedForS3 } from "@/lib/review/sheet-columns";
import { COL_LEGAL_FEE, COL_NOTES, COL_STATUS, COL_TRADEMARK_NAME } from "@/lib/ui/words";

describe("Sprint 3: the label rules the clash checks and CO3 share", () => {
  it("labelKey: whitespace runs (tab, NBSP) collapse, ends go, lower case", () => {
    expect(labelKeyS3(" Status ")).toBe("status");
    expect(labelKeyS3(`Trademark${String.fromCodePoint(0xa0)}\tName`)).toBe("trademark name");
    expect(labelKeyS3("PRIORITY")).toBe(labelKeyS3("priority"));
  });
  it("builtinHeaders: every header of the section, money and Notes included", () => {
    const W3 = { notes: COL_NOTES, legal: COL_LEGAL_FEE, status: COL_STATUS, mark: COL_TRADEMARK_NAME };
    for (const h of Object.values(W3)) expect(builtinHeadersS3("trademarks")).toContain(h);
    expect(builtinHeadersS3("trademarks")).toHaveLength(16);
    expect(builtinHeadersS3("contracts")).toHaveLength(12);
    expect(builtinHeadersS3("contracts")).toContain("Client Name");
    expect(builtinHeadersS3("trademarks")).not.toContain("Client Name");
  });
  it("notTrackedFor: drops a live field's name in its sections only; nothing dropped unless ok", () => {
    expect(notTrackedForS3("trademarks", { status: "ok", fields: [{ label: "priority", section: "trademarks" }] })).toEqual(["Opinion Letter Due Date", "Completion Date", "Office Action Fee"]);
    expect(notTrackedForS3("contracts", { status: "ok", fields: [{ label: "priority", section: "trademarks" }] })).toEqual(["Priority", "Completion Date"]);
    expect(notTrackedForS3("contracts", { status: "ok", fields: [{ label: "Completion Date", section: "both" }] })).toEqual(["Priority"]);
    expect(notTrackedForS3("trademarks", { status: "not-set-up" })).toHaveLength(4);
    expect(notTrackedForS3("trademarks", null)).toHaveLength(4);
  });
});
