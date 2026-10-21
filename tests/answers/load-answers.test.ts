import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDb } from "../matters/helpers/fake-db";
import { BUSINESS_ANSWERS, ASSESSMENT_FORM_ID, OTHER_ORG, assessmentAnswers, assessmentFormRow, boothRow, formRow, newDb, submissionRow, mockScopedDb } from "../intake-forms/helpers/forms-db";

/** Sprint 9 F5: the loader's columns, cap, completed-only requests, per-source failure and missing table. */

async function load(db: FakeDb) {
  vi.resetModules();
  mockScopedDb(db);
  return import("../../src/lib/answers/load-answers");
}

const a = assessmentAnswers(BUSINESS_ANSWERS);

function seed(): FakeDb {
  return newDb({
    crm_intake_form: [formRow(), assessmentFormRow()],
    crm_intake_submission: [
      submissionRow("s1", { lead_id: "lead-1", answers: [{ id: "q", question: "Name?", answer: "SANKOFA" }], started_at: "2026-10-18T15:00:00Z" }),
      submissionRow("s2", { lead_id: "lead-1", form_id: ASSESSMENT_FORM_ID, mode: "assessment", answers: a.answerList, score: a.score.score, band: a.score.band, temperature: a.score.temperature, started_at: "2026-10-19T15:00:00Z" }),
      submissionRow("s3", { lead_id: "lead-2" }),
      submissionRow("s4", { lead_id: "lead-1", org_id: OTHER_ORG }),
    ],
    crm_booth_scorecard: [
      boothRow("b1", { lead_id: "lead-1", completed_at: "2026-10-17T15:03:00Z", score: 40, band: "partial", temperature: "warm", track: "business", answers: { "1": "business" } }),
      boothRow("b2", { lead_id: "lead-2" }),
    ],
    crm_intake_request: [
      { id: "r1", org_id: "org-1", matter_id: "matter-1", status: "completed", sent_at: "2026-10-10T10:00:00Z", completed_at: "2026-10-12T10:00:00Z", answers: [{ id: "q", question: "Owner?", answer: "Acme" }], token: "SECRET-TOKEN" },
      { id: "r2", org_id: "org-1", matter_id: "matter-1", status: "sent", sent_at: "2026-10-11T10:00:00Z", completed_at: null, answers: null, token: "t2" },
      { id: "r3", org_id: "org-1", matter_id: "matter-1", status: "revoked", sent_at: "2026-10-11T10:00:00Z", completed_at: null, answers: null, token: "t3" },
      { id: "r4", org_id: "org-1", matter_id: "matter-9", status: "completed", sent_at: "2026-10-11T10:00:00Z", completed_at: "2026-10-12T10:00:00Z", answers: [], token: "t4" },
    ],
  });
}

let db: FakeDb;
beforeEach(() => {
  db = seed();
});

