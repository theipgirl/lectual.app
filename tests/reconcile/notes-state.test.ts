import { describe, expect, it } from "vitest";
import { buildPlan, type PlanInput } from "../../src/lib/reconcile/plan";
import { notesSummaryLine } from "../../src/lib/reconcile/describe";
import type { NotesRead } from "../../src/lib/lawmatics/notes";
import type { LawmaticsSourceRecord } from "../../src/lib/lawmatics/normalize";
import type { LeadRow } from "../../src/lib/reconcile/types";
import { NOW, S, STAGES } from "./helpers";

/** How the Lawmatics notes state reaches the screen: ok, truncated, unavailable, not read. Never "no notes" for a failure. */

const lead = (id: string, over: Partial<LeadRow> = {}): LeadRow => ({
  id, firstName: "Ana", lastName: id.slice(-2), email: `${id}@example.com`, currentStageId: S.pnc, sheetKey: null, lawmaticsId: id, practiceArea: null, ...over,
});
const record = (id: string): LawmaticsSourceRecord => ({
  lawmaticsId: id, matterName: null, firstName: "Ana", lastName: id, email: `${id}@example.com`, phone: null, businessName: null, website: null,
  stageName: "Potential New Client", practiceArea: null, createdAt: null, updatedAt: null, contactId: null, referralSource: null,
});
const sheet = { entries: [], refused: [], blankRows: 0, rowsRead: 0, intakeRows: 0 };

function input(over: Partial<PlanInput>): PlanInput {
  return {
    fileName: "f.csv", stages: STAGES, leads: [lead("aa11"), lead("bb22")], leadsTruncated: false, sheet,
    lawmatics: { status: "ok", records: [record("aa11"), record("bb22")] },
    readEmail: async () => ({ status: "ok", byLead: new Map(), total: 0 }), now: NOW, ...over,
  };
}

const read = (entries: Array<[string, NotesRead["byRecord"] extends Map<string, infer V> ? V : never]>, skippedForLimit = 0): NotesRead => ({ byRecord: new Map(entries), skippedForLimit });

