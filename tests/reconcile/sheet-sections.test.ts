import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/lib/intake/sheet-csv";
import { sheetKeyFor } from "../../src/lib/intake/sheet-import";
import { SHEET_MESSAGES, checkSheetFile, parseSheetRecords, readSheetRecords, readSheetText } from "../../src/lib/intake/sheet-read";
import { recordsFromSheetRows } from "../../src/lib/intake/sheet-records";
import { classifyHeader, contactsFrom, describeSections, findSections, summarizeSections } from "../../src/lib/intake/sheet-sections";
import { matchSheetToLeads } from "../../src/lib/reconcile/sheet-match";
import { NOW, S, STAGES } from "./helpers";

/**
 * The whole workbook exported as ONE CSV: tabs stacked one after another, each with its own header row,
 * rows from 5 to 53 columns wide, and the intake tab three times (two layouts). Hand-built with invented
 * names in the same SHAPE as the real export. No real client row appears anywhere in this repository.
 */
const row = (cells: Array<string | number>, width: number): string =>
  Array.from({ length: width }, (_, i) => {
    const c = String(cells[i] ?? "");
    return /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  }).join(",");

const TASKS_HEADER = row(["Client Name", "Practice Area", "Task", "Priority", "Assigned To", "Status", "Start date", "Due Date", "Completion Date", "Notes"], 10);
const INTAKE_A = row(["0", "Trademark Owner", "Trademark Name", "Serial No.", "Status", "Description", "Source", "Notes", "Priority", "", "Assigned To", "Opinion Letter Due Date", "Start Date", "Completion Date", "Legal Fee"], 20);
const INTAKE_B = row(["Client Name", "Trademark Owner", "Trademark Name", "Serial No.", "Status", "Description", "Notes", "Priority", "Assigned To", "Opinion Letter Due Date", "Start Date", "Completion Date", "Legal Fee"], 20);

const lines = [
  // 1: a task list (its header has a Status column, which is what fooled the old reader)
  TASKS_HEADER,
  row(["Brisa Tanaka", "Trademark", "File application", "High", "RL", "In progress", "9/1", "10/1", "", "waiting"], 10),
  row(["Wolfram Adeyemi", "Copyright", "Draft letter", "Low", "DO", "Done"], 6),
  "",
  // 5: a contacts list
  row(["First Name", "Last Name", "Email Address", "Phone Number", "Practice Area", "Trademark Name", "Website/Instagram", "Priority", "Notes"], 11),
  row(["Ottoline", "Marchbanks", "Ottoline@Marchbanks.example", "", "Trademark", "Inkwell", "", "", ""], 11),
  row(["Peregrine", "Dunmore", "peregrine@dunmore.example", "", "Trademark", "", "", "", ""], 11),
  row(["Nameless", "", "not-an-address", "", "", "", "", "", ""], 11),
  "",
  // 10: a ragged agreements tab
  row(["Task", "Notes", "Priority", "Status", "Assigned Date", "Due Date", "Completion Date", "Comments"], 53),
  row(["Review NDA", "x", "Low", "Open"], 5),
  "",
  // 13: a contracts list
  row(["Client Name", "Practice Area", "Contract Type", "Status", "Task", "Notes", "Priority", "Assigned To", "Start Date", "Completion Date", "Legal Fee", "Legal Fee Due Date"], 23),
  row(["Brisa Tanaka", "Trademark", "LOE", "Signed"], 8),
  "",
  // 16: the intake tab, layout A
  INTAKE_A,
  row(["Ottoline Marchbanks", "", "Inkwell", "", "1. Potential New Client", "PNC scheduled consult for 10.15.26", "Referral", "", "", "", "RL"], 20),
  row(["Peregrine Dunmore", "", "", "", "3. Consultation Scheduled", "DO sent proposal 10.16.26; RL sent follow up 10.18.26", "", "", "", "", ""], 53),
  row(["Quillon Ashby", "", "Harbour", "", "2. Preliminary Search", "MJ ran the search 10.1.26", "", "", "", "", ""], 20),
  "",
  // 21: a podcast-ish tab with its own header
  row(["Task", "Notes", "Priority", "Associated Link", "Status", "Start date", "Due Date", "Completion Date"], 10),
  row(["Record episode", "", "", "", "Open"], 5),
  "",
  // 24: the intake tab again (layout A): Ottoline repeated identically, Peregrine moved on
  INTAKE_A,
  row(["Ottoline Marchbanks", "", "Inkwell", "", "1. Potential New Client", "PNC scheduled consult for 10.15.26", "Referral", "", "", "", "RL"], 20),
  row(["Peregrine Dunmore", "", "", "", "4. Post Consultation Email Sent", "DO sent proposal 10.16.26", "", "", "", "", ""], 20),
  "",
  // 29: the intake tab, layout B (the owner is under "Client Name")
  INTAKE_B,
  row(["Rosalind Fairweather", "", "Lantern", "", "6. LOE & Invoice Sent", "TAM sent LOE and invoice 10.2.26", "", "", "", "", ""], 20),
  row(["Ottoline Marchbanks", "", "Inkwell", "", "1. Potential New Client", "PNC scheduled consult for 10.15.26", "", "", "", "", ""], 20),
  "",
];
const CSV = lines.join("\n");
const stages = STAGES.map((s) => ({ id: s.id, name: s.name }));

