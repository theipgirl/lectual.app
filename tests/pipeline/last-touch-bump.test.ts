import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A note and a voice note both reach the last-touch bump. Neither the note
 * helper nor the voice-note helper bumps on its own: both write their row
 * through logActivity, which is where the one update to crm_lead lives. These
 * run the REAL logActivity over a recording fake of the scoped client.
 */

type Call = { table: string; ops: Array<[string, unknown[]]> };

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  updateError: null as unknown,
  role: "attorney",
}));

function resultFor(call: Call): { data: unknown; error: unknown } {
  const names = call.ops.map(([n]) => n);
  if (call.table === "crm_lead" && names.includes("update")) return { data: null, error: state.updateError };
  if (names.includes("insert")) return { data: null, error: null };
  return { data: { org_id: "org-1" }, error: null };
}

function fakeFrom(table: string) {
  const call: Call = { table, ops: [] };
  state.calls.push(call);
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit", "insert", "update"]) {
    q[name] = (...args: unknown[]) => {
      call.ops.push([name, args]);
      return q;
    };
  }
  q.single = () => Promise.resolve(resultFor(call));
  q.maybeSingle = () => Promise.resolve(resultFor(call));
  q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resultFor(call)).then(ok, bad);
  return q;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({
    from: fakeFrom,
    rpc: async () => ({ data: state.role, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
  })),
}));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/lib/voice/transcribe", () => ({ transcribeAudio: vi.fn(async () => ({ status: "skipped" })) }));

const { addLeadNote } = await import("@/lib/pipeline/notes");
const { DEFAULT_SORT, buildIntakeRows, sortRows } = await import("@/lib/intake/rows");
const { addVoiceNote } = await import("@/lib/voice/notes");

function leadUpdates(): Call[] {
  return state.calls.filter((c) => c.table === "crm_lead" && c.ops.some(([n]) => n === "update"));
}

beforeEach(() => {
  state.calls = [];
  state.updateError = null;
  state.role = "attorney";
});
afterEach(() => vi.restoreAllMocks());

describe("a note is a touch", () => {
  it("addLeadNote writes the timeline row and issues exactly one last_activity_at update", async () => {
    await addLeadNote("lead-1", { kind: "note", body: "Called, sending the LOE" });

    expect(state.calls.some((c) => c.table === "crm_activity" && c.ops.some(([n]) => n === "insert"))).toBe(true);
    const updates = leadUpdates();
    expect(updates).toHaveLength(1);
    const patch = updates[0].ops.find(([n]) => n === "update")![1][0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["last_activity_at"]);
    expect(updates[0].ops).toContainEqual(["eq", ["id", "lead-1"]]);
  });

  it("a logged call counts as a touch too", async () => {
    await addLeadNote("lead-1", { kind: "call_logged", body: "Spoke for ten minutes" });
    expect(leadUpdates()).toHaveLength(1);
  });

  it("a bump that fails never fails the note", async () => {
    state.updateError = { message: "rls said no" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(addLeadNote("lead-1", { kind: "note", body: "Still saved" })).resolves.toBeUndefined();
  });

  it("a refused role writes nothing and bumps nothing", async () => {
    state.role = "viewer";
    await expect(addLeadNote("lead-1", { kind: "note", body: "Nope" })).rejects.toBeTruthy();
    expect(leadUpdates()).toHaveLength(0);
  });
});

describe("a voice note is a touch", () => {
  const audio = { bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm", durationSeconds: 12 };

  it("on a lead: one last_activity_at update", async () => {
    await addVoiceNote({ leadId: "lead-1" }, audio);
    expect(leadUpdates()).toHaveLength(1);
  });

  it("on a matter: no lead is touched", async () => {
    await addVoiceNote({ matterId: "matter-1" }, audio);
    expect(leadUpdates()).toHaveLength(0);
  });
});

describe("a note moves the lead to the top of the default Intake sort", () => {
  it("takes the stamp the bump wrote and sorts the lead first", async () => {
    await addLeadNote("lead-b", { kind: "note", body: "Spoke this morning" });
    const patch = leadUpdates()[0].ops.find(([n]) => n === "update")![1][0] as { last_activity_at: string };

    const now = new Date(Date.parse(patch.last_activity_at) + 60_000);
    const earlier = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const stage = { id: "s1", name: "Follow-Up", order_index: 1, category: "open", aging_threshold_days: 7 };
    const lead = (id: string, last_activity_at: string | null) => ({
      id,
      first_name: id,
      last_name: "",
      email: `${id}@x.test`,
      current_stage_id: "s1",
      stage_entered_at: earlier,
      assigned_to: null,
      temperature: null,
      last_activity_at,
      last_outbound_at: null,
      last_inbound_at: null,
    });

    const before = buildIntakeRows({
      leads: [lead("lead-a", earlier), lead("lead-b", null)] as never,
      stages: [stage] as never,
      members: [],
      now,
    });
    expect(sortRows(before, DEFAULT_SORT.key, DEFAULT_SORT.dir).map((r) => r.lead.id)).toEqual(["lead-a", "lead-b"]);

    const after = buildIntakeRows({
      leads: [lead("lead-a", earlier), lead("lead-b", patch.last_activity_at)] as never,
      stages: [stage] as never,
      members: [],
      now,
    });
    expect(sortRows(after, DEFAULT_SORT.key, DEFAULT_SORT.dir).map((r) => r.lead.id)).toEqual(["lead-b", "lead-a"]);
  });
});