describe("the notes state", () => {
  it("ok: counts the people read and the notes", async () => {
    const { view } = await buildPlan(
      input({ readLawmaticsNotes: async () => read([["Prospect:aa11", { status: "ok", truncated: false, notes: [{ date: "2026-09-01T00:00:00Z", milestones: ["consult_held"], snippet: "x" }] }], ["Prospect:bb22", { status: "ok", truncated: false, notes: [] }]]) }),
    );
    expect(view.summary.notes).toEqual({ status: "ok", records: 2, notes: 1, truncated: false });
    expect(view.rows.map((r) => r.notes)).toEqual(expect.arrayContaining([{ status: "ok", count: 1 }, { status: "ok", count: 0 }]));
  });

  it("truncated when the per-run bound left people unread, and the screen line says the list is incomplete", async () => {
    const { view } = await buildPlan(
      input({ readLawmaticsNotes: async () => read([["Prospect:aa11", { status: "ok", truncated: false, notes: [] }], ["Prospect:bb22", { status: "unavailable", reason: "Not read: this preview reads the notes of the first 150 people only." }]], 1) }),
    );
    expect(view.summary.notes).toMatchObject({ status: "ok", truncated: true });
    expect(notesSummaryLine(view.summary.notes)).toContain("incomplete");
    expect(view.rows.find((r) => r.leadId === "bb22")?.notes).toMatchObject({ status: "unavailable" });
  });

  it("truncated when one person's notes hit the page cap", async () => {
    const { view } = await buildPlan(input({ readLawmaticsNotes: async () => read([["Prospect:aa11", { status: "ok", truncated: true, notes: [] }], ["Prospect:bb22", { status: "ok", truncated: false, notes: [] }]]) }));
    expect(view.summary.notes).toMatchObject({ truncated: true });
  });

  it("unavailable when no person's notes could be read, never an empty ok", async () => {
    const bad = { status: "unavailable" as const, reason: "Lawmatics notes couldn't be read for this record." };
    const { view } = await buildPlan(input({ readLawmaticsNotes: async () => read([["Prospect:aa11", bad], ["Prospect:bb22", bad]]) }));
    expect(view.summary.notes).toEqual({ status: "unavailable", reason: bad.reason });
  });

  it("unavailable when the whole read throws, with a fixed sentence", async () => {
    const { view } = await buildPlan(input({ readLawmaticsNotes: async () => { throw new Error("SECRET"); } }));
    expect(view.summary.notes?.status).toBe("unavailable");
    expect(JSON.stringify(view)).not.toContain("SECRET");
  });

  it("not read when Lawmatics itself is unavailable or no reader was given", async () => {
    expect((await buildPlan(input({ lawmatics: { status: "unavailable", reason: "x" }, readLawmaticsNotes: async () => read([]) }))).view.summary.notes?.status).toBe("not-read");
    expect((await buildPlan(input({}))).view.summary.notes?.status).toBe("not-read");
  });

  it("a payload the client could not recognise reads \"couldn't be read\" on the row, never \"0 read\"", async () => {
    const { createLawmaticsClient } = await import("../../src/lib/lawmatics/client");
    const { readLawmaticsNotes } = await import("../../src/lib/lawmatics/notes");
    const fetchImpl = async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({}), text: async () => "" });
    const client = createLawmaticsClient({ token: "t", fetchImpl: fetchImpl as never });
    const { view } = await buildPlan(input({ readLawmaticsNotes: (targets) => readLawmaticsNotes(client, targets) }));
    expect(view.rows.every((r) => r.notes?.status === "unavailable")).toBe(true);
    expect(view.summary.notes?.status).toBe("unavailable");
    const line = notesSummaryLine(view.summary.notes);
    expect(line).toContain("couldn't be read");
    expect(line).not.toMatch(/\b0 (read|notes)/);
  });

  it("the contact's notes are read as well, and a failed contact read names the row unavailable", async () => {
    const withContact = (id: string) => ({ ...record(id), contactId: `c-${id}` });
    let asked: Array<{ id: string; kind: string }> = [];
    const ok = { status: "ok" as const, truncated: false, notes: [] };
    const { view } = await buildPlan(
      input({
        lawmatics: { status: "ok", records: [withContact("aa11"), withContact("bb22")] },
        readLawmaticsNotes: async (t) => {
          asked = t;
          return read([
            ["Prospect:aa11", ok], ["Contact:c-aa11", ok], ["Prospect:bb22", ok],
            ["Contact:c-bb22", { status: "unavailable", reason: "Lawmatics notes couldn't be read for this record." }],
          ]);
        },
      }),
    );
    expect(asked).toEqual(expect.arrayContaining([{ id: "c-aa11", kind: "Contact" }, { id: "c-bb22", kind: "Contact" }, { id: "aa11", kind: "Prospect" }]));
    expect(view.rows.find((r) => r.leadId === "aa11")?.notes).toEqual({ status: "ok", count: 0 });
    expect(view.rows.find((r) => r.leadId === "bb22")?.notes).toMatchObject({ status: "unavailable" });
  });

  it("a note on the contact becomes cited (Lawmatics note) evidence", async () => {
    const rec = { ...record("aa11"), contactId: "c-aa11" };
    const ok = { status: "ok" as const, truncated: false, notes: [] };
    const { view } = await buildPlan(
      input({
        leads: [lead("aa11")],
        lawmatics: { status: "ok", records: [rec] },
        readLawmaticsNotes: async () =>
          read([["Prospect:aa11", ok], ["Contact:c-aa11", { status: "ok", truncated: false, notes: [{ date: "2026-09-01T00:00:00Z", milestones: ["consult_held"], snippet: "had the consult" }] }]]),
      }),
    );
    const row = view.rows.find((r) => r.leadId === "aa11")!;
    expect(row.notes).toEqual({ status: "ok", count: 1 });
    expect(row.evidence?.some((e) => e.source === "lawmatics" && e.via === "note" && e.milestone === "consult_held")).toBe(true);
    expect(row.proposal.reasons.join("\n")).toContain("(Lawmatics note)");
  });
});
