import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * "Draft the proposal" on a consult row (Sprint 6, B). The action takes only a meeting id; it
 * re-checks the module and staff gate, the session and the lead-writing role, reads the meeting
 * through the caller's scoped client (another firm's meeting is "Meeting not found"), needs a
 * transcript and a lead, and calls the existing draftProposalForStaff exactly once. It sends,
 * approves and resolves nothing.
 */

const MEETING = "44444444-4444-4444-8444-444444444444";
const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";

type MeetingShape = {
  id: string;
  title: string;
  started_at: string | null;
  summary: string | null;
  transcript: Array<{ speaker: string; text: string }>;
  lead_id: string | null;
  matter_id: string | null;
};
const meeting = (over: Partial<MeetingShape> = {}): MeetingShape => ({
  id: MEETING,
  title: "Consult with Ana Ruiz",
  started_at: "2026-10-19T14:00:00Z",
  summary: "A short summary.",
  transcript: [{ speaker: "Rebecca", text: "We recommend a word mark and a logo mark." }],
  lead_id: LEAD,
  matter_id: null,
  ...over,
});

type Opts = {
  role?: string;
  session?: "ok" | "none";
  gate?: { error: string } | null;
  read?: { status: "ok"; meeting: MeetingShape | null } | { status: "unavailable" };
  lead?: unknown;
  matterLead?: string | null;
  draftResult?: { ok: true; notice: string; href: string } | { ok: false; error: string };
};

async function setup(opts: Opts = {}) {
  const draft = vi.fn<(args: unknown) => Promise<unknown>>(async () => opts.draftResult ?? { ok: true, notice: "Drafted.", href: "/dashboard/proposals/p1/" });
  const getMeeting = vi.fn(async (id: string) => {
    void id;
    return opts.read ?? { status: "ok", meeting: meeting() };
  });
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    const row = table === "crm_matter" ? { lead_id: opts.matterLead ?? null } : opts.lead === undefined ? { id: LEAD, first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", business_name: "Zephyr" } : opts.lead;
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    return q;
  });
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () =>
      opts.session === "none" ? { kind: "none" } : { kind: "ok", role: opts.role ?? "intake", org: { id: "org-1", name: "Firm", slug: "firm" }, user: { id: "user-1" } },
    ),
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from })) }));
  vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => (opts.gate === undefined ? null : opts.gate)) }));
  vi.doMock("@/lib/consult-proposal/staff-run", () => ({ draftProposalForStaff: draft }));
  vi.doMock("@/lib/meetings/read", () => ({ getMeeting }));
  return { draft, getMeeting, tables };
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const action = async () => (await import("../../src/app/dashboard/proposals/transcript-actions")).draftProposalFromMeetingAction;

