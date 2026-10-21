import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * linkMeetingAction: linking a meeting to a lead is a touch on that lead (the
 * Intake list sorts by the last thing that happened), best-effort.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const MEETING = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  session: { kind: "ok", role: "attorney" } as { kind: string; role?: string },
  meetingResult: { data: [{ id: "m", started_at: "2026-10-20T15:00:00Z", org_id: "org-1" }], error: null } as {
    data: unknown;
    error: unknown;
  },
  leadUpdateResult: { data: null, error: null } as { data: unknown; error: unknown },
  leadUpdateThrows: false,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  stop: vi.fn(async () => undefined),
}));

function fakeFrom(table: string) {
  const call = { table, ops: [] as Array<[string, unknown[]]> };
  state.calls.push(call);
  const result = () => (table === "crm_meeting" ? state.meetingResult : state.leadUpdateResult);
  const q: Record<string, unknown> = {};
  for (const name of ["update", "eq", "select"]) {
    q[name] = (...args: unknown[]) => {
      if (table === "crm_lead" && name === "update" && state.leadUpdateThrows) throw new Error("update blew up");
      call.ops.push([name, args]);
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
  return q;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({ from: fakeFrom })) }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/campaigns/stop-staff", () => ({ stopLeadSequencesAsStaff: state.stop }));

const { linkMeetingAction } = await import("@/app/dashboard/meetings/actions");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const leadUpdates = () => state.calls.filter((c) => c.table === "crm_lead" && c.ops.some(([n]) => n === "update"));

beforeEach(() => {
  state.session = { kind: "ok", role: "attorney" };
  state.meetingResult = { data: [{ id: MEETING, started_at: "2026-10-20T15:00:00Z", org_id: "org-1" }], error: null };
  state.leadUpdateResult = { data: null, error: null };
  state.leadUpdateThrows = false;
  state.calls = [];
  state.stop.mockClear();
});

describe("linkMeetingAction and the last-touch bump", () => {
  it("bumps the linked lead once, for the meeting's org, and returns Linked.", async () => {
    const result = await linkMeetingAction({}, form({ meetingId: MEETING, leadId: LEAD }));

    expect(result).toEqual({ ok: true, notice: "Linked." });
    const updates = leadUpdates();
    expect(updates).toHaveLength(1);
    const patch = updates[0].ops.find(([n]) => n === "update")![1][0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["last_activity_at"]);
    expect(updates[0].ops).toContainEqual(["eq", ["id", LEAD]]);
    expect(updates[0].ops).toContainEqual(["eq", ["org_id", "org-1"]]);
  });

  it("still says Linked. when the bump returns an error", async () => {
    state.leadUpdateResult = { data: null, error: { message: "rls said no" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await linkMeetingAction({}, form({ meetingId: MEETING, leadId: LEAD }))).toEqual({ ok: true, notice: "Linked." });
  });

  it("still says Linked. when the bump throws", async () => {
    state.leadUpdateThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await linkMeetingAction({}, form({ meetingId: MEETING, leadId: LEAD }))).toEqual({ ok: true, notice: "Linked." });
  });

  it("unlinking (no lead id) bumps nothing", async () => {
    const result = await linkMeetingAction({}, form({ meetingId: MEETING }));
    expect(result).toEqual({ ok: true, notice: "Unlinked." });
    expect(leadUpdates()).toHaveLength(0);
  });

  it("linking to a matter only bumps nothing", async () => {
    await linkMeetingAction({}, form({ meetingId: MEETING, matterId: MATTER }));
    expect(leadUpdates()).toHaveLength(0);
  });

  it("refuses a read-only role before any write", async () => {
    state.session = { kind: "ok", role: "viewer" };
    const result = await linkMeetingAction({}, form({ meetingId: MEETING, leadId: LEAD }));
    expect(result).toEqual({ error: "Your role can view meetings but not link them." });
    expect(state.calls).toHaveLength(0);
  });

  it("does not bump when the meeting could not be saved", async () => {
    state.meetingResult = { data: null, error: { code: "23503" } };
    const result = await linkMeetingAction({}, form({ meetingId: MEETING, leadId: LEAD }));
    expect(result).toEqual({ error: "That lead or matter isn't in your firm." });
    expect(leadUpdates()).toHaveLength(0);
  });
});
