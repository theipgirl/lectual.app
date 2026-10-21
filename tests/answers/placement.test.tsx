import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type FakeDb } from "../matters/helpers/fake-db";
import { standardSeed } from "../matters/helpers/seed";
import { BUSINESS_ANSWERS, ASSESSMENT_FORM_ID, assessmentAnswers, assessmentFormRow, boothRow, formRow, submissionRow } from "../intake-forms/helpers/forms-db";

/**
 * Sprint 9 F6 (placement) and D1 (a lead's round trip): the real lead and
 * matter pages with the real answers loader against one in-memory scoped
 * client. Only what is outside this sprint (session, modules, mail, meetings,
 * client components with hooks) is mocked.
 */

const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

const lead = {
  id: "lead-1",
  first_name: "Mireille",
  last_name: "Toussaint",
  email: "mireille@example.com",
  phone: null,
  business_name: "Toussaint Studio",
  website: null,
  mark_text: "SANKOFA",
  practice_area: null,
  current_stage_id: "stage-1",
  assigned_to: null,
  referral_source: "Booth",
  referral_detail: "UGW 2026",
  last_inbound_at: null,
  last_outbound_at: null,
  ai_summary: null,
  ai_red_flags: null,
  lane: null,
};

const a = assessmentAnswers(BUSINESS_ANSWERS);

function leadTables() {
  return {
    crm_intake_form: [formRow(), assessmentFormRow()],
    crm_intake_submission: [
      submissionRow("s-assess", {
        lead_id: "lead-1",
        form_id: ASSESSMENT_FORM_ID,
        mode: "assessment",
        answers: a.answerList,
        score: a.score.score,
        band: a.score.band,
        temperature: a.score.temperature,
        started_at: "2026-10-16T15:00:00Z",
        submitted_at: "2026-10-16T15:03:00Z",
      }),
      submissionRow("s-unfinished", { lead_id: "lead-1", answers: [], started_at: "2026-10-19T15:00:00Z", submitted_at: null }),
    ],
    crm_booth_scorecard: [
      boothRow("b1", {
        lead_id: "lead-1",
        track: "business",
        score: 72,
        band: "protected",
        temperature: "warm",
        answers: { "1": "business", "2": "yes", "5": "registered" },
        gaps: ["Only part of your revenue is protected by written contracts."],
        created_at: "2026-10-17T15:00:00Z",
        completed_at: "2026-10-17T15:03:00Z",
      }),
    ],
    crm_activity: [
      {
        id: "act-1",
        org_id: "org-1",
        lead_id: "lead-1",
        type: "booth_scorecard",
        actor_type: "system",
        created_at: "2026-10-17T15:03:00Z",
        payload: { summary: "Booth scorecard — 72/100, WARM", score: 72, temperature: "warm" },
      },
      {
        id: "act-2",
        org_id: "org-1",
        lead_id: "lead-1",
        type: "booth_scorecard",
        actor_type: "system",
        created_at: "2026-10-17T15:00:00Z",
        payload: { summary: "Booth — contact captured, assessment not yet completed" },
      },
    ],
    crm_org_profile: [],
  };
}

