import { describe, expect, it } from "vitest";
import { sheetKeyFor } from "../../src/lib/intake/sheet-import";
import { SHEET_MESSAGES, readSheetText } from "../../src/lib/intake/sheet-read";
import { splitNoteEntries } from "../../src/lib/matters/tracker-import";
import { NOW, S, STAGES, fixtureBytes, fixtureText } from "./helpers";

/**
 * The CSV fixture (tests/fixtures/intake/trademarks-sheet.csv) carries the real export's quirks:
 * a byte-order mark and CRLF endings, the owner column headed `0`, two blank-header columns, the
 * trailing space in `Serial No. `, a Description that is quoted, spans two lines and holds a doubled
 * quote, a future-dated typo in Notes, a Status of each code 0 to 6, a code 7 client, an unmapped
 * status, a repeated row, a status with no code, and a blank trailing row.
 */
const stages = STAGES.map((s) => ({ id: s.id, name: s.name }));
const read = () => {
  const r = readSheetText(fixtureText(), stages, NOW);
  if (!r.ok) throw new Error(r.error);
  return r.read;
};

describe("the fixture itself", () => {
  it("has the quirks it claims", () => {
    const bytes = fixtureBytes();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    expect(text).toContain("\r\n");
    expect(text.split("\r\n")[0]).toBe("﻿0,Trademark Owner,Trademark Name,Serial No. ,Status,Description,Source,Notes,Priority,,Assigned To,,Opinion Letter Due Date");
    expect(text).toContain('"DO sent legal strategy session link to PNC on 9.11.26.\r\nPNC scheduled consult for 9.14.26."'.replace("\r\n", "\n"));
    expect(text).toContain('""kickoff""');
  });
});