describe("the fixture itself", () => {
  it("is shaped like the export: ragged rows, a task list first, the intake tab three times in two layouts", () => {
    const grid = parseCsv(CSV);
    const widths = grid.map((r) => r.length).filter((w) => w > 1);
    expect(Math.min(...widths)).toBeLessThanOrEqual(6);
    expect(Math.max(...widths)).toBe(53);
    expect(grid[0][5]).toBe("Status");
    const intakeHeaders = grid.filter((r) => classifyHeader(r)?.kind === "intake");
    expect(intakeHeaders).toHaveLength(3);
    expect(intakeHeaders.filter((r) => r[0] === "0")).toHaveLength(2);
    expect(intakeHeaders.filter((r) => r[0] === "Client Name")).toHaveLength(1);
  });
});

describe("the first-row-only header bug", () => {
  // The reader before Sprint 26: the header was row 1, full stop.
  function oldReader(text: string) {
    const grid = parseCsv(text);
    const header = grid[0].map((cell) => (cell.trim() === "Status" ? "Status" : cell));
    if (!header.includes("Status")) return { ok: false as const };
    return { ok: true as const, records: recordsFromSheetRows([header, ...grid.slice(1)]) };
  }

  it("the old reader takes the task list's header and finds no intake row at all", () => {
    const old = oldReader(CSV);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    const read = readSheetRecords(old.records, stages, NOW);
    expect(read.entries.filter((e) => e.reading.kind === "ok")).toHaveLength(0);
    expect(read.intakeRows).toBe(0);
  });

  it("the new reader finds the intake rows of EVERY intake section", () => {
    const parsed = parseSheetRecords(CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const read = readSheetRecords(parsed.records, stages, NOW, { rowNumbers: parsed.rowNumbers });
    const owners = read.entries.filter((e) => e.reading.kind === "ok").map((e) => e.ownerName).sort();
    // Section 1 gave Ottoline, Peregrine and Quillon; section 2 repeated Ottoline (merged) and moved Peregrine on;
    // section 3 (the other layout) gave Rosalind and Ottoline again (merged).
    expect(owners).toEqual(["Ottoline Marchbanks", "Peregrine Dunmore", "Peregrine Dunmore", "Quillon Ashby", "Rosalind Fairweather"]);
  });
});

describe("each section is parsed with its own header", () => {
  const parsed = parseSheetRecords(CSV);
  if (!parsed.ok) throw new Error(parsed.error);
  // After the dates in the fixture's logs, so none of them reads as a future typo.
  const read = readSheetRecords(parsed.records, stages, new Date("2026-11-01T00:00:00Z"), { rowNumbers: parsed.rowNumbers, sections: parsed.sections, contacts: parsed.contacts });
  const entry = (owner: string, code?: string) =>
    read.entries.find((e) => e.ownerName === owner && (code === undefined || e.exactKey === sheetKeyFor({ ownerName: owner, markText: e.markText, stageCode: code })))!;

  it("reads the owner under 'Client Name' in the second layout", () => {
    expect(entry("Rosalind Fairweather")).toMatchObject({ markText: "Lantern", reading: { kind: "ok", stageId: S.loe } });
  });

  it("reads the owner under '0' in the first layout", () => {
    expect(entry("Quillon Ashby")).toMatchObject({ markText: "Harbour", reading: { kind: "ok", stageId: S.prelim } });
  });

  it("numbers rows by the WORKSHEET row, not by their place in the stacked list", () => {
    expect(entry("Ottoline Marchbanks").row).toBeGreaterThanOrEqual(17);
    const at = (needle: string) => lines.findIndex((l) => l.startsWith(needle)) + 1;
    expect(entry("Rosalind Fairweather").row).toBe(at("Rosalind"));
    expect(entry("Quillon Ashby").row).toBe(at("Quillon"));
  });

  it("a row in the ragged 53-column section keeps its cells", () => {
    expect(entry("Peregrine Dunmore", "3").notes?.map((n) => n.milestones).flat()).toEqual(expect.arrayContaining(["proposal_sent", "follow_up_sent"]));
  });

  it("keeps the classified notes of each row (date, milestones, a short snippet)", () => {
    const peregrine = entry("Peregrine Dunmore", "3");
    expect(peregrine.notes).toHaveLength(2);
    expect(peregrine.notes?.[0]).toMatchObject({ date: "2026-10-16", milestones: ["proposal_sent"] });
    expect(peregrine.notes?.[1]).toMatchObject({ date: "2026-10-18", milestones: ["follow_up_sent"] });
    for (const n of peregrine.notes ?? []) expect(n.snippet.length).toBeLessThanOrEqual(140);
  });
});

describe("a person in two sections", () => {
  const parsed = parseSheetRecords(CSV);
  if (!parsed.ok) throw new Error(parsed.error);
  const read = readSheetRecords(parsed.records, stages, NOW, { rowNumbers: parsed.rowNumbers });

  it("identical rows merge to one entry", () => {
    expect(read.entries.filter((e) => e.ownerName === "Ottoline Marchbanks")).toHaveLength(1);
  });

  it("is ambiguous only if the rows disagree: Peregrine is at two codes, Ottoline at one", () => {
    const peregrine = read.entries.filter((e) => e.ownerName === "Peregrine Dunmore");
    expect(peregrine.map((e) => (e.reading.kind === "ok" ? e.reading.stageId : null)).sort()).toEqual([S.consult, S.post].sort());

    // Peregrine's lead carries neither code's key (say it was imported under an earlier code): two rows reach it.
    const key = sheetKeyFor({ ownerName: "Peregrine Dunmore", markText: null, stageCode: "2" });
    const match = matchSheetToLeads(read.entries, [{ id: "lead-p", sheetKey: key }]);
    expect(match.byLead.get("lead-p")).toMatchObject({ kind: "ambiguous" });

    // Ottoline's lead: exactly one row.
    const okey = sheetKeyFor({ ownerName: "Ottoline Marchbanks", markText: "Inkwell", stageCode: "1" });
    expect(matchSheetToLeads(read.entries, [{ id: "lead-o", sheetKey: okey }]).byLead.get("lead-o")).toMatchObject({ kind: "entry" });
  });

  it("a person who is a lead at one of the codes matches the row with that code (exact key first)", () => {
    const key = sheetKeyFor({ ownerName: "Peregrine Dunmore", markText: null, stageCode: "4" });
    const match = matchSheetToLeads(read.entries, [{ id: "lead-p", sheetKey: key }]);
    expect(match.byLead.get("lead-p")).toMatchObject({ kind: "entry" });
  });
});

describe("PNC contact lists are a read-only source of email addresses", () => {
  const parsed = parseSheetRecords(CSV);
  if (!parsed.ok) throw new Error(parsed.error);

  it("gives name and address pairs, lower-cased, and leaves out a row without a valid address", () => {
    expect(parsed.contacts).toEqual([
      { name: "Ottoline Marchbanks", email: "ottoline@marchbanks.example" },
      { name: "Peregrine Dunmore", email: "peregrine@dunmore.example" },
    ]);
  });

  it("contacts are never read as intake rows", () => {
    const owners = parsed.records.map((r) => String(r["0"] ?? r["Client Name"] ?? ""));
    expect(owners).not.toContain("Ottoline");
  });

  it("contactsFrom ignores every other kind of section", () => {
    const sections = findSections(parseCsv(CSV));
    expect(contactsFrom(sections.filter((s) => s.kind !== "contacts"))).toEqual([]);
  });
});

describe("which sections were read and skipped", () => {
  const parsed = parseSheetRecords(CSV);
  if (!parsed.ok) throw new Error(parsed.error);

  it("is derived from the headers", () => {
    expect(parsed.sections.read).toEqual([
      { name: "PNC contact list", sections: 1, rows: 3 },
      { name: "Trademark intake", sections: 3, rows: 7 },
    ]);
    expect(parsed.sections.skipped).toEqual(["Tasks (3)", "Contracts"]);
  });

  it("reads like the preview line", () => {
    expect(describeSections(parsed.sections)).toBe("Read: PNC contact list (1 section, 3 rows), Trademark intake (3 sections, 7 rows). Skipped: Tasks (3), Contracts.");
  });

  it("groups thousands, and an unrecognised list is named, never silently dropped", () => {
    const line = describeSections({ read: [{ name: "Trademark intake", sections: 3, rows: 1170 }], skipped: ["Tasks", "Other list (Foo, Bar, Baz)"] });
    expect(line).toBe("Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Other list (Foo, Bar, Baz).");
    const odd = summarizeSections(findSections(parseCsv("Task,Notes,Priority,Start date\nx,,,\n")));
    expect(odd.skipped).toEqual(["Tasks"]);
    expect(summarizeSections(findSections(parseCsv("Alpha,Notes,Priority,Due Date,Comments\n1,,,,\n"))).skipped[0]).toMatch(/^Other list \(/);
  });

  it("is carried into the read, with the contacts", () => {
    const read = readSheetText(CSV, stages, NOW);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.read.sections).toEqual(parsed.sections);
      expect(read.read.contacts).toHaveLength(2);
    }
  });
});