async function leadPage(db: FakeDb, mattersRead: unknown = { status: "none" }) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({
    ...(await orig<typeof import("@/lib/pipeline")>()),
    getLead: vi.fn(async () => lead),
    listStages: vi.fn(async () => [{ id: "stage-1", name: "New" }]),
  }));
  vi.doMock("@/lib/pipeline/tags", () => ({ listTags: vi.fn(async () => []), tagsForLead: vi.fn(async () => []) }));
  vi.doMock("@/lib/intake/effective-temperature", () => ({ effectiveTemperature: vi.fn(() => "cold") }));
  vi.doMock("@/lib/intake/facts", () => ({ loadTemperatureFacts: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/agents/proposals", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/proposals")>()), pendingProposals: vi.fn(() => []) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/org/profile", () => ({
    getFirmTimeZone: vi.fn(async () => "UTC"),
    getLaneLinks: vi.fn(async () => ({ links: { strategySessionUrl: null, discoveryCallUrl: null, nurtureSequenceId: null }, failed: false })),
  }));
  vi.doMock("@/lib/automation/drips", () => ({ listLeadEnrollments: vi.fn(async () => []) }));
  vi.doMock("@/lib/automation/rules", () => ({ AUTOMATION_STAFF_ROLES: ["attorney", "owner"] }));
  vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => null) }));
  vi.doMock("@/lib/proposals/store", () => ({ listProposals: vi.fn(async () => []) }));
  vi.doMock("@/lib/matters/for-lead", () => ({ loadMattersForLead: vi.fn(async () => mattersRead) }));
  for (const [path, names] of Object.entries({
    "@/components/leads/LeadForms": ["AssignSelect", "EditLeadForm", "NoteComposer", "ProposalCard", "StageSelect"],
    "@/components/leads/LeadExtras": ["LeadTags", "PrepConsult"],
    "@/components/leads/ConsultOutcomeForm": ["ConsultOutcomeForm"],
    "@/components/leads/LeadProposalsCard": ["LeadProposalsCard"],
    "@/components/leads/ConsultDetailsSection": ["ConsultDetailsSection"],
    "@/components/leads/WaitingOnRebecca": ["WaitingOnRebecca"],
    "@/components/leads/SequencesCard": ["SequencesCard"],
    "@/components/meetings/LinkedMeetings": ["LinkedMeetings"],
  })) {
    vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, stub])));
  }
  // The temperature card leaves a marker so the card's position after it can be asserted.
  vi.doMock("@/components/leads/TemperatureCard", () => ({ TemperatureCard: () => <section data-marker="temperature-card">Temperature</section> }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/app/dashboard/leads/[id]/actions", () => ({ addVoiceNoteAction: vi.fn() }));
  const { default: LeadPage } = await import("../../src/app/dashboard/leads/[id]/page");
  return renderToStaticMarkup(await LeadPage({ params: Promise.resolve({ id: "lead-1" }) }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lead page placement (F6)", () => {
  it("renders the card right after the temperature card, and keeps every other section", async () => {
    const html = text(await leadPage(createFakeDb({ tables: leadTables() }), { status: "none" }));
    const temp = html.indexOf('data-marker="temperature-card"');
    const card = html.indexOf('aria-label="Intake & assessment answers"');
    expect(temp).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(temp);
    // The card is the very next section after the temperature card.
    expect(html.slice(temp)).toMatch(/^[^>]*>Temperature<\/section><section[^>]*aria-label="Intake & assessment answers"/);
    expect(html.indexOf("Timeline")).toBeGreaterThan(card);
    expect(html).toContain(">Matters<");
    expect(html).toContain("No matters yet.");
    expect(html).toContain("Toussaint Studio");
    expect(html).toContain(">Came from<");
    expect(html.match(/aria-label="Intake & assessment answers"/g)).toHaveLength(1);
  });

  it("when the answers read fails, names it on the card and still renders the Matters line and the rest", async () => {
    const db = createFakeDb({ tables: leadTables() });
    db.fail("crm_intake_submission", "select");
    db.fail("crm_booth_scorecard", "select");
    const html = text(await leadPage(db, { status: "ok", matters: [{ id: "m-1", matterNumber: "TM-1", label: "SANKOFA", stageLabel: "3. Awaiting filing" }] }));
    expect(html).toContain("Couldn't load answers: Intake submissions, Booth scorecards");
    expect(html).not.toContain("No intake or assessment answers yet.");
    expect(html).toMatch(/<a href="\/dashboard\/matters\/m-1\/?">SANKOFA<\/a>/);
    expect(html).toContain("Timeline");
    expect(html).toContain("Toussaint Studio");
    expect(html).not.toContain("boom");
  });

  it("D1: three items newest first, the card expands to full answers, and the timeline shows the booth row's summary and score", async () => {
    const html = text(await leadPage(createFakeDb({ tables: leadTables() })));
    const items = [...html.matchAll(/<details class="lx-disclosure-inline" data-kind="(\w+)"><summary>([^<]*)<\/summary>/g)].map((m) => [m[1], m[2]]);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i[0])).toEqual(["submission", "booth", "submission"]);
    expect(items[0][1]).toContain("UGW 2026 booth");
    expect(items[0][1]).toContain("Didn't finish");
    expect(items[1][1]).toContain("Booth · urban-golf-2026");
    expect(items[1][1]).toContain("Score 72/100");
    expect(items[2][1]).toContain("Booth assessment · Assessment");
    // Full answers sit inside the expandable blocks.
    expect(html).toContain("Is your business name or logo federally registered?");
    expect(html).toContain("Yes, registered");
    expect(html).toContain("Application pending");
    // The timeline reads the same booth capture with its summary and score, not a bare title.
    const timeline = html.slice(html.indexOf('class="lx-timeline"'));
    expect(timeline).toContain("Booth scorecard");
    expect(timeline).toContain("Booth scorecard — 72/100, WARM");
    expect(timeline).toContain("Booth — contact captured, assessment not yet completed");
    expect(html).not.toContain("<p>Booth scorecard</p>");
  });
});

