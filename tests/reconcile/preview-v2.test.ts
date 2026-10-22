import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notesSummaryLine } from "../../src/lib/reconcile/describe";
import { SECRET } from "./helpers";
import { L, lawmaticsStub, makeWorld } from "./world";
import { csvFile, fixtureLeads, formWith, loadActions } from "./actions-helpers";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";

/** The preview's new reads: Lawmatics notes, the firm's stage mapping, the sections of the file. Fixed sentences throughout. */

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const margoProspect = () => prospectsPayload([{ id: "200", matterName: "M", firstName: "Margo", stage: "Consultation Scheduled", email: "margo@example.com" }]);
const note = (id: string, body: string, at = "2026-09-20T10:00:00Z") => ({ type: "note", id: `n-${id}`, attributes: { body, notable_id: id, notable_type: "Prospect", created_at: at } });

async function run(opts: { notes?: Parameters<typeof lawmaticsStub>[0]; brain?: Array<Record<string, unknown>> } = {}) {
  const w = makeWorld({ leads: fixtureLeads(), brain: opts.brain });
  const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: margoProspect, ...opts.notes }) });
  const r = await loaded.previewReconcileAction(formWith(csvFile()));
  if (!r.ok) throw new Error(r.error);
  return { r, w, row: (id: string) => r.view.rows.find((x) => x.leadId === id)! };
}

describe("Lawmatics notes", () => {
  it("are read for the people on the table with a Lawmatics record, and their milestones become evidence", async () => {
    const { r, row } = await run({ notes: { notes: (id) => (id === "200" ? [note("200", "consult done, sent proposal")] : []) } });
    expect(r.view.summary.notes).toMatchObject({ status: "ok", records: 1, notes: 1, truncated: false });
    expect(row(L.margo).notes).toEqual({ status: "ok", count: 1 });
    expect(row(L.margo).proposal.stage?.name).toBe("Post Consultation Email Sent");
    expect(row(L.margo).proposal.reasons.join(" ")).toContain("Proposal sent Sep 20 (Lawmatics note)");
  });

  it("a person with a record and no notes reads 'ok, 0 read', not an error", async () => {
    const { row } = await run();
    expect(row(L.margo).notes).toEqual({ status: "ok", count: 0 });
  });

  it("a failed notes read is a named state on the row and the summary, never 'no notes', and shows nothing from the error", async () => {
    const { r, row } = await run({ notes: { notesFail: true } });
    expect(row(L.margo).notes).toMatchObject({ status: "unavailable" });
    expect(r.view.summary.notes).toMatchObject({ status: "unavailable" });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(SECRET);
    // The other sources still propose.
    expect(row(L.margo).proposal.stage).not.toBeNull();
    expect(notesSummaryLine(r.view.summary.notes)).toMatch(/unavailable/);
  });

  it("is not read at all when Lawmatics is not connected", async () => {
    const w = makeWorld({ leads: fixtureLeads() });
    const loaded = await loadActions(w, { lawmatics: "not-connected" });
    const r = await loaded.previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.summary.notes).toMatchObject({ status: "not-read" });
  });

  it("only ever asks Lawmatics to read (GET) and only for the people on the table", async () => {
    const stub = lawmaticsStub({ prospects: margoProspect });
    const w = makeWorld({ leads: fixtureLeads() });
    const loaded = await loadActions(w, { lawmatics: stub });
    await loaded.previewReconcileAction(formWith(csvFile()));
    expect(stub.calls.every((c) => c.method === "get" || c.method === "listAll")).toBe(true);
    expect(stub.calls.filter((c) => c.path === "/notes")).toHaveLength(1);
  });
});

describe("the firm's stage mapping", () => {
  it("is read from the firm brain and used first", async () => {
    const { row } = await run({
      notes: { notes: (id) => (id === "200" ? [note("200", "sent proposal")] : []) },
      brain: [{ org_id: "aaaaaaaa-0000-4000-8000-000000000001", category: "stage_mapping", key: "proposal_sent", body: "Undecided / Questions", data: {} }],
    });
    expect(row(L.margo).proposal.stage?.name).toBe("Undecided / Questions");
  });

  it("an unreadable mapping says so and the default names are used", async () => {
    const w = makeWorld({ leads: fixtureLeads() });
    w.db.fail("crm_firm_brain_entry", "select", { code: "XX000", message: SECRET });
    const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: margoProspect }) });
    const r = await loaded.previewReconcileAction(formWith(csvFile()));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.summary.mappingNote).toMatch(/default stage names were used/);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

