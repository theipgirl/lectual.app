import { describe, expect, it, vi } from "vitest";
import { applyReview, normalizeExtraction, withConsultDetails, type ReviewInput, type StoredConsultDetails } from "@/lib/consult/details";
import { openMatterForAcceptedQuote } from "@/lib/quotes/accept-matter";
import { FakeDb, type Row } from "../quotes/fake-db";
import { MemDb } from "./memdb";

/**
 * "When a matter is opens for that lead, carry the reviewed basis and marks
 * onto the matter's existing IP fields" — both ways a matter opens: a signed
 * quote (service role, fenced by the quote's org) and the hired stage (the
 * caller's scoped client).
 *
 * The properties pinned here: only a REVIEWED record carries; `unknown` never
 * becomes a basis; a basis is never attached to a different mark than the one
 * being filed; another firm's consult is never read; and a failed read neither
 * blocks the matter nor passes for "no consult details".
 */

const ORG = "org-a";
const OTHER = "org-b";
const LEAD = "lead-1";
const NOW = new Date("2026-10-09T15:00:00.000Z");
const reviewer = { userId: "u1", name: "Dawn", role: "paralegal" };

const markIn = (over: Partial<ReviewInput["marks"][number]> = {}): ReviewInput["marks"][number] => ({
  id: null,
  mark: "HALCYON",
  mark_type: "word",
  filing_basis: "1b",
  first_use_date: null,
  classes: [
    { class: 35, goods: "Online retail store services" },
    { class: 25, goods: "Clothing, namely t-shirts" },
  ],
  ...over,
});

function reviewed(marks: ReviewInput["marks"] = [markIn()]): StoredConsultDetails {
  return applyReview(null, { marks, recommended_package: null, discount_discussed: null }, reviewer, NOW);
}
function unreviewed(): StoredConsultDetails {
  return normalizeExtraction(
    { marks: [{ mark: "HALCYON", mark_type: "word", classes: [{ class: 25, goods: "T-shirts" }], filing_basis: "1b", basis_evidence: "Not launched.", first_use_date: null }], recommended_package: null, discount_discussed: null },
    { now: NOW, source: "post-consult-agent", sourceText: "HALCYON t-shirts in class 25. Not launched." },
  )!;
}
const consultNote = (details: StoredConsultDetails, over: Row = {}): Row => ({
  id: "n-1",
  org_id: ORG,
  lead_id: LEAD,
  created_at: "2026-10-01T00:00:00Z",
  transcript_source: "fathom",
  notes: withConsultDetails({ summary: "x" }, details),
  ...over,
});

/* ───────────────────────── the signed-quote path ───────────────────────── */

function quoteDb(notes: Row[], leadMark: string | null = "HALCYON", quote: Row = {}): FakeDb {
  const db = new FakeDb({
    crm_quote: [{ id: "q-1", org_id: ORG, status: "accepted", lead_id: LEAD, matter_id: null, ...quote }],
    crm_lead: [{ id: LEAD, org_id: ORG, first_name: "Nadia", last_name: "Petra", business_name: "Halcyon Rowe LLC", mark_text: leadMark, referral_source: null, current_stage_id: null }],
    crm_lead_tag: [],
    crm_tag: [],
    crm_matter_stage: [{ id: "st-intake", org_id: ORG, order_index: 10, is_open: true }],
    crm_matter: [],
    crm_stage: [],
    crm_quote_event: [],
    crm_activity: [],
    crm_consult_note: notes,
  });
  db.unique = { crm_matter: [["org_id", "matter_number"]] };
  return db;
}
const openFrom = (db: FakeDb) => openMatterForAcceptedQuote(db, { quoteId: "q-1", orgId: ORG }, { packageName: "Enhanced", now: NOW });
const matterOf = (db: FakeDb) => db.tables.crm_matter[0];
const activityPayload = (db: FakeDb) => db.tables.crm_activity.find((a) => a.type === "matter_opened")!.payload as Record<string, unknown>;

