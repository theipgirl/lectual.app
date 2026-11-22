import { beforeEach, describe, expect, it, vi } from "vitest";
import { cellOf, labelsOf, OWNER_PERMS, renderOwnerSheet, renderReadOnly, rowOf, tableHeaders, text } from "./columns-fixtures";
import * as W from "@/lib/ui/words";
import { row } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

const TRADEMARKS = ["Trademark Owner", "Trademark Name", "Serial No.", "Status", "Source", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date", "Office Action Due Date", "Next step", "Waiting on", "Last contact"];
const CONTRACTS = ["Client Name", "Practice Area", "Contract Type", "Status", "Next step", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Waiting on", "Last contact"];
const NON_OWNER_ROLES = ["admin", "attorney", "paralegal", "viewer"];
const MONEY_TEXT = /Legal Fee|Government Filing|Fee Due Date|\$1,250\.00|\$700\.00|\$4,750|From the accepted proposal|From the spreadsheet import/;

beforeEach(() => vi.resetModules());

describe("header order, both tables", () => {
  it("the read-only List reads in the spreadsheet's order for the owner (Notes is not drawn: no Notes cell exists)", async () => {
    const [tm, ct] = tableHeaders(await renderReadOnly({ canSeeMoney: true }));
    expect(tm).toEqual(TRADEMARKS);
    expect(ct).toEqual(CONTRACTS);
  });
  it("the owner's editable Sheet reads in the same order", async () => {
    const [tm, ct] = tableHeaders(await renderOwnerSheet({ canSeeMoney: true }));
    expect(tm).toEqual(TRADEMARKS);
    expect(ct).toEqual(CONTRACTS);
  });
  it("no stand-in Notes header or cell is drawn", async () => {
    for (const html of [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })]) {
      expect(html).not.toContain(">Notes<");
      expect(html).not.toContain('data-label="Notes"');
    }
  });
});

describe("single section note", () => {
  it("names the columns with no home once per section, with the exact words.ts text, as a quiet note", async () => {
    for (const html of [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })]) {
      const notes = [...html.matchAll(/<p class="lx-note rv-sheet-note" data-section-note="(\w+)">([\s\S]*?)<\/p>/g)];
      expect(notes.map((n) => n[1])).toEqual(["trademarks", "contracts"]);
      expect(notes[0][2]).toBe(W.notTrackedNote([W.NT_PRIORITY, W.NT_OPINION_LETTER_DUE, W.NT_COMPLETION_DATE, W.NT_OFFICE_ACTION_FEE]));
      expect(notes[1][2]).toBe("Not tracked in Lectual yet: Priority, Completion Date.");
      expect(html).not.toContain("lx-warn");
    }
  });
  it("none of those names is drawn as a column", async () => {
    for (const headers of [...tableHeaders(await renderReadOnly({ canSeeMoney: true })), ...tableHeaders(await renderOwnerSheet({ canSeeMoney: true }))]) {
      for (const n of [W.NT_PRIORITY, W.NT_OPINION_LETTER_DUE, W.NT_COMPLETION_DATE, W.NT_OFFICE_ACTION_FEE, "Description"]) expect(headers).not.toContain(n);
    }
  });
});

