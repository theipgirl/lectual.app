import { describe, expect, it } from "vitest";
import { normalizeExtraction, withConsultDetails, type ReviewInput, type StoredConsultDetails } from "@/lib/consult/details";
import { SAVE_FAILED, SAVE_STALE, saveReview } from "@/lib/consult/review";
import type { ConsultDb } from "@/lib/consult/store";
import { MemDb, type Row } from "./memdb";

const ORG = "org-a";
const LEAD = "lead-1";
const NOW = new Date("2026-10-09T12:00:00.000Z");
const reviewer = { userId: "u1", name: "Dawn", role: "paralegal" };

const extracted = (): StoredConsultDetails =>
  normalizeExtraction(
    {
      marks: [{ mark: "SANKOFA", mark_type: "word", classes: [{ class: 25, goods: "T-shirts" }], filing_basis: "1b", basis_evidence: "Nothing sold yet.", first_use_date: null }],
      recommended_package: null,
      discount_discussed: null,
    },
    { now: NOW, source: "post-consult-agent", sourceText: "SANKOFA t-shirts, class 25. Nothing sold yet." },
  )!;

const input = (basis: "1a" | "1b" | "unknown" = "1a"): ReviewInput => ({
  marks: [{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: basis, first_use_date: null, classes: [{ class: 25, goods: "T-shirts" }] }],
  recommended_package: "Enhanced",
  discount_discussed: null,
});

const note = (notes: Row, over: Row = {}): Row => ({ id: "n-1", org_id: ORG, lead_id: LEAD, created_at: "2026-10-01T00:00:00Z", notes, ...over });
const asDb = (db: MemDb) => db as unknown as ConsultDb;
const run = (db: MemDb, over: Partial<Parameters<typeof saveReview>[1]> = {}) =>
  saveReview(asDb(db), { orgId: ORG, leadId: LEAD, noteId: "n-1", rev: "0", input: input(), reviewer, now: NOW, ...over });

describe("saveReview", () => {
  it("marks the details reviewed by the caller and bumps the revision", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({ summary: "kept" }, extracted()))] });
    const r = await run(db);
    expect(r).toMatchObject({ ok: true, noteId: "n-1", created: false });
    const stored = db.tables.crm_consult_note[0].notes as Row;
    expect(stored.summary).toBe("kept");
    expect(stored.consult_details).toMatchObject({
      rev: 1,
      review: { reviewed_by: "u1", reviewed_by_name: "Dawn", reviewed_by_role: "paralegal", reviewed_at: NOW.toISOString() },
      marks: [{ id: "m1", filing_basis: "1a", extracted_basis: "1b" }],
    });
  });

  it("makes the write conditional on the revision it read", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()))] });
    await run(db);
    expect(db.writes("crm_consult_note", "update")[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: "n-1" },
        { kind: "eq", column: "lead_id", value: LEAD },
        { kind: "eq", column: "notes->consult_details->>rev", value: "0" },
      ]),
    );
  });

  it("refuses a form opened at an older revision, and writes nothing", async () => {
    const reviewedOnce = { ...extracted(), rev: 3 };
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, reviewedOnce))] });
    expect(await run(db, { rev: "2" })).toEqual({ ok: false, error: SAVE_STALE });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("refuses when someone saves between our read and our write", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()))] });
    db.beforeWrite = (table, op) => {
      if (table === "crm_consult_note" && op === "update") {
        db.tables.crm_consult_note[0].notes = withConsultDetails({}, { ...extracted(), rev: 1, marks: [] });
      }
    };
    expect(await run(db)).toEqual({ ok: false, error: SAVE_STALE });
    expect(((db.tables.crm_consult_note[0].notes as Row).consult_details as StoredConsultDetails).marks).toEqual([]);
  });

  it("won't replace details it can't read", async () => {
    const db = new MemDb({ crm_consult_note: [note({ consult_details: { version: 1 } })] });
    const r = await run(db, { rev: "none" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be read/) });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("adds a hand-entered record to a note that has none, but only from a form that saw none", async () => {
    const db = new MemDb({ crm_consult_note: [note({ summary: "Wants SANKOFA." })] });
    const ok = await run(db, { rev: "none", input: { ...input(), marks: [{ ...input().marks[0], id: null }] } });
    expect(ok).toMatchObject({ ok: true, details: { rev: 1, extracted: null } });
    expect(db.writes("crm_consult_note", "update")[0].filters).toContainEqual({ kind: "is", column: "notes->consult_details", value: null });
    // a form that thought there was nothing, when there now is something, is stale
    const db2 = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()))] });
    expect(await run(db2, { rev: "none" })).toEqual({ ok: false, error: SAVE_STALE });
  });

  it("creates a consult note for a consult the system has no transcript of", async () => {
    const db = new MemDb({ crm_consult_note: [] });
    const r = await run(db, { noteId: null, rev: "none", input: { ...input(), marks: [{ ...input().marks[0], id: null }] } });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(db.tables.crm_consult_note).toHaveLength(1);
    expect(db.tables.crm_consult_note[0]).toMatchObject({ org_id: ORG, lead_id: LEAD, transcript_source: "manual" });
    expect((db.tables.crm_consult_note[0].notes as Row).consult_details).toMatchObject({ rev: 1, review: { reviewed_by: "u1" }, extracted: null });
    // and a stale "create" is refused rather than adding a second note
    expect(await run(db, { noteId: null, rev: "1" })).toEqual({ ok: false, error: SAVE_STALE });
  });

  it("doesn't find a note under a different lead (or another firm)", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()), { lead_id: "lead-2" })] });
    expect(await run(db)).toMatchObject({ ok: false, error: expect.stringMatching(/wasn't found/) });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("a database failure is a plain message, not a raised error", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()))] });
    db.failTables.add("crm_consult_note");
    expect(await run(db)).toEqual({ ok: false, error: SAVE_FAILED });
  });

  it("keeps unknown as unknown when that is what the reviewer chose", async () => {
    const db = new MemDb({ crm_consult_note: [note(withConsultDetails({}, extracted()))] });
    const r = await run(db, { input: input("unknown") });
    expect(r).toMatchObject({ ok: true, details: { marks: [{ filing_basis: "unknown", extracted_basis: "1b" }] } });
  });
});
