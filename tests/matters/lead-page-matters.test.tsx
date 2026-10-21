import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The lead page's "Matters" line (Sprint 8, item 6), through the real page with
 * its data loaders mocked: a link per matter, "No matters yet." for none, and a
 * warning, not the empty line, for a failed read, with the rest of the page
 * still rendering.
 */

const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'");

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

type MattersRead = { status: "ok"; matters: unknown[] } | { status: "none" } | { status: "unavailable" };

function mockPage(mattersRead: MattersRead | "throws", role = "attorney") {
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [], error: null }) };
        return q;
      },
    })),
  }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role })) }));
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
  vi.doMock("@/lib/matters/for-lead", () => ({
    loadMattersForLead: vi.fn(async () => {
      if (mattersRead === "throws") throw new Error("must not reach the page");
      return mattersRead;
    }),
  }));
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
  })) {
    vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, stub])));
  }
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/app/dashboard/leads/[id]/actions", () => ({ addVoiceNoteAction: vi.fn() }));
}

async function render() {
  const { default: LeadPage } = await import("../../src/app/dashboard/leads/[id]/page");
  return renderToStaticMarkup(await LeadPage({ params: Promise.resolve({ id: "lead-1" }) }));
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lead page Matters line", () => {
  it("links every matter opened for the lead", async () => {
    mockPage({
      status: "ok",
      matters: [
        { id: "m-1", matterNumber: "TM-2026-0001", label: "SANKOFA", stageLabel: "3. Awaiting filing" },
        { id: "m-2", matterNumber: "CR-2026-0002", label: "Second work", stageLabel: "No stage" },
      ],
    });
    const html = await render();
    expect(html).toMatch(/<a href="\/dashboard\/matters\/m-1\/?">SANKOFA<\/a>/);
    expect(html).toMatch(/<a href="\/dashboard\/matters\/m-2\/?">Second work<\/a>/);
    expect(html).not.toContain("No matters yet.");
    // The line sits in the aside beside the lead's other facts.
    expect(html.indexOf(">Came from<")).toBeLessThan(html.indexOf(">Matters<"));
  });

  it("says 'No matters yet.' when the read worked and found none", async () => {
    mockPage({ status: "none" });
    const html = await render();
    expect(html).toContain(">Matters<");
    expect(html).toContain("No matters yet.");
  });

  it("shows a warning, not the empty line, when the matters couldn't be read, and the rest of the page still renders", async () => {
    mockPage({ status: "unavailable" });
    const html = await render();
    expect(text(html)).toContain("Matters couldn't be loaded.");
    expect(html).not.toContain("No matters yet.");
    // The other parts of the lead page are all still there.
    expect(html).toContain("Toussaint Studio");
    expect(html).toContain("Mireille Toussaint");
    expect(html).toContain("Timeline");
    expect(html).toContain(">Details<");
    expect(html).toContain(">Came from<");
    expect(html).toContain("Booth — UGW 2026");
  });

  it("shows the line to a read-only role too", async () => {
    mockPage({ status: "none" }, "viewer");
    expect(await render()).toContain("No matters yet.");
  });
});
