import { describe, it, expect } from "vitest";
import {
  CONSULT_STATE_PILL,
  connectionHeader,
  consultLine,
  consultRowState,
  consultWhen,
  type ConsultDraftFacts,
  type ConsultMeeting,
} from "@/lib/proposals/consult-row";

const NOW = Date.parse("2026-10-20T16:00:00Z");
const TZ = "America/New_York";

const meeting = (over: Partial<ConsultMeeting> = {}): ConsultMeeting => ({
  id: "m1",
  leadId: "lead-1",
  startedAt: "2026-10-19T14:00:00Z",
  hasTranscript: true,
  ...over,
});
const facts = (over: Partial<ConsultDraftFacts> = {}): ConsultDraftFacts => ({ markers: [], proposals: [], ...over });

describe("consultRowState", () => {
  it("Transcribing: a linked meeting with no transcript yet", () => {
    expect(consultRowState(meeting({ hasTranscript: false }), facts())).toEqual({ state: "transcribing", proposalId: null });
  });

  it("Transcript ready: a transcript, a lead, and no draft", () => {
    expect(consultRowState(meeting(), facts())).toEqual({ state: "ready", proposalId: null });
  });

  it("Unlinked: no lead", () => {
    expect(consultRowState(meeting({ leadId: null }), facts())).toEqual({ state: "unlinked", proposalId: null });
  });

  it("Drafted: the consult agent's marker names this meeting", () => {
    const f = facts({ markers: [{ meetingId: "m1", proposalId: "p-marker" }] });
    expect(consultRowState(meeting(), f)).toEqual({ state: "drafted", proposalId: "p-marker" });
  });

  it("Drafted: no marker, but a proposal for the same lead was created after the meeting started", () => {
    const f = facts({ proposals: [{ id: "p1", leadId: "lead-1", createdAt: "2026-10-19T15:00:00Z", source: "manual" }] });
    expect(consultRowState(meeting(), f)).toEqual({ state: "drafted", proposalId: "p1" });
  });

  it("a marker wins over the same-lead fallback", () => {
    const f = facts({
      markers: [{ meetingId: "m1", proposalId: "p-marker" }],
      proposals: [{ id: "p-other", leadId: "lead-1", createdAt: "2026-10-19T15:00:00Z", source: "manual" }],
    });
    expect(consultRowState(meeting(), f).proposalId).toBe("p-marker");
  });

  it("a marker for a DIFFERENT meeting does not match", () => {
    expect(consultRowState(meeting(), facts({ markers: [{ meetingId: "m2", proposalId: "p-x" }] })).state).toBe("ready");
  });

  it("a proposal for another lead, one created before the meeting, and a revision do not match", () => {
    const f = facts({
      proposals: [
        { id: "p-other-lead", leadId: "lead-2", createdAt: "2026-10-19T15:00:00Z", source: "manual" },
        { id: "p-before", leadId: "lead-1", createdAt: "2026-10-19T13:59:00Z", source: "manual" },
        { id: "p-revision", leadId: "lead-1", createdAt: "2026-10-19T16:00:00Z", source: "revision" },
      ],
    });
    expect(consultRowState(meeting(), f)).toEqual({ state: "ready", proposalId: null });
  });

  it("the same-lead fallback links the earliest proposal after the call", () => {
    const f = facts({
      proposals: [
        { id: "late", leadId: "lead-1", createdAt: "2026-10-20T10:00:00Z", source: "manual" },
        { id: "early", leadId: "lead-1", createdAt: "2026-10-19T15:00:00Z", source: "agent" },
      ],
    });
    expect(consultRowState(meeting(), f).proposalId).toBe("early");
  });

  it("a meeting with no start time can't use the fallback", () => {
    const f = facts({ proposals: [{ id: "p1", leadId: "lead-1", createdAt: "2026-10-19T15:00:00Z", source: "manual" }] });
    expect(consultRowState(meeting({ startedAt: null }), f).state).toBe("ready");
  });

  it("a transcribing meeting is not Drafted by the same-lead fallback", () => {
    const f = facts({ proposals: [{ id: "p1", leadId: "lead-1", createdAt: "2026-10-19T15:00:00Z", source: "manual" }] });
    expect(consultRowState(meeting({ hasTranscript: false }), f).state).toBe("transcribing");
  });

  it("has a pill for every state", () => {
    expect(CONSULT_STATE_PILL.drafted.label).toBe("Proposal created");
    expect(CONSULT_STATE_PILL.ready.label).toBe("Ready to draft");
    expect(CONSULT_STATE_PILL.transcribing.label).toBe("Transcript still processing");
    expect(CONSULT_STATE_PILL.unlinked.label).toBe("Not linked");
  });
});