describe("signed quote → matter", () => {
  it("puts the reviewed basis, classes and goods/services on the matter's own columns", async () => {
    const db = quoteDb([consultNote(reviewed())]);
    expect((await openFrom(db)).status).toBe("opened");
    expect(matterOf(db)).toMatchObject({
      mark_text: "HALCYON",
      filing_basis: "1b",
      international_classes: [25, 35],
      goods_services: "Class 35: Online retail store services\nClass 25: Clothing, namely t-shirts",
    });
    expect(activityPayload(db)).toMatchObject({
      source: "quote_accepted",
      consult_details: { carried: ["filing_basis", "international_classes", "goods_services"], skipped: null },
    });
  });

  it("takes the mark from the reviewed consult when neither the quote nor the lead named one", async () => {
    const db = quoteDb([consultNote(reviewed())], null);
    await openFrom(db);
    expect(matterOf(db)).toMatchObject({ mark_text: "HALCYON", filing_basis: "1b" });
  });

  it("carries NOTHING from details nobody has reviewed — and the timeline says why", async () => {
    const db = quoteDb([consultNote(unreviewed())]);
    await openFrom(db);
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(matterOf(db).international_classes).toBeUndefined();
    expect(matterOf(db).goods_services).toBeUndefined();
    expect(activityPayload(db)).toMatchObject({ consult_details: { carried: [], skipped: "not_reviewed" } });
  });

  it("never turns an unknown basis into a value (the rest still carries)", async () => {
    const db = quoteDb([consultNote(reviewed([markIn({ filing_basis: "unknown" })]))]);
    await openFrom(db);
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(matterOf(db).international_classes).toEqual([25, 35]);
    expect(activityPayload(db)).toMatchObject({ consult_details: { carried: ["international_classes", "goods_services"] } });
  });

  it("doesn't hang a basis on a different mark than the one the client signed for", async () => {
    const terms = "SCOPE\n\nThe Firm will represent you in connection with the mark ROWE & CO, performing the services itemised above.";
    const db = quoteDb([consultNote(reviewed())], "HALCYON", { terms_body: terms });
    await openFrom(db);
    expect(matterOf(db).mark_text).toBe("ROWE & CO");
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(activityPayload(db)).toMatchObject({ consult_details: { carried: [], skipped: "mark_mismatch" } });
  });

  it("with several reviewed marks and no mark known, leaves the choice to staff", async () => {
    const db = quoteDb([consultNote(reviewed([markIn(), markIn({ mark: "ROWE" })]))], null);
    await openFrom(db);
    expect(matterOf(db).mark_text).toBeNull();
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(activityPayload(db)).toMatchObject({ consult_details: { skipped: "ambiguous_marks" } });
  });

  it("takes the right mark out of several when the matter is for one of them", async () => {
    const db = quoteDb([consultNote(reviewed([markIn(), markIn({ mark: "ROWE", filing_basis: "1a", classes: [{ class: 9, goods: "Apps" }] })]))], "ROWE");
    await openFrom(db);
    expect(matterOf(db)).toMatchObject({ mark_text: "ROWE", filing_basis: "1a", international_classes: [9], goods_services: "Class 9: Apps" });
  });

  it("never reads another firm's consult note, even for a lead id that matches", async () => {
    const db = quoteDb([consultNote(reviewed(), { org_id: OTHER })]);
    await openFrom(db);
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(activityPayload(db).consult_details).toBeUndefined();
    expect(db.selects.filter((s) => s.table === "crm_consult_note")).toHaveLength(1);
  });

  it("a failed consult read does not block the matter, and is not mistaken for 'no details'", async () => {
    const db = quoteDb([consultNote(reviewed())]);
    db.failTable = "crm_consult_note";
    expect((await openFrom(db)).status).toBe("opened");
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(activityPayload(db)).toMatchObject({ consult_details: { carried: [], skipped: "unavailable" } });
  });

  it("puts no trademark basis or Nice classes on a copyright matter", async () => {
    const db = quoteDb([consultNote(reviewed())]);
    db.tables.crm_lead_tag.push({ lead_id: LEAD, org_id: ORG, tag_id: "t-cr" });
    db.tables.crm_tag.push({ id: "t-cr", org_id: ORG, dimension: "PA", code: "PA-COPYRIGHT" });
    expect((await openFrom(db)).status).toBe("opened");
    expect(matterOf(db).type).toBe("CR");
    expect(matterOf(db).filing_basis).toBeUndefined();
    expect(matterOf(db).international_classes).toBeUndefined();
    expect(matterOf(db).goods_services).toBeUndefined();
    expect(activityPayload(db)).toMatchObject({ consult_details: { carried: [], skipped: "not_trademark" } });
  });

  it("opens the matter exactly as before when the lead has no consult details at all", async () => {
    const db = quoteDb([]);
    await openFrom(db);
    expect(Object.keys(matterOf(db))).not.toContain("filing_basis");
    expect(activityPayload(db)).toEqual({ matter_number: "TM-2026-0001", auto: true, source: "quote_accepted", quote_id: "q-1" });
  });
});

/* ─────────────────────────── the hired-stage path ──────────────────────── */

const scoped = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => scoped.db }));
const { ensureMatterForLead } = await import("@/lib/matters/matters");