// ── the matter page ───────────────────────────────────────────────────────────

function matterTables(leadId: string | null) {
  const seed = standardSeed();
  seed.crm_matter.find((m) => m.id === "matter-1")!.lead_id = leadId;
  return {
    ...seed,
    ...leadTables(),
    crm_activity: [],
    crm_intake_request: [
      { id: "r1", org_id: "org-1", matter_id: "matter-1", status: "completed", sent_at: "2026-10-10T10:00:00Z", completed_at: "2026-10-12T10:00:00Z", answers: [{ id: "q", question: "Registered owner?", answer: "Acme LLC" }], token: "T" },
      { id: "r2", org_id: "org-1", matter_id: "matter-1", status: "sent", sent_at: "2026-10-11T10:00:00Z", completed_at: null, answers: null, token: "T2" },
    ],
  };
}

async function matterPage(db: FakeDb) {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => db.client()) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: "attorney" })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/intake-forms/requests", () => ({
    canSendIntakeRequest: () => false,
    listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })),
  }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: stub }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: stub }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  const { default: MatterPage } = await import("../../src/app/dashboard/matters/[id]/page");
  return text(renderToStaticMarkup(await MatterPage({ params: Promise.resolve({ id: "matter-1" }) })));
}

describe("matter page placement (F6)", () => {
  it("renders the card in the aside, reading through the matter's lead_id, with the matter's completed requests", async () => {
    const db = createFakeDb({ tables: matterTables("lead-1") });
    const html = await matterPage(db);
    const aside = html.slice(html.indexOf('<aside class="lx-col lx-col-aside">'));
    expect(aside).toContain('aria-label="Intake & assessment answers"');
    expect(html.slice(0, html.indexOf("<aside"))).not.toContain("Intake & assessment answers");
    expect(aside).toContain("Intake questions sent to the client · Oct 12, 10:00 AM");
    expect(aside).toContain("Registered owner?");
    expect(aside).toContain("Booth · urban-golf-2026");
    expect(aside).toContain("UGW 2026 booth · Intake · Oct 19");
    // Only the completed request is an answer.
    expect(aside.match(/data-kind="request"/g)).toHaveLength(1);
    // The reads went through the matter's lead.
    expect(db.froms).toEqual(expect.arrayContaining(["crm_intake_request", "crm_intake_submission", "crm_booth_scorecard"]));
    expect(aside.indexOf("Intake & assessment answers")).toBeLessThan(aside.indexOf(">About<"));
  });

  it("for a matter with no lead_id shows only the matter's own requests, with no error", async () => {
    const db = createFakeDb({ tables: matterTables(null) });
    const html = await matterPage(db);
    expect(html).toContain('aria-label="Intake & assessment answers"');
    expect(html).toContain("Registered owner?");
    expect(html).not.toContain("Couldn't load answers");
    expect(html).not.toContain("Booth · ");
    expect(db.froms).not.toContain("crm_booth_scorecard");
    expect(db.froms).not.toContain("crm_intake_submission");
  });

  it("says 'No intake or assessment answers yet.' for a matter with no lead and no answered requests", async () => {
    const tables = matterTables(null);
    tables.crm_intake_request = [];
    const html = await matterPage(createFakeDb({ tables }));
    expect(html).toContain("No intake or assessment answers yet.");
  });

  it("names a failed read on the card and keeps the rest of the matter page", async () => {
    const db = createFakeDb({ tables: matterTables("lead-1") });
    db.fail("crm_intake_request", "select");
    const html = await matterPage(db);
    expect(html).toContain("Couldn't load answers: Questions sent to the client");
    expect(html).not.toContain("No intake or assessment answers yet.");
    expect(html).toContain("Deadlines");
    expect(html).toContain("Timeline");
    expect(html).toContain("Booth · urban-golf-2026");
  });
});
