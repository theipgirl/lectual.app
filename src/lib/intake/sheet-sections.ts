/**
 * The intake workbook exported as ONE CSV: every tab stacked after the last, each starting with its
 * own header row and with rows of very different lengths. This finds those sections.
 *
 * Reading only row 1 as the header (the first version of the reader) meant a workbook whose first
 * tab is a task list found no intake rows at all. Here EVERY section whose header looks like an
 * intake tab is parsed with its own header; the PNC contact-list sections are kept as a read-only
 * source of email addresses; every other section is listed as skipped, never silently dropped.
 *
 * Pure: no I/O, safe for the browser. Section names come from the headers, not from the file.
 */

export type SectionKind = "intake" | "contacts" | "other";

export type SheetSection = {
  kind: SectionKind;
  /** A name derived from the header cells ("Trademark intake", "Contracts", ...). */
  name: string;
  /** 1-based worksheet row of the header. */
  headerRow: number;
  header: string[];
  /** The rows under the header, up to the next header. */
  rows: string[][];
};

const GENERIC_HEADER_WORDS = new Set([
  "Task",
  "Notes",
  "Priority",
  "Status",
  "Start date",
  "Start Date",
  "Due Date",
  "Completion Date",
  "Completed Date",
  "Assigned Date",
  "Assigned To",
  "Client Name",
  "Practice Area",
  "Comments",
  "Associated Link",
  "Contract Type",
]);

/** What kind of header this row is, or null when it is a data row. */
export function classifyHeader(row: readonly string[]): { kind: SectionKind; name: string } | null {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  const has = (name: string) => cells.includes(name);

  if (has("First Name") && has("Email Address")) return { kind: "contacts", name: "PNC contact list" };
  if (has("Status")) {
    if (has("Contract Type")) return { kind: "other", name: "Contracts" };
    if (has("Task")) return { kind: "other", name: "Tasks" };
    return { kind: "intake", name: "Trademark intake" };
  }
  if (has("Contract Type")) return { kind: "other", name: "Contracts" };
  if (has("Task") && cells.filter((c) => GENERIC_HEADER_WORDS.has(c)).length >= 3) return { kind: "other", name: "Tasks" };
  if (cells.filter((c) => GENERIC_HEADER_WORDS.has(c)).length >= 4) {
    return { kind: "other", name: `Other list (${cells.slice(0, 3).join(", ")})` };
  }
  return null;
}

/** Every section in the grid, in file order. Rows above the first header belong to no section. */
export function findSections(grid: readonly (readonly string[])[]): SheetSection[] {
  const sections: SheetSection[] = [];
  let current: SheetSection | null = null;
  grid.forEach((row, i) => {
    const header = classifyHeader(row);
    if (header) {
      current = { ...header, headerRow: i + 1, header: [...row], rows: [] };
      sections.push(current);
      return;
    }
    current?.rows.push([...row]);
  });
  return sections;
}

const isBlankRow = (row: readonly string[]) => row.every((c) => c.trim() === "");

export type SectionsSummary = {
  read: Array<{ name: string; sections: number; rows: number }>;
  skipped: string[];
};

export function summarizeSections(sections: readonly SheetSection[]): SectionsSummary {
  const read = new Map<string, { name: string; sections: number; rows: number }>();
  const skipped = new Map<string, number>();
  for (const s of sections) {
    if (s.kind === "other") {
      skipped.set(s.name, (skipped.get(s.name) ?? 0) + 1);
      continue;
    }
    const entry = read.get(s.name) ?? { name: s.name, sections: 0, rows: 0 };
    entry.sections += 1;
    entry.rows += s.rows.filter((r) => !isBlankRow(r)).length;
    read.set(s.name, entry);
  }
  return {
    read: [...read.values()],
    skipped: [...skipped].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)),
  };
}

/** "Read: Trademark intake (3 sections, 1,170 rows). Skipped: Tasks, Contracts." */
export function describeSections(summary: SectionsSummary): string {
  const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  const read = summary.read.map((r) => `${r.name} (${plural(r.sections, "section")}, ${plural(r.rows, "row")})`);
  const parts = [`Read: ${read.length > 0 ? read.join(", ") : "nothing"}.`];
  if (summary.skipped.length > 0) parts.push(`Skipped: ${summary.skipped.join(", ")}.`);
  return parts.join(" ");
}

// ── contact lists ────────────────────────────────────────────────────────────

export type SheetContact = { name: string; email: string };

const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"'.]+(\.[^\s@,;<>"'.]+)+$/;

/** Name and address from the contact-list sections. A row without both a name and a valid address is left out. */
export function contactsFrom(sections: readonly SheetSection[]): SheetContact[] {
  const out: SheetContact[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (section.kind !== "contacts") continue;
    const col = (name: string) => section.header.findIndex((c) => c.trim() === name);
    const first = col("First Name");
    const last = col("Last Name");
    const email = col("Email Address");
    for (const row of section.rows) {
      const address = (row[email] ?? "").trim().toLowerCase();
      const name = [row[first], last >= 0 ? row[last] : ""].map((c) => (c ?? "").trim()).filter(Boolean).join(" ");
      if (!name || !EMAIL.test(address)) continue;
      const key = `${name.toLowerCase()}|${address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, email: address });
    }
  }
  return out;
}