function stageDb(notes: Row[], leadMark: string | null = "HALCYON"): MemDb {
  const db = new MemDb({
    crm_matter: [],
    crm_lead: [{ id: LEAD, org_id: ORG, first_name: "Nadia", last_name: "Petra", business_name: "Halcyon Rowe LLC", mark_text: leadMark }],
    crm_lead_tag: [],
    crm_tag: [],
    crm_consult_note: notes,
    crm_activity: [],
  });
  db.rpcResults = { current_org_role: "attorney", current_org_id: ORG };
  scoped.db = db;
  return db;
}
const stageActivity = (db: MemDb) => db.tables.crm_activity.find((a) => a.type === "matter_opened")!.payload as Record<string, unknown>;

describe("hired stage → matter", () => {
  it("carries the reviewed basis, classes, goods and the lead's mark", async () => {
    const db = stageDb([consultNote(reviewed())]);
    const matter = await ensureMatterForLead(LEAD);
    expect(matter).toMatchObject({
      lead_id: LEAD,
      mark_text: "HALCYON",
      filing_basis: "1b",
      international_classes: [25, 35],
      goods_services: "Class 35: Online retail store services\nClass 25: Clothing, namely t-shirts",
    });
    expect(stageActivity(db)).toMatchObject({
      source: "hired_stage",
      consult_details: { carried: ["filing_basis", "international_classes", "goods_services"], skipped: null },
    });
  });

  it("is only the signed-in caller's reading: the consult is read under their own client, with no org filter of ours", async () => {
    const db = stageDb([consultNote(reviewed())]);
    await ensureMatterForLead(LEAD);
    const read = db.log.find((q) => q.table === "crm_consult_note")!;
    expect(read.filters).toEqual([{ kind: "eq", column: "lead_id", value: LEAD }]);
  });

  it("carries nothing from unreviewed details, and the matter is created exactly as before", async () => {
    const db = stageDb([consultNote(unreviewed())]);
    const matter = await ensureMatterForLead(LEAD);
    expect(matter?.filing_basis ?? null).toBeNull();
    expect(matter?.international_classes ?? null).toBeNull();
    // Without a carry the lead's mark is still not copied onto the matter, as it never was here.
    expect(matter?.mark_text ?? null).toBeNull();
    expect(stageActivity(db)).toMatchObject({ consult_details: { carried: [], skipped: "not_reviewed" } });
  });

  it("never carries an unknown basis", async () => {
    stageDb([consultNote(reviewed([markIn({ filing_basis: "unknown" })]))]);
    const matter = await ensureMatterForLead(LEAD);
    expect(matter?.filing_basis ?? null).toBeNull();
    expect(matter?.international_classes).toEqual([25, 35]);
  });

  it("uses the consult's mark when the lead has none, and refuses a basis for a different mark", async () => {
    stageDb([consultNote(reviewed())], null);
    expect((await ensureMatterForLead(LEAD))?.mark_text).toBe("HALCYON");
    const db = stageDb([consultNote(reviewed())], "ROWE");
    const matter = await ensureMatterForLead(LEAD);
    expect(matter?.filing_basis ?? null).toBeNull();
    expect(stageActivity(db)).toMatchObject({ consult_details: { skipped: "mark_mismatch" } });
  });

  it("a failed consult read does not stop the matter opening, and the timeline says it wasn't carried", async () => {
    const db = stageDb([consultNote(reviewed())]);
    db.failTables.add("crm_consult_note");
    const matter = await ensureMatterForLead(LEAD);
    expect(matter).not.toBeNull();
    expect(matter?.filing_basis ?? null).toBeNull();
    expect(stageActivity(db)).toMatchObject({ consult_details: { carried: [], skipped: "unavailable" } });
  });

  it("puts no trademark basis or Nice classes on a patent matter", async () => {
    const db = stageDb([consultNote(reviewed())]);
    db.tables.crm_lead_tag.push({ lead_id: LEAD, org_id: ORG, tag_id: "t-pat" });
    db.tables.crm_tag.push({ id: "t-pat", org_id: ORG, dimension: "PA", code: "PA-PATENT" });
    const matter = await ensureMatterForLead(LEAD);
    expect(matter?.type).toBe("PATENT");
    expect(matter?.filing_basis ?? null).toBeNull();
    expect(matter?.international_classes ?? null).toBeNull();
    expect(stageActivity(db)).toMatchObject({ consult_details: { carried: [], skipped: "not_trademark" } });
  });

  it("still opens at most one matter per lead", async () => {
    stageDb([consultNote(reviewed())]);
    expect(await ensureMatterForLead(LEAD)).not.toBeNull();
    expect(await ensureMatterForLead(LEAD)).toBeNull();
  });
});
