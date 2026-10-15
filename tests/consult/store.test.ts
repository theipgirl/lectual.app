import { describe, expect, it } from "vitest";
import {
  applyReview,
  normalizeExtraction,
  withConsultDetails,
  type ConsultDetailsExtract,
  type StoredConsultDetails,
} from "@/lib/consult/details";
import {
  carryPayload,
  consultCarryForLead,
  findOrCreateMeetingNote,
  loadConsultEntries,
  loadReviewedConsult,
  meetingNoteRef,
  saveExtraction,
  saveMeetingExtraction,
  type ConsultDb,
} from "@/lib/consult/store";
import { MemDb, type Row } from "./memdb";

const ORG = "org-a";
const OTHER = "org-b";
const LEAD = "lead-1";
const NOW = new Date("2026-10-09T12:00:00.000Z");

const extraction: ConsultDetailsExtract = {
  marks: [
    {
      mark: "SANKOFA",
      mark_type: "word",
      classes: [{ class: 25, goods: "Clothing, namely t-shirts" }],
      filing_basis: "1b",
      basis_evidence: "Nothing has been sold yet.",
      first_use_date: null,
    },
  ],
  recommended_package: "Enhanced",
  discount_discussed: null,
};

/** What the model was given: the evidence, the class number. */
const SOURCE = "Summary: Wants SANKOFA for t-shirts, class 25. Nothing has been sold yet.";
const extracted = (): StoredConsultDetails => normalizeExtraction(extraction, { now: NOW, source: "post-consult-agent", sourceText: SOURCE })!;
const reviewed = (): StoredConsultDetails =>
  applyReview(extracted(), { marks: [{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1a", first_use_date: null, classes: [{ class: 25, goods: "Hats" }] }], recommended_package: null, discount_discussed: null }, { userId: "u1", name: "Dawn", role: "paralegal" }, NOW);

function note(over: Row = {}): Row {
  return { id: "n-1", org_id: ORG, lead_id: LEAD, created_at: "2026-10-01T09:00:00Z", transcript_source: "fathom", raw_transcript_ref: "ext-1", notes: { summary: "Wants SANKOFA." }, ...over };
}
const dbOf = (notes: Row[]) => new MemDb({ crm_consult_note: notes });
const asDb = (db: MemDb) => db as unknown as ConsultDb;

describe("loadConsultEntries: three states, never two", () => {
  it("reads each note's details as absent, readable or unreadable", async () => {
    const db = dbOf([
      note({ id: "n-none", created_at: "2026-10-03T00:00:00Z" }),
      note({ id: "n-ok", created_at: "2026-10-02T00:00:00Z", notes: withConsultDetails({ summary: "x" }, extracted()) }),
      note({ id: "n-bad", created_at: "2026-10-01T00:00:00Z", notes: { consult_details: { version: 1 } } }),
      note({ id: "n-elsewhere", org_id: OTHER, lead_id: "lead-9" }),
    ]);
    const read = await loadConsultEntries(asDb(db), LEAD, ORG);
    expect(read).toMatchObject({ status: "ok" });
    if (read.status !== "ok") return;
    expect(read.entries.map((e) => [e.noteId, e.read.kind])).toEqual([
      ["n-none", "none"],
      ["n-ok", "ok"],
      ["n-bad", "invalid"],
    ]);
  });

  it("says unavailable when the read fails — never an empty list", async () => {
    const db = dbOf([note()]);
    db.failTables.add("crm_consult_note");
    expect(await loadConsultEntries(asDb(db), LEAD, ORG)).toEqual({ status: "unavailable" });
  });

  it("an empty result is ok-with-nothing, which is a different answer from unavailable", async () => {
    expect(await loadConsultEntries(asDb(dbOf([])), LEAD, ORG)).toEqual({ status: "ok", entries: [] });
  });

  it("fences on the org when given one (the service-role callers)", async () => {
    const db = dbOf([note({ org_id: OTHER })]);
    const read = await loadConsultEntries(asDb(db), LEAD, ORG);
    expect(read).toEqual({ status: "ok", entries: [] });
    expect(db.log[0].filters).toContainEqual({ kind: "eq", column: "org_id", value: ORG });
  });
});

describe("saveExtraction", () => {
  it("stores the extraction beside the notes lectual wrote, on that note only, fenced by org", async () => {
    const db = dbOf([note(), note({ id: "n-2", notes: { summary: "other" } })]);
    const result = await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW });
    expect(result).toBe("saved");
    const stored = db.tables.crm_consult_note.find((r) => r.id === "n-1")!.notes as Row;
    expect(stored.summary).toBe("Wants SANKOFA.");
    expect(stored.consult_details).toMatchObject({ version: 1, rev: 0, review: null, marks: [{ mark: "SANKOFA", filing_basis: "1b" }] });
    expect((db.tables.crm_consult_note.find((r) => r.id === "n-2")!.notes as Row).consult_details).toBeUndefined();
    for (const w of db.writes("crm_consult_note")) expect(w.filters).toContainEqual({ kind: "eq", column: "org_id", value: ORG });
  });

  it("writes only if the key is still absent", async () => {
    const db = dbOf([note()]);
    await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW });
    expect(db.writes("crm_consult_note", "update")[0].filters).toContainEqual({ kind: "is", column: "notes->consult_details", value: null });
  });

  it("never overwrites details that are already there: reviewed, typed by hand, or unreadable", async () => {
    for (const existing of [reviewed(), extracted(), { version: 1, junk: true }]) {
      const db = dbOf([note({ notes: { summary: "x", consult_details: existing } })]);
      expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("kept");
      expect(db.writes("crm_consult_note")).toHaveLength(0);
      expect((db.tables.crm_consult_note[0].notes as Row).consult_details).toEqual(existing);
    }
  });

  it("loses a race gracefully: a person saving between our read and our write wins", async () => {
    const human = reviewed();
    const db = dbOf([note()]);
    db.beforeWrite = (table, op) => {
      if (table === "crm_consult_note" && op === "update") db.tables.crm_consult_note[0].notes = { summary: "x", consult_details: human };
    };
    expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("kept");
    expect((db.tables.crm_consult_note[0].notes as Row).consult_details).toEqual(human);
  });

  it("stores nothing for an answer that isn't the expected shape", async () => {
    const db = dbOf([note()]);
    expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction: { marks: "SANKOFA" }, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("nothing");
    expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction: undefined, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("nothing");
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("reports a failure instead of throwing — the draft it rides on is already queued", async () => {
    const db = dbOf([note()]);
    db.failTables.add("crm_consult_note");
    expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("failed");
    const boom = { from: () => { throw new Error("socket closed"); } } as unknown as ConsultDb;
    expect(await saveExtraction(boom, { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("failed");
  });

  it("won't write to a note in another firm", async () => {
    const db = dbOf([note({ org_id: OTHER })]);
    expect(await saveExtraction(asDb(db), { orgId: ORG, noteId: "n-1", extraction, source: "post-consult-agent", sourceText: SOURCE, now: NOW })).toBe("failed");
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });
});

describe("a meeting's extraction", () => {
  const args = { orgId: ORG, leadId: LEAD, meetingId: "mtg-1", provider: "fathom", extraction, sourceText: SOURCE, now: NOW };

  it("goes on its own note for the lead, keyed to the meeting", async () => {
    const db = dbOf([]);
    expect(await saveMeetingExtraction(asDb(db), args)).toBe("saved");
    expect(db.tables.crm_consult_note).toHaveLength(1);
    expect(db.tables.crm_consult_note[0]).toMatchObject({ org_id: ORG, lead_id: LEAD, transcript_source: "fathom", raw_transcript_ref: meetingNoteRef("mtg-1") });
    expect((db.tables.crm_consult_note[0].notes as Row).consult_details).toMatchObject({ extracted: { source: "meeting-follow-up", meeting_id: "mtg-1" } });
  });

  it("never claims lectual's own note for the same recording (that would get it drafted twice)", async () => {
    const lectualNote = note({ id: "n-lectual", lead_id: null, raw_transcript_ref: "mtg-ext-1", notes: { summary: "Wants SANKOFA.", next_step: "Send the engagement letter." } });
    const db = dbOf([lectualNote]);
    await saveMeetingExtraction(asDb(db), args);
    const untouched = db.tables.crm_consult_note.find((r) => r.id === "n-lectual")!;
    expect(untouched.lead_id).toBeNull();
    expect((untouched.notes as Row).consult_details).toBeUndefined();
    expect(db.tables.crm_consult_note).toHaveLength(2);
    const ours = db.tables.crm_consult_note.find((r) => r.id !== "n-lectual")!;
    // no summary and no next step: the post-consult agent skips it
    expect(Object.keys(ours.notes as Row)).toEqual(["consult_details"]);
  });

  it("reuses the meeting's note on a second run and doesn't touch what is there", async () => {
    const db = dbOf([]);
    await saveMeetingExtraction(asDb(db), args);
    expect(await saveMeetingExtraction(asDb(db), args)).toBe("kept");
    expect(db.tables.crm_consult_note).toHaveLength(1);
  });

  it("creates no note at all when there is nothing usable, so no consult is implied", async () => {
    const db = dbOf([]);
    expect(await saveMeetingExtraction(asDb(db), { ...args, extraction: { nonsense: true } })).toBe("nothing");
    expect(db.tables.crm_consult_note).toHaveLength(0);
  });

  it("finds an existing note by lead and meeting, within the org", async () => {
    const db = dbOf([note({ id: "n-m", raw_transcript_ref: meetingNoteRef("mtg-1") }), note({ id: "n-m-other", org_id: OTHER, raw_transcript_ref: meetingNoteRef("mtg-1") })]);
    expect(await findOrCreateMeetingNote(asDb(db), args)).toEqual({ id: "n-m" });
  });

  it("reports failure when the note can't be found or made", async () => {
    const db = dbOf([]);
    db.failTables.add("crm_consult_note");
    expect(await saveMeetingExtraction(asDb(db), args)).toBe("failed");
  });
});

describe("what a matter may take from the lead's consult", () => {
  const withDetails = (id: string, details: StoredConsultDetails, created = "2026-10-01T00:00:00Z") =>
    note({ id, created_at: created, notes: withConsultDetails({ summary: "x" }, details) });

  it("never falls back to an older reviewed record while a newer one waits for review", async () => {
    // A later consult may have changed the basis; the old answer is not "reviewed" for it.
    const db = dbOf([withDetails("n-new", extracted(), "2026-10-05T00:00:00Z"), withDetails("n-old", reviewed(), "2026-10-02T00:00:00Z")]);
    expect(await loadReviewedConsult(asDb(db), LEAD, ORG)).toEqual({ status: "ok", details: null, unreadable: false, unreviewed: true });
    expect(await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" })).toEqual({ fields: {}, carried: [], skipped: "not_reviewed" });
  });

  it("nor while a newer one can't be read", async () => {
    const db = dbOf([note({ id: "n-bad", created_at: "2026-10-05T00:00:00Z", notes: { consult_details: { version: 1 } } }), withDetails("n-old", reviewed(), "2026-10-02T00:00:00Z")]);
    expect((await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" })).skipped).toBe("unreadable");
  });

  it("passes over newer notes that hold no details at all, and takes the reviewed one", async () => {
    const db = dbOf([note({ id: "n-plain", created_at: "2026-10-05T00:00:00Z" }), withDetails("n-old", reviewed(), "2026-10-02T00:00:00Z")]);
    const read = await loadReviewedConsult(asDb(db), LEAD, ORG);
    expect(read.status === "ok" && read.details?.review?.reviewed_by).toBe("u1");
  });

  it("carries nothing onto a patent or copyright matter: a §1 basis and Nice classes are trademark facts", async () => {
    const db = dbOf([withDetails("n-1", reviewed())]);
    for (const matterType of ["PATENT", "CR"]) {
      const carry = await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType });
      expect(carry).toEqual({ fields: {}, carried: [], skipped: "not_trademark" });
      expect(carryPayload(carry)).toEqual({ consult_details: { carried: [], skipped: "not_trademark" } });
    }
    // and with no details at all there is nothing to say, whatever the type
    expect((await consultCarryForLead(asDb(dbOf([note()])), { leadId: LEAD, orgId: ORG, preferredMark: null, matterType: "PATENT" })).skipped).toBe("no_details");
  });

  it("carries the reviewed basis and marks, and says what it carried", async () => {
    const db = dbOf([withDetails("n-1", reviewed())]);
    const carry = await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" });
    expect(carry).toEqual({
      fields: { filingBasis: "1a", internationalClasses: [25], goodsServices: "Class 25: Hats" },
      carried: ["filing_basis", "international_classes", "goods_services"],
      skipped: null,
    });
    expect(carryPayload(carry)).toEqual({ consult_details: { carried: ["filing_basis", "international_classes", "goods_services"], skipped: null } });
  });

  it("carries nothing from unreviewed details, and the payload says so", async () => {
    const db = dbOf([withDetails("n-1", extracted())]);
    const carry = await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" });
    expect(carry).toEqual({ fields: {}, carried: [], skipped: "not_reviewed" });
    expect(carryPayload(carry)).toEqual({ consult_details: { carried: [], skipped: "not_reviewed" } });
  });

  it("with no consult details at all, says nothing — the ordinary case", async () => {
    const carry = await consultCarryForLead(asDb(dbOf([note()])), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" });
    expect(carry.skipped).toBe("no_details");
    expect(carryPayload(carry)).toEqual({});
  });

  it("a failed read is 'unavailable', never 'no details'", async () => {
    const db = dbOf([withDetails("n-1", reviewed())]);
    db.failTables.add("crm_consult_note");
    const carry = await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: "SANKOFA", matterType: "TM" });
    expect(carry).toEqual({ fields: {}, carried: [], skipped: "unavailable" });
    expect(carryPayload(carry)).toEqual({ consult_details: { carried: [], skipped: "unavailable" } });
  });

  it("reports unreadable details as such", async () => {
    const db = dbOf([note({ notes: { consult_details: { version: 1 } } })]);
    expect((await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: null, matterType: "TM" })).skipped).toBe("unreadable");
  });

  it("never throws, whatever the client does", async () => {
    const boom = { from: () => { throw new Error("socket closed"); } } as unknown as ConsultDb;
    expect(await consultCarryForLead(boom, { leadId: LEAD, orgId: ORG, preferredMark: null, matterType: "TM" })).toEqual({ fields: {}, carried: [], skipped: "unavailable" });
  });

  it("reads only the lead's own notes, in the org it was told to", async () => {
    const db = dbOf([withDetails("n-other-org", reviewed()), withDetails("n-other-lead", reviewed())]);
    db.tables.crm_consult_note[0].org_id = OTHER;
    db.tables.crm_consult_note[1].lead_id = "lead-2";
    const carry = await consultCarryForLead(asDb(db), { leadId: LEAD, orgId: ORG, preferredMark: null, matterType: "TM" });
    expect(carry.skipped).toBe("no_details");
    expect(db.log[0].filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "org_id", value: ORG }, { kind: "eq", column: "lead_id", value: LEAD }]));
  });
});