describe("loadLeadAnswers", () => {
  it("reads this lead's submissions (with the form name and kind) and booth scorecards, and skips requests", async () => {
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-1");
    expect(read.requests).toEqual({ status: "skipped" });
    if (read.submissions.status !== "ok" || read.booth.status !== "ok") throw new Error("expected ok");
    // Newest first.
    expect(read.submissions.items.map((i) => i.id)).toEqual(["s2", "s1"]);
    expect(read.submissions.items[0]).toMatchObject({ kind: "submission", formName: "Booth assessment", formKind: "assessment" });
    expect(read.submissions.items[1]).toMatchObject({ formName: "UGW 2026 booth", formKind: "intake" });
    expect(read.booth.items.map((i) => i.id)).toEqual(["b1"]);
    expect(db.froms).not.toContain("crm_intake_request");
  });

  it("returns an empty ok (not a failure) for a lead with nothing", async () => {
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-none");
    expect(read.submissions).toEqual({ status: "ok", items: [], capped: false });
    expect(read.booth).toEqual({ status: "ok", items: [], capped: false });
  });

  it("names only the columns the card shows: never consent, Lawmatics ids, tokens or the resume hash", async () => {
    const { loadLeadAnswers } = await load(db);
    await loadLeadAnswers("lead-1");
    const cols = db.selects.map(([t, c]) => `${t}: ${c}`);
    expect(cols).toContain("crm_booth_scorecard: id, event_code, track, score, band, temperature, answers, gaps, created_at, completed_at");
    expect(cols).toContain("crm_intake_submission: id, form_id, mode, answers, started_at, submitted_at, score, band, temperature");
    for (const [, c] of db.selects) {
      expect(c).not.toContain("*");
      expect(c).not.toMatch(/consent|lawmatics|resume_hash|token|ticket_code|client_ref|screening_note|contact\b/);
    }
    expect(db.writes).toEqual([]);
  });

  it("caps each source at 200 rows and says so", async () => {
    const many = Array.from({ length: 205 }, (_, i) => submissionRow(`m${i}`, { lead_id: "lead-big", started_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
    db = newDb({ crm_intake_submission: many });
    const { loadLeadAnswers, ANSWERS_ROW_LIMIT } = await load(db);
    const read = await loadLeadAnswers("lead-big");
    expect(ANSWERS_ROW_LIMIT).toBe(200);
    if (read.submissions.status !== "ok") throw new Error("expected ok");
    expect(read.submissions.items).toHaveLength(200);
    expect(read.submissions.capped).toBe(true);
    expect(read.booth).toMatchObject({ status: "ok", capped: false });
  });

  it("reports a failing source as unavailable and still returns the other", async () => {
    db.fail("crm_booth_scorecard", "select");
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-1");
    expect(read.booth).toEqual({ status: "unavailable" });
    expect(read.submissions.status).toBe("ok");
  });

  it("reports a failing form-name read as unavailable for submissions rather than showing nameless ones", async () => {
    db.fail("crm_intake_form", "select");
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-1");
    expect(read.submissions).toEqual({ status: "unavailable" });
    expect(read.booth.status).toBe("ok");
  });

  it("reports a missing table as unconfigured, not as empty or failed", async () => {
    db.fail("crm_booth_scorecard", "select", { code: "PGRST205", message: "Could not find the table" });
    db.fail("crm_intake_submission", "select", { code: "42P01", message: "relation does not exist" });
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-1");
    expect(read.booth).toEqual({ status: "unconfigured" });
    expect(read.submissions).toEqual({ status: "unconfigured" });
  });

  it("never throws when the scoped client itself fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => Promise.reject(new Error("no cookies"))) }));
    const { loadLeadAnswers, loadMatterAnswers } = await import("../../src/lib/answers/load-answers");
    expect(await loadLeadAnswers("lead-1")).toEqual({ submissions: { status: "unavailable" }, booth: { status: "unavailable" }, requests: { status: "skipped" } });
    expect((await loadMatterAnswers("matter-1", "lead-1")).requests).toEqual({ status: "unavailable" });
    expect((await loadMatterAnswers("matter-1", null)).submissions).toEqual({ status: "skipped" });
  });
});

describe("loadMatterAnswers", () => {
  it("reads the matter's completed requests only, plus the lead's submissions and booth cards", async () => {
    const { loadMatterAnswers } = await load(db);
    const read = await loadMatterAnswers("matter-1", "lead-1");
    if (read.requests.status !== "ok") throw new Error("expected ok");
    expect(read.requests.items.map((i) => i.id)).toEqual(["r1"]);
    expect(read.submissions.status).toBe("ok");
    expect(read.booth.status).toBe("ok");
    const requestSelect = db.selects.find(([t]) => t === "crm_intake_request")![1];
    expect(requestSelect).toBe("id, status, sent_at, completed_at, answers");
    expect(requestSelect).not.toContain("token");
  });

  it("for a matter with no lead reads only the matter's own requests, with no error", async () => {
    const { loadMatterAnswers } = await load(db);
    const read = await loadMatterAnswers("matter-1", null);
    expect(read.submissions).toEqual({ status: "skipped" });
    expect(read.booth).toEqual({ status: "skipped" });
    expect(read.requests.status).toBe("ok");
    expect(db.froms).not.toContain("crm_intake_submission");
    expect(db.froms).not.toContain("crm_booth_scorecard");
  });

  it("cannot see another firm's rows (they are invisible through the scoped client)", async () => {
    const { loadLeadAnswers } = await load(db);
    const read = await loadLeadAnswers("lead-1");
    if (read.submissions.status !== "ok") throw new Error("expected ok");
    expect(read.submissions.items.map((i) => i.id)).not.toContain("s4");
  });
});