describe("draftProposalFromMeetingAction", () => {
  beforeEach(() => vi.resetModules());

  it("drafts once, from the meeting's own transcript, for its lead", async () => {
    const { draft, getMeeting } = await setup();
    const result = await (await action())({}, form({ meetingId: MEETING }));
    expect(result).toEqual({ ok: true, notice: "Drafted.", href: "/dashboard/proposals/p1/" });
    expect(getMeeting).toHaveBeenCalledWith(MEETING);
    expect(draft).toHaveBeenCalledTimes(1);
    const arg = draft.mock.calls[0][0] as {
      source: { kind: string; meetingId: string; transcript: Array<{ speaker: string; text: string }> | null; summary: string | null };
      lead: { id: string; firstName: string; businessName: string };
      orgId: string;
      userId: string;
      matterId: string | null;
    };
    expect(arg.source.kind).toBe("meeting");
    expect(arg.source.meetingId).toBe(MEETING);
    expect(arg.source.transcript).toEqual([{ speaker: "Rebecca", text: "We recommend a word mark and a logo mark." }]);
    expect(arg.lead).toMatchObject({ id: LEAD, firstName: "Ana", businessName: "Zephyr" });
    expect(arg).toMatchObject({ orgId: "org-1", userId: "user-1", matterId: null });
  });

  it("takes only a meeting id: nothing else in the form is used", async () => {
    const { draft } = await setup();
    await (await action())({}, form({ meetingId: MEETING, leadId: "other-lead", transcript: "forged transcript ".repeat(40), orgId: "org-2" }));
    const arg = draft.mock.calls[0][0] as { source: { transcript: unknown }; lead: { id: string }; orgId: string };
    expect(JSON.stringify(arg.source.transcript)).not.toContain("forged");
    expect(arg.lead.id).toBe(LEAD);
    expect(arg.orgId).toBe("org-1");
  });

  it("uses the matter's lead when the meeting is linked only to a matter, and carries the matter", async () => {
    const { draft, tables } = await setup({ read: { status: "ok", meeting: meeting({ lead_id: null, matter_id: MATTER }) }, matterLead: LEAD });
    const result = await (await action())({}, form({ meetingId: MEETING }));
    expect(result).toMatchObject({ ok: true });
    expect(tables).toContain("crm_matter");
    expect((draft.mock.calls[0][0] as { matterId: string }).matterId).toBe(MATTER);
  });

  it("refuses when the module or staff gate refuses, before reading anything", async () => {
    const { draft, getMeeting } = await setup({ gate: { error: "Your role can view proposals but not change them." } });
    expect(await (await action())({}, form({ meetingId: MEETING }))).toEqual({ error: "Your role can view proposals but not change them." });
    expect(getMeeting).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    const { draft, getMeeting } = await setup({ session: "none" });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/can't draft client email/);
    expect(getMeeting).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses a role outside CAN_WRITE_LEAD", async () => {
    const { draft, getMeeting } = await setup({ role: "viewer" });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/can't draft client email/);
    expect(getMeeting).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses an id that isn't a meeting id", async () => {
    const { draft, getMeeting } = await setup();
    for (const bad of ["", "nope", "../x", `${MEETING}x`]) {
      expect(await (await action())({}, form({ meetingId: bad }))).toEqual({ error: "Meeting not found." });
    }
    expect(getMeeting).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it("another firm's meeting (null through the scoped read) is Meeting not found", async () => {
    const { draft } = await setup({ read: { status: "ok", meeting: null } });
    expect(await (await action())({}, form({ meetingId: MEETING }))).toEqual({ error: "Meeting not found." });
    expect(draft).not.toHaveBeenCalled();
  });

  it("a failed meeting read says so and drafts nothing", async () => {
    const { draft } = await setup({ read: { status: "unavailable" } });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/Couldn't load the meeting/);
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses a meeting with no transcript, even if it has a summary", async () => {
    const { draft } = await setup({ read: { status: "ok", meeting: meeting({ transcript: [], summary: "A summary only." }) } });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/transcript isn't ready/);
    expect(draft).not.toHaveBeenCalled();
  });

  it("refuses a meeting with no lead and no matter lead", async () => {
    const a = await setup({ read: { status: "ok", meeting: meeting({ lead_id: null }) } });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/Link this meeting to a lead/);
    expect(a.draft).not.toHaveBeenCalled();
    vi.resetModules();
    const b = await setup({ read: { status: "ok", meeting: meeting({ lead_id: null, matter_id: MATTER }) }, matterLead: null });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/Link this meeting to a lead/);
    expect(b.draft).not.toHaveBeenCalled();
  });

  it("refuses when the lead can't be read", async () => {
    const { draft } = await setup({ lead: null });
    expect((await (await action())({}, form({ meetingId: MEETING }))).error).toMatch(/linked lead couldn't be read/);
    expect(draft).not.toHaveBeenCalled();
  });

  it("passes the drafter's own refusal through", async () => {
    await setup({ draftResult: { ok: false, error: "A proposal for this call was already drafted." } });
    expect(await (await action())({}, form({ meetingId: MEETING }))).toEqual({ error: "A proposal for this call was already drafted." });
  });

  it("calls no send, approve or resolve function (the file imports none)", () => {
    const src = readFileSync("src/app/dashboard/proposals/transcript-actions.ts", "utf8");
    expect(src).not.toMatch(/sendProposal|approveProposal|resolveQueueItem|resolve_draft|resolveDraft|markSent|sendMail|sendEmail/);
    const component = readFileSync("src/components/proposal-list/DraftMeetingButton.tsx", "utf8");
    expect(component).not.toMatch(/sendProposal|approveProposal|resolveQueueItem|sendMail/);
  });
});
