import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "../../src/lib/intake/sheet-csv";
import { MAX_SHEET_BYTES, SHEET_MESSAGES, checkSheetFile, parseSheetRecords } from "../../src/lib/intake/sheet-read";

describe("parseCsv", () => {
  it("reads plain cells, LF and CRLF, and ignores a final line break", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps commas, doubled quotes and line breaks inside a quoted cell", () => {
    const grid = parseCsv('name,note\n"Doe, Jane","said ""hi""\nthen left"\n');
    expect(grid).toEqual([["name", "note"], ["Doe, Jane", 'said "hi"\nthen left']]);
  });

  it("drops a leading byte-order mark", () => {
    expect(parseCsv("﻿0,Status\nAmara,1")[0]).toEqual(["0", "Status"]);
  });

  it("keeps ragged rows as they are, and empty cells as empty strings", () => {
    expect(parseCsv("a,b,c\n1\n1,,3,4\n")).toEqual([["a", "b", "c"], ["1"], ["1", "", "3", "4"]]);
  });

  it("keeps a blank line as a row with one empty cell, and a row of commas as empty cells", () => {
    expect(parseCsv("a,b\n\n,\n")).toEqual([["a", "b"], [""], ["", ""]]);
  });

  it("treats a quote in the middle of an unquoted cell as text", () => {
    expect(parseCsv('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("refuses an unterminated quote instead of swallowing the rest of the file", () => {
    expect(() => parseCsv('a,b\n1,"never closed\n2,3\n')).toThrow(CsvError);
  });
});

describe("checkSheetFile", () => {
  it("accepts a CSV of a usable size in any letter case", () => {
    expect(checkSheetFile("sheet.csv", 10)).toEqual({ ok: true });
    expect(checkSheetFile("Sheet.CSV", MAX_SHEET_BYTES)).toEqual({ ok: true });
  });

  it("gives each refusal its own sentence", () => {
    const sentences = [
      checkSheetFile("sheet.xlsx", 10),
      checkSheetFile("sheet.xls", 10),
      checkSheetFile("sheet.pdf", 10),
      checkSheetFile("sheet", 10),
      checkSheetFile("sheet.csv", 0),
      checkSheetFile("sheet.csv", MAX_SHEET_BYTES + 1),
      checkSheetFile("", 10),
    ].map((r) => (r.ok ? "ok" : r.error));
    expect(sentences[0]).toBe(SHEET_MESSAGES.excel);
    expect(sentences[1]).toBe(SHEET_MESSAGES.excel);
    expect(sentences[2]).toBe(SHEET_MESSAGES.notCsv);
    expect(sentences[3]).toBe(SHEET_MESSAGES.notCsv);
    expect(sentences[4]).toBe(SHEET_MESSAGES.empty);
    expect(sentences[5]).toBe(SHEET_MESSAGES.tooBig);
    expect(sentences[6]).toBe(SHEET_MESSAGES.noFile);
    expect(new Set([SHEET_MESSAGES.excel, SHEET_MESSAGES.notCsv, SHEET_MESSAGES.empty, SHEET_MESSAGES.tooBig, SHEET_MESSAGES.noFile]).size).toBe(5);
    expect(SHEET_MESSAGES.excel).toMatch(/CSV/);
    expect(SHEET_MESSAGES.tooBig).toMatch(/5 MB/);
  });
});

describe("parseSheetRecords: refusals about the file's contents", () => {
  it("an empty or whitespace-only file", () => {
    expect(parseSheetRecords("")).toEqual({ ok: false, error: SHEET_MESSAGES.empty });
    expect(parseSheetRecords("  \n \r\n")).toEqual({ ok: false, error: SHEET_MESSAGES.empty });
  });
  it("an unclosed quote", () => {
    expect(parseSheetRecords('0,Status\n"x,1')).toEqual({ ok: false, error: SHEET_MESSAGES.unterminated });
  });
  it("a CSV with no Status column", () => {
    expect(parseSheetRecords("0,Mark\nAmara,Iron Fig\n")).toEqual({ ok: false, error: SHEET_MESSAGES.noStatus });
  });
  it("a Status column with nothing under it", () => {
    expect(parseSheetRecords("0,Status\n,\n,\n")).toEqual({ ok: false, error: SHEET_MESSAGES.noRows });
    expect(parseSheetRecords("0,Status\n")).toEqual({ ok: false, error: SHEET_MESSAGES.noRows });
  });
  it("forgives spaces around the word Status in the header", () => {
    const r = parseSheetRecords("0, Status \nAmara,1. Potential New Client\n");
    expect(r.ok).toBe(true);
  });
});
