import { beforeEach, describe, expect, it, vi } from "vitest";
import { labelsOf, renderOwnerSheet, renderReadOnly, rowOf, tableHeaders } from "./columns-fixtures";
import { COLUMN_IDS, NOTES_PRESENT, SHEET_SECTION_COLUMNS, columnsFor, type ColumnId } from "@/lib/review/sheet-columns";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));
beforeEach(() => vi.resetModules());

// Changed on purpose (merge with the Notes cell): Notes is drawn in the registry's slot (Trademarks after Source, Contracts after Next step).
const DEFAULT_TM = ["Trademark Owner", "Trademark Name", "Serial No.", "Status", "Source", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date", "Office Action Due Date", "Next step", "Waiting on", "Last contact"];
const DEFAULT_CT = ["Client Name", "Practice Area", "Contract Type", "Status", "Next step", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Waiting on", "Last contact"];

/** The trademarks order with `status` moved to second place, as a stored choice (the missing ids come back at their default place). */
const moved = (order: ColumnId[]) => ["client", "status", ...order.filter((x) => x !== "client" && x !== "status")] as ColumnId[];
const trademarkOrder = [...SHEET_SECTION_COLUMNS.trademarks];

const PREFS = {
  trademarks: { order: moved(trademarkOrder), hidden: ["serial", "source"] },
  contracts: { order: ["client", "practiceArea", "mark", "status", "next", "owner", "start", "legalFee", "legalFeeDue", "waiting", "contact"], hidden: ["practiceArea", "legalFeeDue"] },
};

const both = async (opts: { canSeeMoney: boolean; initialPrefs?: object }) => [
  { name: "read-only List", html: await renderReadOnly(opts as never) },
  { name: "owner's Sheet", html: await renderOwnerSheet(opts as never) },
];

describe("both tables follow explicit prefs: hide, move, reset", () => {
  it("hide: a hidden column has no header, no cell and no data-label, in either table", async () => {
    for (const { name, html } of await both({ canSeeMoney: true, initialPrefs: PREFS })) {
      const [tm, ct] = tableHeaders(html);
      expect(tm, name).not.toContain("Serial No.");
      expect(tm, name).not.toContain("Source");
      expect(ct, name).not.toContain("Practice Area");
      expect(ct, name).not.toContain("Legal Fee Due Date");
      expect(html, name).not.toContain('data-label="Serial No."');
      expect(html, name).not.toContain('data-label="Practice Area"');
    }
  });
  it("move: Status now follows the owner column's place, headers and cells together", async () => {
    for (const { name, html } of await both({ canSeeMoney: true, initialPrefs: PREFS })) {
      const [tm] = tableHeaders(html);
      expect(tm.slice(0, 3), name).toEqual(["Trademark Owner", "Status", "Trademark Name"]);
      expect(tm, name).toEqual(["Trademark Owner", "Status", "Trademark Name", "Notes", "Owner", "Start Date", "Legal Fee", "Legal Fee Due Date", "Government Filing fee", "Government Filing Fee Due Date", "Office Action Due Date", "Next step", "Waiting on", "Last contact"]);
      expect(labelsOf(rowOf(html, "Acme Studio")), name).toEqual(tm.slice(1));
    }
  });
  it("sections are separate: Contracts follows its own choices", async () => {
    for (const { name, html } of await both({ canSeeMoney: true, initialPrefs: PREFS })) {
      const [, ct] = tableHeaders(html);
      // The stored order does not name Notes: it comes back at its default place, after Next step.
      expect(ct, name).toEqual(["Client Name", "Contract Type", "Status", "Next step", "Notes", "Owner", "Start Date", "Legal Fee", "Waiting on", "Last contact"]);
    }
  });
  it("reset: the default document (what Reset writes) gives the spreadsheet order again", async () => {
    const reset = { trademarks: { order: trademarkOrder, hidden: [] }, contracts: { order: [...SHEET_SECTION_COLUMNS.contracts], hidden: [] } };
    for (const { name, html } of await both({ canSeeMoney: true, initialPrefs: reset })) {
      const [tm, ct] = tableHeaders(html);
      expect(tm, name).toEqual(DEFAULT_TM);
      expect(ct, name).toEqual(DEFAULT_CT);
    }
  });
  it("no prefs at all: the first render is the default order", async () => {
    for (const { name, html } of await both({ canSeeMoney: true })) {
      const [tm, ct] = tableHeaders(html);
      expect(tm, name).toEqual(DEFAULT_TM);
      expect(ct, name).toEqual(DEFAULT_CT);
    }
  });
});

describe("money id in prefs absent for non-owner", () => {
  it("a stored order or hidden list naming fee columns draws no fee header, cell or label for a viewer who may not see money", async () => {
    const prefs = { trademarks: { order: ["legalFee", "client", "govFee", "mark", "govFeeDue"], hidden: ["legalFeeDue"] }, contracts: { order: ["legalFee", "client"], hidden: [] } };
    for (const { name, html } of await both({ canSeeMoney: false, initialPrefs: prefs })) {
      const [tm, ct] = tableHeaders(html);
      for (const h of [...tm, ...ct]) expect(h, name).not.toMatch(/Fee/);
      expect(html, name).not.toMatch(/\$1,250|\$700|\$4,750|data-label="(Legal|Government)/);
      expect(tm[0], name).toBe("Trademark Owner");
    }
  });
  it("hiding client is ignored: the link column is still first", async () => {
    for (const { name, html } of await both({ canSeeMoney: true, initialPrefs: { trademarks: { order: [], hidden: ["client"] }, contracts: { order: ["mark", "client"], hidden: ["client"] } } })) {
      const [tm, ct] = tableHeaders(html);
      expect(tm[0], name).toBe("Trademark Owner");
      expect(ct[0], name).toBe("Client Name");
    }
  });
});

describe("the chooser can only thin and reorder what columnsFor allows", () => {
  it("every id drawn is one of the server's allowed columns, for any stored document", async () => {
    const hostile = { trademarks: { order: [...COLUMN_IDS, "notes", "nope"], hidden: [] }, contracts: { order: ["serial", "oaDue", "govFee"], hidden: ["client"] } };
    const allowedTm = columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT }).map((c) => c.header);
    const allowedCt = columnsFor("contracts", { canSeeMoney: false, hasNotes: NOTES_PRESENT }).map((c) => c.header);
    for (const { name, html } of await both({ canSeeMoney: false, initialPrefs: hostile })) {
      const [tm, ct] = tableHeaders(html);
      for (const h of tm) expect(allowedTm, `${name} ${h}`).toContain(h);
      for (const h of ct) expect(allowedCt, `${name} ${h}`).toContain(h);
      expect(tm).toHaveLength(allowedTm.length);
      // Changed on purpose (merge with the Notes cell): Notes is now one of the allowed columns, drawn once.
      expect(tm.filter((h) => h === "Notes"), name).toHaveLength(1);
    }
  });
});
