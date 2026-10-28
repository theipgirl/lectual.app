import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsultBookedView } from "@/components/calendar/ConsultBookedLine";
import type { OutlookCalendarEvent, OutlookRead } from "@/lib/calendar/outlook-read";
import { storedConsult } from "../calendar/fixtures";

/**
 * "Consult booked · <date time> · Join" on the lead page (Sprint 15, F12), as the
 * component and through the real page with its loaders mocked.
 */

const stub = () => null;
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "").replaceAll("\u202f", " ");
type Read = OutlookRead<{ event: OutlookCalendarEvent | null }>;

// STRATEGY_SESSION is 2026-10-22T18:00Z: 2:00 PM on Thursday in New York.
const WHEN = "Thu, Oct 22, 2:00 PM";

describe("ConsultBookedView", () => {
  it("a future linked consult shows the heading, the firm-zone date and time, and a safe Join link", () => {
    const html = text(renderToStaticMarkup(<ConsultBookedView read={{ status: "ok", event: storedConsult() }} timeZone="America/New_York" />));
    expect(html).toContain("Consult booked");
    expect(html).toContain(WHEN);
    expect(html).toContain('href="https://teams.microsoft.com/l/meetup-join/strategy-1"');
    expect(html).toMatch(/<a [^>]*target="_blank"[^>]*>Join<\/a>/);
    expect(html).toMatch(/<a [^>]*rel="noopener noreferrer"[^>]*>Join<\/a>/);
  });

  it("the same instant is drawn in the firm's own zone", () => {
    const html = renderToStaticMarkup(<ConsultBookedView read={{ status: "ok", event: storedConsult() }} timeZone="America/Los_Angeles" />);
    expect(text(html)).toContain("Thu, Oct 22, 11:00 AM");
  });

  it("a consult with no join URL shows no Join link", () => {
    const html = renderToStaticMarkup(<ConsultBookedView read={{ status: "ok", event: storedConsult({ join_url: null }) }} timeZone="America/New_York" />);
    expect(html).toContain("Consult booked");
    expect(html).not.toContain("Join");
    expect(html).not.toContain("<a ");
  });

  it("never links a non-https join URL", () => {
    const html = renderToStaticMarkup(<ConsultBookedView read={{ status: "ok", event: storedConsult({ join_url: "javascript:alert(1)" }) }} timeZone="America/New_York" />);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Join");
  });

  it("no consult renders nothing", () => {
    expect(renderToStaticMarkup(<ConsultBookedView read={{ status: "ok", event: null }} timeZone="America/New_York" />)).toBe("");
  });

  it("unavailable and database-update-needed each get their own muted line, never 'Consult booked'", () => {
    const unavailable = text(renderToStaticMarkup(<ConsultBookedView read={{ status: "unavailable" }} timeZone="UTC" />));
    const waiting = text(renderToStaticMarkup(<ConsultBookedView read={{ status: "database-update-needed" }} timeZone="UTC" />));
    expect(unavailable).toContain("couldn't check whether a consult is booked");
    expect(waiting).toContain("aren't switched on for your firm yet");
    expect(unavailable).not.toBe(waiting);
    for (const html of [unavailable, waiting]) {
      expect(html).not.toContain("Consult booked");
      expect(html).toContain('class="lx-note"');
    }
  });
});

// ── through the real page ────────────────────────────────────────────────────

const lead = {
  id: "lead-amara",
  first_name: "Amara",
  last_name: "Nwosu",
  email: "amara@example.com",
  phone: null,
  business_name: null,
  website: null,
  mark_text: "SANKOFA",
  practice_area: null,
  current_stage_id: "stage-1",
  assigned_to: null,
  referral_source: null,
  referral_detail: null,
  last_inbound_at: null,
  last_outbound_at: null,
  ai_summary: null,
  ai_red_flags: null,
  lane: null,
};

const loadBookedConsult = vi.fn();

function mockPage(opts: { mailbox: boolean; read?: Read | "throws" }) {
  loadBookedConsult.mockReset();
  loadBookedConsult.mockImplementation(async () => {
    if (opts.read === "throws") throw new Error("must not escape");
    return opts.read ?? { status: "ok", event: null };
  });
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [], error: null }) };
        return q;
      },
    })),
  }));
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
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "mailbox" && opts.mailbox) }));
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
  vi.doMock("@/lib/calendar/outlook-read", () => ({ loadBookedConsult }));
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

async function render() {
  const { default: LeadPage } = await import("../../src/app/dashboard/leads/[id]/page");
  return text(renderToStaticMarkup(await LeadPage({ params: Promise.resolve({ id: "lead-amara" }) })));
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lead page: Consult booked", () => {
  it("D1: the row shape the sync stores renders as the booked consult, above the rest of the page", async () => {
    mockPage({ mailbox: true, read: { status: "ok", event: storedConsult() } });
    const html = await render();
    expect(html).toContain("Consult booked");
    expect(html).toContain(WHEN);
    expect(html).toMatch(/<a [^>]*href="https:\/\/teams\.microsoft\.com\/l\/meetup-join\/strategy-1"[^>]*>Join<\/a>/);
    expect(loadBookedConsult).toHaveBeenCalledWith("lead-amara");
    expect(html.indexOf("Consult booked")).toBeLessThan(html.indexOf("Timeline"));
    expect(html).toContain("Amara Nwosu");
  });

  it("no future consult linked: no line at all", async () => {
    mockPage({ mailbox: true, read: { status: "ok", event: null } });
    const html = await render();
    expect(html).not.toContain("Consult booked");
    expect(html).not.toContain("consult is booked");
    expect(html).toContain("Timeline");
  });

  it("an unavailable read and a database-update-needed read each say so, and the page still renders", async () => {
    mockPage({ mailbox: true, read: { status: "unavailable" } });
    const a = await render();
    expect(a).toContain("couldn't check whether a consult is booked");
    expect(a).not.toContain("Consult booked");
    expect(a).toContain("Timeline");

    vi.resetModules();
    mockPage({ mailbox: true, read: { status: "database-update-needed" } });
    const b = await render();
    expect(b).toContain("switched on for your firm yet");
    expect(b).not.toContain("Consult booked");
  });

  it("a firm without the mailbox module triggers no read and shows nothing", async () => {
    mockPage({ mailbox: false, read: { status: "ok", event: storedConsult() } });
    const html = await render();
    expect(loadBookedConsult).not.toHaveBeenCalled();
    expect(html).not.toContain("Consult booked");
    expect(html).not.toContain("switched on for your firm yet");
    expect(html).not.toContain("consult is booked");
    expect(html).toContain("Timeline");
  });
});
