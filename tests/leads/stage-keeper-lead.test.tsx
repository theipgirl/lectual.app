import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "@/components/timeline/Timeline";
import { StageSuggestionCard } from "@/components/leads/StageKeeperControls";
import { describeActivity } from "@/components/leads/describe";
import { pendingStageSuggestions, parseSuggestion } from "@/lib/stage-keeper/moves";

vi.mock("@/app/dashboard/leads/[id]/stage-keeper-actions", () => ({
  undoAgentMoveAction: vi.fn(),
  acceptStageSuggestionAction: vi.fn(),
  dismissStageSuggestionAction: vi.fn(),
}));

/**
 * What a person sees on the lead page about the Stage Keeper (Sprint 16): the timeline line with Undo
 * (only when it can work), and the suggestion cards with Accept / Dismiss (only when they can work).
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");
const ZONE = "America/New_York";

const MOVE = {
  id: "move-1",
  type: "stage_changed",
  actor_type: "ai",
  created_at: "2026-10-20T15:00:00.000Z",
  payload: {
    actor: "agent:stage-keeper",
    from_stage: "New PNC",
    to_stage: "LOE & Invoice Sent",
    from_stage_id: "s-new",
    to_stage_id: "s-loe",
    signal_key: "lead-1:mail:m1",
    signal: "loe-invoice-sent",
    previous_stage_entered_at: "2026-10-10T00:00:00.000Z",
    evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-10-20T14:00:00.000Z", subject: "Your engagement letter" },
  },
};
const CONSULT_MOVE = {
  ...MOVE,
  id: "move-2",
  payload: {
    ...MOVE.payload,
    to_stage: "Consultation Scheduled",
    to_stage_id: "s-consult",
    signal: "consult-scheduled",
    evidence: { kind: "calendar", title: "Strategy session", starts_at: "2026-10-24T18:00:00.000Z" },
  },
};
const NOTE = { id: "note-1", type: "note", actor_type: "user", created_at: "2026-10-19T10:00:00.000Z", payload: { note: "Called" } };

const render = (rows: unknown[], undo?: { leadId: string; canMove: boolean; currentStageId: string | null }) =>
  text(renderToStaticMarkup(<Timeline rows={rows as never} timeZone={ZONE} undo={undo} />));

describe("the timeline line", () => {
  it("reads 'Moved this lead automatically from X to Y because ...' with the subject as the detail", () => {
    const html = render([MOVE, NOTE], { leadId: "lead-1", canMove: true, currentStageId: "s-loe" });
    expect(html).toContain("Moved this lead automatically from New PNC to LOE & Invoice Sent because an LOE and invoice email was sent on Oct 20");
    expect(html).toContain("<p>Your engagement letter</p>");
  });

  it("a consult's reason is the booked date and time in the firm's zone", () => {
    const html = render([CONSULT_MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-consult" });
    expect(html).toContain("because a consult was booked for Oct 24 at 2:00 PM");
  });

  it("shows nothing from the mail but its subject", () => {
    const d = describeActivity({ ...MOVE, payload: { ...MOVE.payload, from: "secret@x.test", body: "SECRET-BODY", preview: "SECRET-PREVIEW" } }, { timeZone: ZONE });
    expect(JSON.stringify(d)).not.toMatch(/SECRET|secret@/);
    expect(d.tone).toBe("ai");
  });

  it("Undo shows for a role that may move stages while the lead is still where the agent put it", () => {
    const html = render([MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-loe" });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Undo<\/button>/);
    expect(html).toContain('name="activityId" value="move-1"');
    expect(html).toContain('name="leadId" value="lead-1"');
  });

  it("no Undo for a role that may not move stages", () => {
    const html = render([MOVE], { leadId: "lead-1", canMove: false, currentStageId: "s-loe" });
    expect(html).toContain("Moved this lead automatically");
    expect(html).not.toContain("Undo");
  });

  it("no Undo once the lead has moved since, or when the lead is somewhere else", () => {
    const later = { id: "later", type: "stage_changed", actor_type: "user", created_at: "2026-10-21T09:00:00.000Z", payload: { to_stage: "Elsewhere", to_stage_id: "s-else" } };
    expect(render([later, MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-else" })).not.toContain("Undo");
    expect(render([MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-else" })).not.toContain("Undo");
    // Back in the same stage by hand: still not the agent's to undo.
    expect(render([later, MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-loe" })).not.toContain("Undo");
  });

  it("an undone move says 'Undone' and the undo row names what it answers", () => {
    const undo = { id: "undo-1", type: "stage_changed", actor_type: "user", created_at: "2026-10-21T09:00:00.000Z", payload: { source: "stage-keeper-undo", undoes_activity_id: "move-1", from_stage: "LOE & Invoice Sent", to_stage: "New PNC" } };
    const html = render([undo, MOVE], { leadId: "lead-1", canMove: true, currentStageId: "s-new" });
    expect(html).toContain("Undone");
    expect(html).not.toMatch(/>Undo</);
    expect(html).toContain("Moved back to New PNC");
    expect(html).toContain("undid an automatic move");
  });

  it("without the undo prop (a matter's timeline) the line stands with no button", () => {
    const html = render([MOVE]);
    expect(html).toContain("Moved this lead automatically");
    expect(html).not.toContain("Undo");
  });

  it("a person's own stage change is described as before", () => {
    const d = describeActivity({ id: "p", type: "stage_changed", actor_type: "user", created_at: "2026-10-20T10:00:00Z", payload: { from_stage: "A", to_stage: "B" } });
    expect(d).toMatchObject({ title: "Moved to B", detail: "from A", tone: "system" });
  });
});

describe("suggestion rows on the timeline", () => {
  const SUGGESTION = {
    id: "sug-1",
    lead_id: "lead-1",
    type: "ai_insight",
    actor_type: "ai",
    created_at: "2026-10-20T15:00:00.000Z",
    payload: {
      source: "stage-keeper",
      kind: "stage_suggestion",
      signal_key: "lead-1:mail:m1",
      from_stage_id: "s-new",
      to_stage_id: "s-signed",
      from_stage: "New PNC",
      to_stage: "Signed LOE / Deposit Received",
      why: "won",
      evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-10-20T14:00:00.000Z", subject: "Your engagement letter" },
      autonomy: "act",
    },
  };
  const REVIEW = { id: "rev-1", lead_id: "lead-1", type: "ai_insight", actor_type: "user", created_at: "2026-10-21T10:00:00.000Z", payload: { source: "stage-keeper-review", suggestion_id: "sug-1", decision: "dismiss" } };

  it("describes a suggestion and its review", () => {
    expect(describeActivity(SUGGESTION, { timeZone: ZONE }).title).toBe("Suggested moving this lead from New PNC to Signed LOE / Deposit Received because an LOE and invoice email was sent on Oct 20");
    expect(describeActivity(REVIEW).title).toBe("Stage suggestion dismissed");
    expect(describeActivity({ ...REVIEW, payload: { ...REVIEW.payload, decision: "apply" } }).title).toBe("Stage suggestion accepted");
  });

  it("a suggestion is pending until a review row names it", () => {
    expect(pendingStageSuggestions([SUGGESTION]).map((s) => s.activityId)).toEqual(["sug-1"]);
    expect(pendingStageSuggestions([SUGGESTION, REVIEW])).toEqual([]);
    expect(parseSuggestion(SUGGESTION)).toMatchObject({ toStage: "Signed LOE / Deposit Received", why: "won" });
    expect(pendingStageSuggestions([{ ...SUGGESTION, payload: { ...SUGGESTION.payload, kind: "something-else" } }])).toEqual([]);
  });

  const card = (over: { canDecide?: boolean; currentStageId?: string | null } = {}) => {
    const suggestion = parseSuggestion(SUGGESTION)!;
    return text(
      renderToStaticMarkup(
        <StageSuggestionCard leadId="lead-1" suggestion={suggestion} currentStageId={"currentStageId" in over ? (over.currentStageId as string | null) : "s-new"} canDecide={over.canDecide ?? true} timeZone={ZONE} />,
      ),
    );
  };

  it("shows the stage, the reason, why it is only a suggestion, and Accept / Dismiss", () => {
    const html = card();
    expect(html).toContain("Signed LOE / Deposit Received");
    expect(html).toContain("now New PNC");
    expect(html).toContain("Because an LOE and invoice email was sent on Oct 20.");
    expect(html).toContain("This stage opens a matter, so a person decides.");
    expect(html).toMatch(/>Accept<\/button>/);
    expect(html).toMatch(/>Dismiss<\/button>/);
    expect(html).toContain('name="activityId" value="sug-1"');
  });

  it("a role that may not decide sees the card without buttons", () => {
    const html = card({ canDecide: false });
    expect(html).toContain("Signed LOE / Deposit Received");
    expect(html).not.toMatch(/>Accept<|>Dismiss</);
  });

  it("a suggestion the lead has moved past offers Dismiss only", () => {
    const html = card({ currentStageId: "s-elsewhere" });
    expect(html).toContain("out of date");
    expect(html).not.toMatch(/>Accept</);
    expect(html).toMatch(/>Dismiss</);
  });
});

// ── through the real page ────────────────────────────────────────────────────

const stub = () => null;
const lead = {
  id: "lead-amara",
  first_name: "Amara",
  last_name: "Nwosu",
  email: "amara@example.com",
  phone: null,
  business_name: null,
  website: null,
  mark_text: null,
  practice_area: null,
  current_stage_id: "s-loe",
  assigned_to: null,
  referral_source: null,
  referral_detail: null,
  last_inbound_at: null,
  last_outbound_at: null,
  ai_summary: null,
  ai_red_flags: null,
  lane: null,
};

function mockPage(opts: { role: string; activity: unknown[] }) {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: opts.activity, error: null }) };
        return q;
      },
    })),
  }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: opts.role })) }));
  vi.doMock("@/lib/pipeline", async (orig) => ({
    ...(await orig<typeof import("@/lib/pipeline")>()),
    getLead: vi.fn(async () => lead),
    listStages: vi.fn(async () => [{ id: "s-loe", name: "LOE & Invoice Sent" }]),
  }));
  vi.doMock("@/lib/pipeline/tags", () => ({ listTags: vi.fn(async () => []), tagsForLead: vi.fn(async () => []) }));
  vi.doMock("@/lib/intake/effective-temperature", () => ({ effectiveTemperature: vi.fn(() => "cold") }));
  vi.doMock("@/lib/intake/facts", () => ({ loadTemperatureFacts: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/agents/proposals", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/proposals")>()), pendingProposals: vi.fn(() => []) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/org/profile", () => ({
    getFirmTimeZone: vi.fn(async () => "America/New_York"),
    getLaneLinks: vi.fn(async () => ({ links: { strategySessionUrl: null, discoveryCallUrl: null, nurtureSequenceId: null }, failed: false })),
  }));
  vi.doMock("@/lib/automation/drips", () => ({ listLeadEnrollments: vi.fn(async () => []) }));
  vi.doMock("@/lib/automation/rules", () => ({ AUTOMATION_STAFF_ROLES: ["attorney", "owner"] }));
  vi.doMock("@/lib/queue/lead-pending", () => ({ loadPendingApprovalsByLead: vi.fn(async () => ({ status: "unavailable" })) }));
  vi.doMock("@/lib/voice/notes", () => ({ voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/consult-proposal/draft-gate", () => ({ loadDraftBlock: vi.fn(async () => null) }));
  vi.doMock("@/lib/proposals/store", () => ({ listProposals: vi.fn(async () => []) }));
  vi.doMock("@/lib/matters/for-lead", () => ({ loadMattersForLead: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/answers/load-answers", () => ({ loadLeadAnswers: vi.fn(async () => ({ submissions: { status: "skipped" }, booth: { status: "skipped" }, requests: { status: "skipped" } })) }));
  vi.doMock("@/lib/files/read", () => ({ loadDocumentsRead: vi.fn(async () => ({ files: { status: "ok", files: [] }, letters: { status: "skipped" } })) }));
  vi.doMock("@/lib/calendar/outlook-read", () => ({ loadBookedConsult: vi.fn(async () => null) }));
  for (const [path, names] of Object.entries({
    "@/components/leads/LeadForms": ["AssignSelect", "EditLeadForm", "NoteComposer", "ProposalCard", "StageSelect"],
    "@/components/leads/LeadExtras": ["LeadTags", "PrepConsult"],
    "@/components/leads/ConsultOutcomeForm": ["ConsultOutcomeForm"],
    "@/components/leads/LeadProposalsCard": ["LeadProposalsCard"],
    "@/components/leads/ConsultDetailsSection": ["ConsultDetailsSection"],
    "@/components/leads/TemperatureCard": ["TemperatureCard"],
    "@/components/leads/WaitingOnRebecca": ["WaitingOnRebecca"],
    "@/components/leads/SequencesCard": ["SequencesCard"],
    "@/components/meetings/LinkedMeetings": ["LinkedMeetings"],
    "@/components/answers/AnswersCard": ["AnswersCard"],
    "@/components/files/DocumentsCard": ["DocumentsCard"],
  })) {
    vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, stub])));
  }
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/app/dashboard/leads/[id]/actions", () => ({ addVoiceNoteAction: vi.fn() }));
}

async function page() {
  const { default: LeadPage } = await import("../../src/app/dashboard/leads/[id]/page");
  return text(renderToStaticMarkup(await LeadPage({ params: Promise.resolve({ id: "lead-amara" }) })));
}

const PENDING = {
  id: "sug-9",
  lead_id: "lead-amara",
  type: "ai_insight",
  actor_type: "ai",
  created_at: "2026-10-20T16:00:00.000Z",
  payload: {
    source: "stage-keeper",
    kind: "stage_suggestion",
    signal_key: "lead-amara:mail:m9",
    from_stage_id: "s-loe",
    to_stage_id: "s-signed",
    from_stage: "LOE & Invoice Sent",
    to_stage: "Signed LOE / Deposit Received",
    why: "won",
    evidence: { kind: "mail", type: "loe-invoice", direction: "outbound", at: "2026-10-20T14:00:00.000Z", subject: null },
    autonomy: "act",
  },
};

describe("the lead page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("D1: the timeline shows the Stage Keeper's line with Undo, and a pending suggestion shows as a card", async () => {
    mockPage({ role: "attorney", activity: [PENDING, { ...MOVE, lead_id: "lead-amara" }] });
    const html = await page();
    expect(html).toContain("Moved this lead automatically from New PNC to LOE & Invoice Sent because an LOE and invoice email was sent on Oct 20");
    expect(html).toMatch(/>Undo<\/button>/);
    expect(html).toContain("Automatic stage moves · waiting on you");
    expect(html).toContain("1 stage suggestion");
    expect(html).toMatch(/>Accept<\/button>/);
    expect(html.indexOf("Automatic stage moves · waiting on you")).toBeLessThan(html.indexOf("Timeline"));
  });

  it("a paralegal sees the line and the card but no Undo, Accept or Dismiss", async () => {
    mockPage({ role: "paralegal", activity: [PENDING, { ...MOVE, lead_id: "lead-amara" }] });
    const html = await page();
    expect(html).toContain("Moved this lead automatically");
    expect(html).toContain("Automatic stage moves · waiting on you");
    expect(html).not.toMatch(/>Undo<|>Accept<|>Dismiss</);
  });

  it("with nothing from the Stage Keeper, none of it is drawn", async () => {
    mockPage({ role: "attorney", activity: [NOTE] });
    const html = await page();
    expect(html).not.toContain("Automatic stage moves");
    expect(html).not.toContain("Undo");
  });
});