describe("no fee text for non-owners", () => {
  for (const role of NON_OWNER_ROLES) {
    it(`${role}: no fee header, cell, data-label or note mention in either table`, async () => {
      // `canSeeMoney` is what the page computes from the role (canSeeBilling): false for every role but owner.
      for (const html of [await renderReadOnly({ canSeeMoney: false }), await renderOwnerSheet({ canSeeMoney: false })]) {
        expect(html).not.toMatch(MONEY_TEXT);
        expect(html).not.toMatch(/data-label="(Legal|Government)/);
        const [tm, ct] = tableHeaders(html);
        expect(tm).toEqual(TRADEMARKS.filter((h) => !/Fee/i.test(h)));
        expect(ct).toEqual(CONTRACTS.filter((h) => !/Fee/i.test(h)));
      }
    });
  }
});

describe("serial, start, practice area and office action cells", () => {
  it("a matter shows its serial; a lead reads a dash for serial, practice area and office action", async () => {
    const html = await renderReadOnly({ canSeeMoney: true });
    const tm = rowOf(html, "Acme Studio");
    expect(text(cellOf(tm, "Serial No."))).toBe("99000001");
    expect(text(cellOf(tm, "Start Date"))).toBe("Mar 4");
    const lead = rowOf(html, "Jo Lee");
    expect(text(cellOf(lead, "Serial No."))).toBe("—");
    expect(text(cellOf(lead, "Office Action Due Date"))).toBe("—");
    expect(text(cellOf(lead, "Start Date"))).toBe("Sep 30");
    const bl = rowOf(html, "Birch Goods");
    expect(text(cellOf(bl, "Practice Area"))).toBe("Business law (BL)");
    expect(text(cellOf(bl, "Contract Type"))).toBe("Supply agreement");
  });
  it("the same cells read the same in the owner's Sheet", async () => {
    const html = await renderOwnerSheet({ canSeeMoney: true });
    expect(text(cellOf(rowOf(html, "Acme Studio"), "Serial No."))).toBe("99000001");
    expect(text(cellOf(rowOf(html, "Jo Lee"), "Serial No."))).toBe("—");
    expect(text(cellOf(rowOf(html, "Birch Goods"), "Practice Area"))).toBe("Business law (BL)");
  });
  it("overdue class: a past-due office action date carries the risk class and the unconfirmed words", async () => {
    for (const html of [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })]) {
      const cell = cellOf(rowOf(html, "Acme Studio"), "Office Action Due Date");
      expect(cell).toContain("rv-oa-overdue");
      expect(text(cell)).toBe(`Oct 30${W.COL_UNCONFIRMED_SUFFIX}`);
      expect(cellOf(rowOf(html, "Birch Goods"), "Office Action Due Date")).not.toContain("rv-oa-overdue");
    }
  });
  it("a matter whose deadlines read failed says Couldn't load (and the lead still reads a dash)", async () => {
    const failed = [row({ key: "m-x", client: "Failed Co", startDate: "2026-03-04", fees: undefined }), row({ key: "l-x", kind: "lead", id: "00000000-0000-4000-8000-0000000000d2", client: "Lead Co", startDate: "2026-03-04" })];
    const html = await renderReadOnly({ canSeeMoney: false, rows: failed as never });
    expect(text(cellOf(rowOf(html, "Failed Co"), "Office Action Due Date"))).toBe("Couldn't load");
    expect(text(cellOf(rowOf(html, "Lead Co"), "Office Action Due Date"))).toBe("—");
  });
  it("fee cells: a failed fee read says Couldn't load in each fee cell; never a dash or 0", async () => {
    const nofees = [row({ key: "m-y", client: "Nofee Co", startDate: "2026-03-04", officeActionDue: null })];
    for (const html of [await renderReadOnly({ canSeeMoney: true, rows: nofees as never }), await renderOwnerSheet({ canSeeMoney: true, rows: nofees as never })]) {
      for (const label of ["Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date"]) {
        expect(text(cellOf(rowOf(html, "Nofee Co"), label)), label).toBe("Couldn't load");
      }
    }
  });
});

describe("cell titles", () => {
  it("a fee shows where it came from on hover; a due date from the ledger says the spreadsheet import", async () => {
    for (const html of [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })]) {
      expect(cellOf(rowOf(html, "Acme Studio"), "Legal Fee")).toContain(`title="${W.FEE_FROM_PROPOSAL}"`);
      expect(cellOf(rowOf(html, "Acme Studio"), "Legal Fee Due Date")).toContain(`title="${W.FEE_FROM_SPREADSHEET}"`);
      expect(cellOf(rowOf(html, "Birch Goods"), "Legal Fee")).toContain(`title="${W.FEE_FROM_SPREADSHEET}"`);
      expect(text(cellOf(rowOf(html, "Birch Goods"), "Legal Fee"))).toBe("$4,750");
    }
  });
  it("headers carry the spec's titles for Owner, Next step, Start Date and Contract Type", async () => {
    const html = await renderReadOnly({ canSeeMoney: true });
    expect(html).toContain(`title="${W.COL_OWNER_TITLE.replace(/'/g, "&#x27;")}"`);
    expect(html).toContain(`title="${W.COL_NEXT_TITLE}"`);
    expect(html).toContain(`title="${W.COL_START_TITLE}"`);
    expect(html).toContain(`title="${W.COL_CONTRACT_TYPE_TITLE.replace(/'/g, "&#x27;")}"`);
    const owner = await renderOwnerSheet({ canSeeMoney: true });
    expect(owner).toContain(`title="${W.COL_START_TITLE}"`);
    expect(owner).toContain(`title="${W.COL_NEXT_TITLE}"`);
  });
});