describe("readSheetText on the fixture", () => {
  it("counts rows exactly", () => {
    const r = read();
    expect(r.rowsRead).toBe(12);
    expect(r.blankRows).toBe(1);
    expect(r.intakeRows).toBe(7);
    expect(r.refused).toEqual([
      { row: 9, reason: "client, not intake — use import-tracker", statusText: "7. Signed LOE / Deposit Received" },
      { row: 10, reason: expect.stringContaining("Petting Zoo Review"), statusText: "2. Petting Zoo Review" },
      { row: 12, reason: "no stage code in status", statusText: "Waiting on paperwork" },
    ]);
  });

  it("yields each intake lead with its key, stage and dated evidence", () => {
    const entries = read().entries.filter((e) => e.reading.kind === "ok");
    const summary = entries.map((e) => ({
      owner: e.ownerName,
      row: e.row,
      key: e.exactKey,
      stage: e.reading.kind === "ok" ? e.reading.stageId : null,
      date: e.reading.kind === "ok" ? e.reading.date : null,
    }));
    expect(summary).toEqual([
      { owner: "Amara Nwosu", row: 2, key: sheetKeyFor({ ownerName: "Amara Nwosu", markText: null, stageCode: "1" }), stage: S.pnc, date: "2026-09-14T00:00:00.000Z" },
      { owner: "Kwame Boateng", row: 11, key: sheetKeyFor({ ownerName: "Kwame Boateng", markText: null, stageCode: "0" }), stage: S.followUp, date: "2026-09-05T00:00:00.000Z" },
      { owner: "Priya Raman", row: 4, key: sheetKeyFor({ ownerName: "Priya Raman", markText: "Saffron Lane", stageCode: "2" }), stage: S.prelim, date: "2026-08-28T00:00:00.000Z" },
      { owner: "Marguerite (Margo) Delacroix", row: 5, key: sheetKeyFor({ ownerName: "Marguerite (Margo) Delacroix", markText: "Château Bellerive", stageCode: "3" }), stage: S.consult, date: "2026-09-03T00:00:00.000Z" },
      { owner: "Desmond Okafor", row: 6, key: sheetKeyFor({ ownerName: "Desmond Okafor", markText: "Iron Fig", stageCode: "4" }), stage: S.post, date: "2026-08-22T00:00:00.000Z" },
      { owner: "Lena Fitzgerald", row: 7, key: sheetKeyFor({ ownerName: "Lena Fitzgerald", markText: null, stageCode: "5" }), stage: S.undecided, date: "2026-07-15T00:00:00.000Z" },
      { owner: "Hollis Vance", row: 8, key: sheetKeyFor({ ownerName: "Hollis Vance", markText: "Nine Lantern", stageCode: "6" }), stage: S.loe, date: "2026-09-08T00:00:00.000Z" },
    ]);
  });

  it("reads the quoted, multi-line, doubled-quote Description whole", () => {
    // Amara's log runs over two lines; both dates are read, and the newest wins.
    const amara = read().entries.find((e) => e.ownerName === "Amara Nwosu")!;
    expect(amara.reading.kind === "ok" && amara.reading.date).toBe("2026-09-14T00:00:00.000Z");
  });

  it("merges the repeated Kwame Boateng row and keeps the newer note's date", () => {
    const kwame = read().entries.filter((e) => e.ownerName === "Kwame Boateng");
    expect(kwame).toHaveLength(1);
    expect(kwame[0].reading.kind === "ok" && kwame[0].reading.date).toBe("2026-09-05T00:00:00.000Z");
  });

  it("does not give a future-dated typo as the evidence date", () => {
    const desmond = read().entries.find((e) => e.ownerName === "Desmond Okafor")!;
    expect(desmond.reading.kind === "ok" && desmond.reading.date).toBe("2026-08-22T00:00:00.000Z");
    const suspect = splitNoteEntries("TM follow up 2.3.36", NOW);
    expect(suspect[0].dateSuspect).toBe(true);
    for (const e of read().entries) {
      if (e.reading.kind === "ok" && e.reading.date) expect(Date.parse(e.reading.date)).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("keeps the refused rows that name a person: a client and an unmapped status, with their match keys", () => {
    const entries = read().entries;
    const client = entries.find((e) => e.ownerName === "Ines Marchetti")!;
    expect(client.reading).toEqual({ kind: "client", wording: "7. Signed LOE / Deposit Received" });
    expect(client.exactKey).toBeNull();
    expect(client.anyCodeKeys).toContain(sheetKeyFor({ ownerName: "Ines Marchetti", markText: "Verdi Loop", stageCode: "3" }));
    expect(client.anyCodeKeys).toHaveLength(7);
    expect(entries.find((e) => e.ownerName === "Ola Adeyemi")!.reading).toEqual({ kind: "unmapped", wording: "2. Petting Zoo Review" });
    expect(entries.find((e) => e.ownerName === "Beatrix Lund")!.reading).toEqual({ kind: "unmapped", wording: "Waiting on paperwork" });
  });

  it("gives every intake row a key under each intake code so a moved row still finds its lead", () => {
    const priya = read().entries.find((e) => e.ownerName === "Priya Raman")!;
    expect(priya.anyCodeKeys).toContain(priya.exactKey);
    expect(priya.anyCodeKeys).toContain(sheetKeyFor({ ownerName: "Priya Raman", markText: "Saffron Lane", stageCode: "5" }));
  });
});

describe("sheetKeyFor matches lectual's golden values", () => {
  // Produced by running lectual's own sheetKeyFor (src/lib/intake/sheet-import.ts @ 0c65dca).
  it.each([
    [{ ownerName: "Amara Nwosu", markText: null, stageCode: "1" }, "ts54ji"],
    [{ ownerName: "  Amara   Nwosu ", markText: "IRON FIG", stageCode: "1" }, "1ts2z56"],
    [{ ownerName: "amara nwosu", markText: "iron fig", stageCode: "1" }, "1ts2z56"],
    [{ ownerName: "Amara Nwosu", markText: null, stageCode: "4" }, "v6350d"],
    [{ ownerName: "Marguerite (Margo) Delacroix", markText: "Château Bellerive", stageCode: "3" }, "vroy11"],
    [{ ownerName: "Okonjo", markText: "Sankofa Studio", stageCode: "0" }, "osiyt2"],
  ])("%j", (input, expected) => {
    expect(sheetKeyFor(input)).toBe(expected);
  });
});

describe("readSheetText refuses a file before reading anything", () => {
  it("returns the file sentences", () => {
    expect(readSheetText("", stages, NOW)).toEqual({ ok: false, error: SHEET_MESSAGES.empty });
    expect(readSheetText("0,Mark\nA,B\n", stages, NOW)).toEqual({ ok: false, error: SHEET_MESSAGES.noStatus });
  });
});
