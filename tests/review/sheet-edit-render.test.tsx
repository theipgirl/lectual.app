import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { row, TODAY } from "./fixtures";
import type { SheetPerms } from "@/lib/review/sheet-edit";

// The table asks the router for fresh rows after a save the rows on screen don't read yet.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));

const STAGE = "00000000-0000-4000-8000-000000000009";
const members = [
  { userId: "u-reb", name: "Rebecca Ames", role: "owner" },
  { userId: "u-cait", name: "Caitlyn Ross", role: "paralegal" },
];
const rows = [
  row({ key: "m-1", client: "Matter Co", nextStep: { id: "00000000-0000-4000-8000-000000000003", title: "Call back", dueDate: "2026-10-30", assigneeId: "u-cait" }, assignedTo: "u-reb" }),
  row({ key: "l-1", kind: "lead", id: "00000000-0000-4000-8000-000000000002", client: "Lead Co", nextStep: null, assignedTo: null, source: "Referral" }),
];
const params = { view: "sheet", who: "all", kind: "both", q: "", i: 1, person: null, open: null, since: "default" } as never;
const OWNER: SheetPerms = { writeMatter: true, writeLead: true, moveLead: true, matterStages: [{ id: STAGE, name: "Filed" }], leadStages: [{ id: STAGE, name: "Consult", category: "open" }] };
const READ_ONLY: SheetPerms = { writeMatter: false, writeLead: false, moveLead: false, matterStages: null, leadStages: null };

async function render(perms: SheetPerms) {
  const { SheetEdit } = await import("@/components/review/SheetEdit");
  return renderToStaticMarkup(<div className="rv-owner"><SheetEdit rows={rows} perms={perms} owner today={TODAY} members={members} canWrite={perms.writeMatter} params={params} /></div>);
}

describe("the owner's editable Sheet", () => {
  beforeEach(() => vi.resetModules());

  it("draws an editor on Status, Next step, Whose court and Source, and + Note on every row", async () => {
    const html = await render(OWNER);
    for (const col of ["status", "next", "court", "source"]) {
      expect(html).toContain(`data-rse-cell="m-1|${col}"`);
      expect(html).toContain(`data-rse-cell="l-1|${col}"`);
    }
    expect(html.match(/aria-label="Add a note for /g)?.length).toBe(2);
    expect(html).toContain("You type these");
    expect(html).toContain("Lectual works these out");
    expect(html).toContain('role="separator"');
  });

  it("Waiting on and Last contact are locked: no editor, styled as locked", async () => {
    const html = await render(OWNER);
    expect(html).not.toMatch(/data-rse-cell="[^"]*\|(waiting|contact|client|mark)"/);
    expect(html).toMatch(/<td data-label="Waiting on" class="rse-locked">/);
    expect(html).toMatch(/<td data-label="Last contact" class="rse-locked/);
    expect(html).toContain('class="rse-lock-th"');
  });

  it("Whose court shows the lane rule's person: the step's assignee, else the record's, else Unassigned", async () => {
    const html = await render(OWNER);
    const matterCourt = html.slice(html.indexOf('data-rse-cell="m-1|court"'));
    expect(matterCourt.slice(0, 300)).toContain(">Caitlyn<");
    const leadCourt = html.slice(html.indexOf('data-rse-cell="l-1|court"'));
    expect(leadCourt.slice(0, 300)).toContain(">Unassigned<");
  });

  it("a read-only role sees the same table with no editors, grips, + Note or legend", async () => {
    const html = await render(READ_ONLY);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-rse-cell");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain("+ Note");
    expect(html).not.toContain("You type these");
    for (const name of ["Matter Co", "Lead Co", "Caitlyn", "Referral", "Call back"]) expect(html).toContain(name);
  });

  it("a lead's Status has no editor without the move-stage role; an unreadable stage list says so", async () => {
    const html = await render({ ...OWNER, moveLead: false });
    expect(html).not.toContain('data-rse-cell="l-1|status"');
    expect(html).toContain('data-rse-cell="l-1|next"');
    const missing = await render({ ...OWNER, matterStages: null });
    expect(missing).not.toContain('data-rse-cell="m-1|status"');
    expect(missing).toContain("The stage list couldn&#x27;t load");
  });

  it("the Client cell is the link to the record panel; an overdue step is marked in words too", async () => {
    const html = await render(OWNER);
    expect(html).toMatch(/class="rse-client" href="[^"]*open=matter%3A/);
    expect(html).toContain("(overdue)");
  });
});
