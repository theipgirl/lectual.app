import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeExtraction, withConsultDetails, type ConsultDetailsExtract } from "@/lib/consult/details";
import { MemDb, type Row } from "./memdb";

/**
 * The two actions that touch consult details from the screen:
 *  - the lead page's review form (its own POST endpoint: session, role and
 *    stale-form checks are re-done there), and
 *  - Meetings "Draft follow-up", which now also files what the call said about
 *    each mark for review. Its draft goes to the approval queue exactly as
 *    before; a failure to file the details never loses or repeats it.
 * The model is always mocked.
 */

const ORG = "org-a";
const LEAD = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const MEETING = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-09T12:00:00.000Z");

const h = vi.hoisted(() => ({
  db: null as unknown,
  session: null as unknown,
  logged: [] as Array<Record<string, unknown>>,
  drafts: [] as Array<Record<string, unknown>>,
  modules: ["agents"] as string[],
  queueKey: "firm-queue" as string | null,
  claude: { output: null as unknown, calls: 0, fail: false },
  meeting: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => h.db }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => h.session }));
vi.mock("@/lib/matters", () => ({
  logActivitySafe: async (input: Record<string, unknown>) => {
    h.logged.push(input);
  },
  ensureMatterForLead: async () => null,
}));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => h.modules.includes(m) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => h.queueKey }));
vi.mock("@/lib/queue/api", () => ({
  createDraft: async (d: Record<string, unknown>) => {
    h.drafts.push(d);
    return { id: `q-${h.drafts.length}` };
  },
}));
vi.mock("@/lib/ai/claude", () => ({
  aiConfigured: () => true,
  callClaude: async () => {
    h.claude.calls += 1;
    if (h.claude.fail) throw new Error("model unavailable");
    return { output: h.claude.output };
  },
}));
vi.mock("@/lib/meetings/read", () => ({ getMeeting: async () => ({ status: "ok", meeting: h.meeting }) }));

const { saveConsultDetailsAction } = await import("@/app/dashboard/leads/[id]/consult-details-actions");
const { draftFollowUpAction } = await import("@/app/dashboard/meetings/actions");

const extraction: ConsultDetailsExtract = {
  marks: [{ mark: "SANKOFA", mark_type: "word", classes: [{ class: 25, goods: "T-shirts" }], filing_basis: "1b", basis_evidence: "Not launched yet.", first_use_date: null }],
  recommended_package: "Enhanced",
  discount_discussed: null,
};

function session(role = "paralegal", kind = "ok") {
  return { kind, role, user: { id: "user-1" }, org: { id: ORG }, displayName: "Dawn" };
}

function reviewForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = {
    leadId: LEAD,
    noteId: NOTE,
    rev: "0",
    markCount: "2",
    m0_id: "m1",
    m0_text: "SANKOFA",
    m0_type: "word",
    m0_basis: "1a",
    m0_first_use: "",
    m0_classes: "25: T-shirts",
    package: "Enhanced",
    discount: "",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function leadDb(notes: Row[] = []) {
  const db = new MemDb({
    crm_lead: [{ id: LEAD, org_id: ORG, first_name: "Amara", last_name: "Nwosu", business_name: null, email: "amara@example.com" }],
    crm_consult_note: notes,
    crm_activity: [],
    crm_org_profile: [],
  });
  h.db = db;
  return db;
}
const withDetails = () =>
  Object.assign({ id: NOTE, org_id: ORG, lead_id: LEAD, created_at: "2026-10-01T00:00:00Z", notes: withConsultDetails({ summary: "x" }, normalizeExtraction(extraction, { now: NOW, source: "post-consult-agent", sourceText: "SANKOFA, class 25. Not launched yet." })!) });

beforeEach(() => {
  h.session = session();
  h.logged = [];
  h.drafts = [];
  h.modules = ["agents"];
  h.queueKey = "firm-queue";
  h.claude = { output: null, calls: 0, fail: false };
});

describe("saveConsultDetailsAction", () => {
  it("saves the review as the SIGNED-IN person — never as a name in the form — and logs it", async () => {
    const db = leadDb([withDetails()]);
    const res = await saveConsultDetailsAction({}, reviewForm({ reviewedBy: "someone-else", reviewed_by: "someone-else" }));
    expect(res).toMatchObject({ ok: true });
    const stored = (db.tables.crm_consult_note[0].notes as Row).consult_details as { review: Row; marks: Row[] };
    expect(stored.review).toMatchObject({ reviewed_by: "user-1", reviewed_by_name: "Dawn", reviewed_by_role: "paralegal" });
    expect(stored.marks[0]).toMatchObject({ filing_basis: "1a", extracted_basis: "1b" });
    expect(h.logged).toEqual([
      {
        type: "lead_updated",
        leadId: LEAD,
        payload: { change: "consult_details", summary: "Reviewed consult details: 1 mark", marks: [{ mark: "SANKOFA", filing_basis: "1a", corrected: true }] },
      },
    ]);
  });

  it("refuses a role that can only view, and writes nothing", async () => {
    h.session = session("viewer");
    const db = leadDb([withDetails()]);
    expect(await saveConsultDetailsAction({}, reviewForm())).toEqual({ error: "Your role can view consult details but not change them." });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    h.session = { kind: "signed-out", redirectTo: "/sign-in/" };
    leadDb([withDetails()]);
    expect(await saveConsultDetailsAction({}, reviewForm())).toEqual({ error: "Sign in again to save this." });
  });

  it("refuses ids that aren't ids, and a form it can't read", async () => {
    const db = leadDb([withDetails()]);
    expect(await saveConsultDetailsAction({}, reviewForm({ leadId: "nope" }))).toEqual({ error: "That lead isn't valid." });
    expect(await saveConsultDetailsAction({}, reviewForm({ noteId: "nope" }))).toEqual({ error: "That consult note isn't valid." });
    expect(await saveConsultDetailsAction({}, reviewForm({ m0_basis: "1c" }))).toMatchObject({ error: expect.any(String) });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("won't save for a lead the caller's firm can't see", async () => {
    const db = leadDb([withDetails()]);
    db.tables.crm_lead = [];
    expect(await saveConsultDetailsAction({}, reviewForm())).toEqual({ error: "Lead not found." });
    expect(db.writes("crm_consult_note")).toHaveLength(0);
  });

  it("refuses a stale form, writes nothing, and logs nothing", async () => {
    const db = leadDb([withDetails()]);
    const res = await saveConsultDetailsAction({}, reviewForm({ rev: "7" }));
    expect(res.error).toMatch(/changed while you had them open/);
    expect(db.writes("crm_consult_note")).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });

  it("records a consult by hand when there is no note yet", async () => {
    const db = leadDb([]);
    const res = await saveConsultDetailsAction({}, reviewForm({ noteId: "", rev: "none", m0_id: "" }));
    expect(res).toMatchObject({ ok: true });
    expect(db.tables.crm_consult_note[0]).toMatchObject({ org_id: ORG, lead_id: LEAD, transcript_source: "manual" });
  });
});

/* ─────────────────────── Meetings → Draft follow-up ─────────────────────── */

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: MEETING,
    provider: "fathom",
    title: "Consult — Amara",
    started_at: "2026-10-08T15:00:00Z",
    lead_id: LEAD,
    matter_id: null,
    summary: "Amara wants SANKOFA for sparkling water. Not launched yet.",
    transcript: [],
    ...over,
  };
}
const followUp = (consult_details: unknown = extraction) => ({ subject: "Great speaking today", body: "Hi Amara…", internal_summary: "Discussed SANKOFA.", consult_details });
const meetingForm = () => {
  const fd = new FormData();
  fd.set("meetingId", MEETING);
  return fd;
};

describe("Meetings → Draft follow-up now also files the consult details", () => {
  it("queues the draft, then files the marks for review on a note keyed to the meeting", async () => {
    const db = leadDb([]);
    h.meeting = meeting();
    h.claude.output = followUp();
    const res = await draftFollowUpAction({}, meetingForm());
    expect(res.ok).toBe(true);
    expect(res.notice).toMatch(/waiting in the approval queue/);
    expect(res.notice).toMatch(/Consult details for review/);
    expect(h.drafts).toHaveLength(1);
    expect(h.drafts[0]).toMatchObject({ type: "CLIENT_EMAIL", recipient: "amara@example.com", subject: "Great speaking today" });
    expect(db.tables.crm_consult_note).toHaveLength(1);
    expect(db.tables.crm_consult_note[0]).toMatchObject({ org_id: ORG, lead_id: LEAD, transcript_source: "fathom", raw_transcript_ref: `lectual.app:meeting:${MEETING}` });
    const stored = (db.tables.crm_consult_note[0].notes as Row).consult_details as Row;
    expect(stored).toMatchObject({ review: null, extracted: { source: "meeting-follow-up", meeting_id: MEETING }, marks: [{ mark: "SANKOFA", filing_basis: "1b" }] });
    // the draft's own record is unchanged
    expect(db.tables.crm_activity[0]).toMatchObject({ type: "queue_drafted", payload: { source: "post-consult", meeting_id: MEETING, queue_id: "q-1" } });
  });

  it("checks the extraction against the meeting it read: a basis quoted from nowhere is stored as unknown", async () => {
    const db = leadDb([]);
    h.meeting = meeting({ summary: "Amara wants SANKOFA for sparkling water." });
    h.claude.output = followUp();
    expect((await draftFollowUpAction({}, meetingForm())).ok).toBe(true);
    const stored = (db.tables.crm_consult_note[0].notes as Row).consult_details as { marks: Row[] };
    // "Not launched yet." is not in the summary, and neither is class 25
    expect(stored.marks[0]).toMatchObject({ mark: "SANKOFA", filing_basis: "unknown", basis_evidence: null, classes: [{ class: null, goods: "T-shirts" }] });
  });

  it("a failure filing the details is told to the caller and never loses or repeats the queued draft", async () => {
    const db = leadDb([]);
    db.failTables.add("crm_consult_note");
    h.meeting = meeting();
    h.claude.output = followUp();
    const res = await draftFollowUpAction({}, meetingForm());
    expect(res.ok).toBe(true);
    expect(res.notice).toMatch(/consult details couldn't be saved/);
    expect(h.drafts).toHaveLength(1);
    // a second click is refused: the draft already exists
    const again = await draftFollowUpAction({}, meetingForm());
    expect(again.error).toMatch(/already in the approval queue/);
    expect(h.drafts).toHaveLength(1);
  });

  it("an unusable extraction files nothing — and creates no consult note, which would imply a consult", async () => {
    const db = leadDb([]);
    h.meeting = meeting();
    h.claude.output = followUp({ marks: "SANKOFA" });
    const res = await draftFollowUpAction({}, meetingForm());
    expect(res.ok).toBe(true);
    expect(res.notice).not.toMatch(/Consult details/);
    expect(db.tables.crm_consult_note).toHaveLength(0);
    expect(h.drafts).toHaveLength(1);
  });

  it("when the model fails, nothing is queued and nothing is filed", async () => {
    const db = leadDb([]);
    h.meeting = meeting();
    h.claude.fail = true;
    expect((await draftFollowUpAction({}, meetingForm())).error).toMatch(/Nothing was sent/);
    expect(h.drafts).toHaveLength(0);
    expect(db.tables.crm_consult_note).toHaveLength(0);
  });

  it("is still gated on the agents module and the approval queue", async () => {
    leadDb([]);
    h.meeting = meeting();
    h.claude.output = followUp();
    h.modules = [];
    expect((await draftFollowUpAction({}, meetingForm())).error).toMatch(/isn't turned on/);
    h.modules = ["agents"];
    h.queueKey = null;
    expect((await draftFollowUpAction({}, meetingForm())).error).toMatch(/No approval queue/);
    expect(h.claude.calls).toBe(0);
  });
});