describe("consultWhen and consultLine", () => {
  it("says today, yesterday, a weekday, then a date, in the firm's zone", () => {
    expect(consultWhen("2026-10-20T14:00:00Z", NOW, TZ)).toBe("today");
    expect(consultWhen("2026-10-19T14:00:00Z", NOW, TZ)).toBe("yesterday");
    expect(consultWhen("2026-10-17T14:00:00Z", NOW, TZ)).toBe("Saturday");
    expect(consultWhen("2026-10-09T14:00:00Z", NOW, TZ)).toBe("9 Oct");
    expect(consultWhen(null, NOW, TZ)).toBe("date unknown");
    expect(consultWhen("not a date", NOW, TZ)).toBe("date unknown");
  });

  it("uses the firm's calendar day, not the server's", () => {
    // 2026-10-20T02:30Z is still the evening of the 19th in New York.
    expect(consultWhen("2026-10-20T02:30:00Z", Date.parse("2026-10-20T16:00:00Z"), TZ)).toBe("yesterday");
  });

  it("words the line the way the design does", () => {
    expect(consultLine({ provider: "zoom", startedAt: "2026-10-19T14:00:00Z", durationSeconds: 41 * 60, hasTranscript: true, now: NOW, tz: TZ })).toBe(
      "Zoom consult · yesterday · 41 min · transcript synced",
    );
    expect(consultLine({ provider: "fathom", startedAt: "2026-10-09T14:00:00Z", durationSeconds: 52 * 60, hasTranscript: false, now: NOW, tz: TZ })).toBe(
      "Fathom consult · 9 Oct · 52 min · transcribing",
    );
    expect(consultLine({ provider: "zoom", startedAt: "2026-10-19T14:00:00Z", durationSeconds: null, hasTranscript: true, now: NOW, tz: TZ })).toBe(
      "Zoom consult · yesterday · transcript synced",
    );
  });
});

describe("connectionHeader", () => {
  const six = new Date(NOW - 6 * 60_000).toISOString();

  it("connected, with the last sync", () => {
    expect(connectionHeader([{ provider: "zoom", status: "active", last_import_at: six }], NOW)).toEqual({
      title: "Zoom consults",
      status: { kind: "connected", text: "connected · last sync 6 min ago" },
    });
  });
  it("Fathom alone is titled for Fathom; both, or neither, is plain 'Consults'", () => {
    expect(connectionHeader([{ provider: "fathom", status: "active", last_import_at: six }], NOW).title).toBe("Fathom consults");
    expect(
      connectionHeader(
        [
          { provider: "fathom", status: "active", last_import_at: six },
          { provider: "zoom", status: "active", last_import_at: null },
        ],
        NOW,
      ).title,
    ).toBe("Consults");
    expect(connectionHeader([], NOW).title).toBe("Consults");
  });
  it("connected but never imported says so", () => {
    expect(connectionHeader([{ provider: "zoom", status: "active", last_import_at: null }], NOW).status.text).toBe("connected · no import yet");
  });
  it("not connected", () => {
    expect(connectionHeader([], NOW).status).toEqual({ kind: "none", text: "not connected" });
    expect(connectionHeader([{ provider: "zoom", status: "revoked", last_import_at: null }], NOW).status.kind).toBe("none");
  });
  it("needs reconnecting outranks a healthy provider", () => {
    const h = connectionHeader(
      [
        { provider: "fathom", status: "active", last_import_at: six },
        { provider: "zoom", status: "reauth", last_import_at: six },
      ],
      NOW,
    );
    expect(h.status).toEqual({ kind: "reauth", text: "Zoom needs reconnecting" });
  });
  it("a failed read is its own line, never 'not connected'", () => {
    const h = connectionHeader(null, NOW);
    expect(h.status.kind).toBe("unavailable");
    expect(h.status.text).toBe("connection status couldn't be loaded");
    expect(h.status.text).not.toContain("not connected");
  });
});