describe("client link", () => {
  it("the first cell stays the ?open= link in both tables and is first whatever else is drawn", async () => {
    const ro = await renderReadOnly({ canSeeMoney: true });
    expect(rowOf(ro, "Acme Studio")).toMatch(/<td class="pri"[^>]*><a class="lx-rowlink" href="[^"]*open=matter%3A/);
    expect(rowOf(ro, "Jo Lee")).toMatch(/open=lead%3A/);
    const ed = await renderOwnerSheet({ canSeeMoney: true });
    const pri = /<td class="pri"[\s\S]*?<\/td>/.exec(rowOf(ed, "Acme Studio"))![0];
    expect(pri).toContain("sheet-link");
    expect(pri).toMatch(/href="[^"]*open=matter%3A/);
    expect(tableHeaders(ed).every((h) => h[0] === "Trademark Owner" || h[0] === "Client Name")).toBe(true);
  });
});

describe("data-label equals header", () => {
  it("every cell after the first carries its header word as data-label, in both tables, owner and not", async () => {
    for (const canSeeMoney of [true, false]) {
      for (const html of [await renderReadOnly({ canSeeMoney }), await renderOwnerSheet({ canSeeMoney })]) {
        const headers = tableHeaders(html);
        const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) => t[0]);
        let checked = 0;
        tables.forEach((t, i) => {
          for (const tr of t.match(/<tr[^>]*data-row[^>]*>[\s\S]*?<\/tr>|<tr><td class="pri"[\s\S]*?<\/tr>/g) ?? []) {
            expect(labelsOf(tr)).toEqual(headers[i].slice(1));
            checked++;
          }
        });
        expect(checked).toBe(3);
      }
    }
  });
  it("hard-coded colours are not used in the changed stylesheets' new rules (tokens only)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/components/review/review.css", "utf8");
    const block = css.slice(css.indexOf("/* Sheet column widths"), css.indexOf("/* The collapsed USPTO"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe("new cells have no editor", () => {
  it("the owner Sheet's editors are only the four typed columns; the new cells hold no button or edit hook", async () => {
    const html = await renderOwnerSheet({ canSeeMoney: true });
    expect(html).not.toMatch(/data-rse-cell="[^"]*\|(serial|start|practiceArea|oaDue|legalFee|legalFeeDue|govFee|govFeeDue|notes)"/);
    for (const label of ["Serial No.", "Start Date", "Practice Area", "Office Action Due Date", "Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date"]) {
      for (const client of ["Acme Studio", "Birch Goods", "Jo Lee"]) {
        const cell = cellOf(rowOf(html, client), label);
        if (cell) {
          expect(cell, `${client} ${label}`).not.toContain("<button");
          expect(cell).toContain("rse-locked");
        }
      }
    }
    // the four editors are still there, on the row's own hooks
    for (const col of ["status", "next", "court", "source"]) expect(html).toContain(`data-rse-cell="m-tm|${col}"`);
  });
  it("a read-only role gets the same table with no editors at all", async () => {
    const html = await renderOwnerSheet({ canSeeMoney: false, perms: { writeMatter: false, writeLead: false, moveLead: false, matterStages: null, leadStages: null } });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-rse-cell");
    expect(OWNER_PERMS.writeMatter).toBe(true);
  });
});

describe("legend", () => {
  it("names the new read-only columns (and the fee columns only for the owner)", async () => {
    const withFees = await renderOwnerSheet({ canSeeMoney: true });
    for (const name of ["Serial No.", "Start Date", "Practice Area", "Office Action Due Date"]) expect(withFees).toContain(name);
    expect(withFees).toContain(W.SHEET_WORKED_OUT_FEES);
    const without = await renderOwnerSheet({ canSeeMoney: false });
    expect(without).toContain("Serial No., Start Date, Practice Area and Office Action Due Date");
    expect(without).not.toContain(W.SHEET_WORKED_OUT_FEES);
  });
});