describe("the sections of the file", () => {
  it("are reported in the summary", async () => {
    const { r } = await run();
    expect(r.view.summary.sectionsLine).toBe("Read: Trademark intake (1 section, 11 rows).");
  });

  it("a whole workbook exported as one CSV is read: the intake rows of every intake section", async () => {
    const workbook = [
      "Client Name,Practice Area,Task,Priority,Assigned To,Status",
      "Someone,Trademark,File,High,RL,Open",
      "",
      "0,Trademark Owner,Trademark Name,Serial No.,Status,Description",
      "Amara Nwosu,,,,1. Potential New Client,PNC scheduled consult for 9.14.26",
    ].join("\n");
    const w = makeWorld({ leads: fixtureLeads() });
    const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: margoProspect }) });
    const r = await loaded.previewReconcileAction(formWith(csvFile("book.csv", workbook)));
    if (!r.ok) throw new Error(r.error);
    expect(r.view.rows.find((x) => x.leadId === L.amara)!.sheet).toMatchObject({ kind: "stage", stageId: "5100aaaa-0000-4000-8000-000000000001" });
    expect(r.view.summary.sectionsLine).toBe("Read: Trademark intake (1 section, 1 row). Skipped: Tasks.");
  });
});

describe("the mailbox search", () => {
  it("says why it did not run on every row: module off", async () => {
    const { row } = await run();
    expect(row(L.amara).mailbox).toMatchObject({ status: "unavailable", code: "module-off" });
  });

  it("states: no mailbox, Gmail only, read failure", async () => {
    const cases = [
      [{ moduleOn: true, items: [] }, "no-mailbox"],
      [{ moduleOn: true, items: [{ id: "g", email: "g@x.com", provider: "google" as const, scopes: null, accessToken: async () => "t" }] }, "gmail-only"],
      [{ moduleOn: true, readFails: true }, "failed"],
    ] as const;
    for (const [mailbox, code] of cases) {
      const w = makeWorld({ leads: fixtureLeads() });
      const loaded = await loadActions(w, { lawmatics: lawmaticsStub({ prospects: margoProspect }), mailbox: mailbox as never });
      const r = await loaded.previewReconcileAction(formWith(csvFile()));
      if (!r.ok) throw new Error(r.error);
      expect(r.view.rows.find((x) => x.leadId === L.amara)!.mailbox).toMatchObject({ status: "unavailable", code });
    }
  });

  it("searches at most 40 people; the rest are named, not read as 'no mail'", async () => {
    const leads = Array.from({ length: 45 }, (_, i) =>
      ({ id: `33333333-0000-4000-8000-${String(i).padStart(12, "0")}`, org_id: "aaaaaaaa-0000-4000-8000-000000000001", first_name: `P${i}`, last_name: "Test", email: `p${i}@example.com`, current_stage_id: "5100aaaa-0000-4000-8000-000000000001", sheet_key: null, lawmatics_id: null, practice_area: null, created_at: "2026-09-01T00:00:00Z" }),
    );
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ value: [] }) };
    }));
    const w = makeWorld({ leads });
    const loaded = await loadActions(w, {
      lawmatics: lawmaticsStub({ prospects: margoProspect }),
      mailbox: { moduleOn: true, items: [{ id: "m", email: "f@x.com", provider: "microsoft", scopes: null, accessToken: async () => "t" }] },
    });
    const r = await loaded.previewReconcileAction(formWith(csvFile()));
    vi.unstubAllGlobals();
    if (!r.ok) throw new Error(r.error);
    const states = r.view.rows.map((x) => x.mailbox);
    expect(states.filter((s) => s?.status === "ok")).toHaveLength(40);
    expect(states.filter((s) => s?.status === "unavailable" && s.code === "limit")).toHaveLength(5);
    expect(seen).toHaveLength(80);
    expect(r.view.summary.mailbox?.note).toMatch(/first 40 people/);
  });
});