describe("refusals about the file are unchanged", () => {
  it("a file with no intake section gets the 'no Status column' style refusal, even when other sections have a Status", () => {
    const tasksOnly = [TASKS_HEADER, row(["Brisa", "Trademark", "File", "High", "RL", "Open"], 10)].join("\n");
    expect(parseSheetRecords(tasksOnly)).toEqual({ ok: false, error: SHEET_MESSAGES.noStatus });
  });

  it("empty, whitespace, unclosed quote, a Status column with no rows", () => {
    expect(parseSheetRecords("")).toEqual({ ok: false, error: SHEET_MESSAGES.empty });
    expect(parseSheetRecords('0,Status\n"x,1')).toEqual({ ok: false, error: SHEET_MESSAGES.unterminated });
    expect(parseSheetRecords("0,Status\n,\n")).toEqual({ ok: false, error: SHEET_MESSAGES.noRows });
  });

  it("an Excel workbook and a file over 5 MB are still refused before they are opened", () => {
    expect(checkSheetFile("tracker.xlsx", 100)).toEqual({ ok: false, error: SHEET_MESSAGES.excel });
    expect(checkSheetFile("tracker.csv", 5 * 1024 * 1024 + 1)).toEqual({ ok: false, error: SHEET_MESSAGES.tooBig });
  });

  it("a one-section file behaves as before (header on row 1, rows numbered from 2)", () => {
    const read = readSheetText("0,Status,Description\nAmara Nwosu,1. Potential New Client,PNC scheduled consult for 9.14.26\n", stages, NOW);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.read.entries[0]).toMatchObject({ row: 2, ownerName: "Amara Nwosu" });
  });
});

describe("any list with a Status column is its own section, so its rows are never read under the intake header", () => {
  const book = [
    INTAKE_A,
    row(["Ottoline Marchbanks", "", "Inkwell", "", "1. Potential New Client", "PNC scheduled consult for 10.15.26"], 20),
    "",
    // The agreements / podcasts tabs of the real export carry a Status column too.
    row(["Type of Agreement", "Party to Agreement", "Podcast", "Host Name", "Due Date", "Priority", "Assigned To", "Status", "Notes"], 12),
    row(["NDA", "Some Party", "Some Show", "Some Host", "", "", "", "Open", ""], 12),
    row(["Name", "Description", "Status"], 5),
    row(["Item", "A thing", "Pending"], 5),
    row(["Agency Agreement", "Podcast", "Host Name", "Due Date", "Priority", "Assigned To", "Status", "Notes"], 10),
    row(["Signed", "Show", "Host", "", "", "", "Open", ""], 10),
  ].join("\n");

  it("their rows are not intake rows", () => {
    const parsed = parseSheetRecords(book);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.records).toHaveLength(2); // the one intake row and the blank row after it
    const read = readSheetRecords(parsed.records, stages, NOW);
    expect(read.entries.map((e) => e.ownerName)).toEqual(["Ottoline Marchbanks"]);
    expect(read.refused).toEqual([]);
  });

  it("are named from their headers, and listed as skipped", () => {
    const parsed = parseSheetRecords(book);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.sections.skipped).toEqual(["Podcasts (2)", "Other list (Name, Description, Status)"]);
    expect(classifyHeader(["Type of Agreement", "Party to Agreement", "Status"])).toEqual({ kind: "other", name: "Agreements" });
  });

  it("the intake tab's own columns are what make a Status header intake", () => {
    expect(classifyHeader(["0", "Status"])?.kind).toBe("intake");
    expect(classifyHeader(["Client Name", "Trademark Name", "Status"])?.kind).toBe("intake");
    expect(classifyHeader(["Name", "Status"])?.kind).toBe("other");
  });
});
