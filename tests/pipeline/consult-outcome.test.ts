import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const OWNER = "user-owner";
const ACTOR = "user-actor";
const DAWN = "user-dawn";
const AMOR = "user-amor";

const state = vi.hoisted(() => ({
  role: "intake" as string,
  lead: { first_name: "Ana", last_name: "Ruiz", email: "ana@x.test", assigned_to: "user-owner" } as Record<string, unknown> | null,
  leadError: null as unknown,
  actorId: "user-actor" as string | null,
  activityRow: { id: "act-1" } as { id: string } | null,
  directory: [] as Array<{ userId: string; role: string }>,
  directoryThrows: false,
  notifyRejects: false,
  tables: [] as string[],
  writes: [] as string[],
}));

const logActivity = vi.hoisted(() => vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}));
const notify = vi.hoisted(() => vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => {}));
const createDraft = vi.hoisted(() => vi.fn());

function query(table: string) {
  state.tables.push(table);
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const verb of ["select", "eq", "order", "limit"]) q[verb] = chain;
  for (const verb of ["insert", "update", "delete", "upsert"]) {
    q[verb] = () => {
      state.writes.push(`${table}.${verb}`);
      return q;
    };
  }
  q.maybeSingle = () =>
    Promise.resolve(
      table === "crm_lead"
        ? { data: state.lead, error: state.leadError }
        : { data: state.activityRow, error: null },
    );
  return q;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (table: string) => query(table),
    rpc: async () => ({ data: state.role, error: null }),
    auth: { getUser: async () => ({ data: { user: state.actorId ? { id: state.actorId } : null } }) },
  }),
}));
vi.mock("@/lib/matters", () => ({ logActivity }));
vi.mock("@/lib/notifications", () => ({ notify }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: async () => {
    if (state.directoryThrows) throw new Error("directory down");
    return state.directory;
  },
}));
vi.mock("@/lib/queue/api", () => ({ createDraft }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { logConsultOutcome } from "@/lib/pipeline/consult-outcome";
import { NOTE_MAX_LENGTH } from "@/lib/pipeline/lead-input";
import { logConsultOutcomeAction } from "@/app/dashboard/leads/[id]/outcome-actions";

beforeEach(() => {
  state.role = "intake";
  state.lead = { first_name: "Ana", last_name: "Ruiz", email: "ana@x.test", assigned_to: OWNER };
  state.leadError = null;
  state.actorId = ACTOR;
  state.activityRow = { id: "act-1" };
  state.directory = [
    { userId: ACTOR, role: "intake" },
    { userId: DAWN, role: "intake" },
    { userId: AMOR, role: "intake" },
    { userId: OWNER, role: "attorney" },
    { userId: "user-viewer", role: "viewer" },
  ];
  state.directoryThrows = false;
  state.tables = [];
  state.writes = [];
  logActivity.mockClear();
  logActivity.mockImplementation(async () => {});
  notify.mockClear();
  notify.mockImplementation(async () => {});
  createDraft.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const recipients = () => notify.mock.calls.map(([input]) => input.userId).sort();

describe("logConsultOutcome", () => {
  it("writes a call_logged row with the outcome, its label and the note", async () => {
    await logConsultOutcome("lead-1", { outcome: "no_show", note: "  Didn't join, no message.  " });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      type: "call_logged",
      leadId: "lead-1",
      actorType: "user",
      payload: { summary: "No-show", notes: "Didn't join, no message.", consult_outcome: "no_show" },
    });
  });

  it("writes each of the other two outcomes under its own value and words", async () => {
    await logConsultOutcome("lead-1", { outcome: "reschedule_requested" });
    await logConsultOutcome("lead-1", { outcome: "rebooked_after_no_show", note: "Thursday 3pm" });
    const payloads = logActivity.mock.calls.map(([i]) => i.payload);
    expect(payloads[0]).toEqual({ summary: "Asked to reschedule", notes: null, consult_outcome: "reschedule_requested" });
    expect(payloads[1]).toEqual({ summary: "Rebooked after no-show", notes: "Thursday 3pm", consult_outcome: "rebooked_after_no_show" });
  });

  it("notifies the owner and each intake member except the actor, once each, under the dedicated consult_outcome kind", async () => {
    await logConsultOutcome("lead-1", { outcome: "no_show" });
    expect(recipients()).toEqual([AMOR, DAWN, OWNER].sort());
    for (const [call] of notify.mock.calls) {
      expect(call).toMatchObject({
        kind: "consult_outcome",
        leadId: "lead-1",
        activityId: "act-1",
        actorId: ACTOR,
        payload: { source: "consult_outcome", outcome: "no_show", lead_name: "Ana Ruiz", preview: "No-show: Ana Ruiz" },
      });
    }
  });

  it("notifies an owner who is also an intake member once", async () => {
    state.lead = { ...state.lead, assigned_to: DAWN };
    await logConsultOutcome("lead-1", { outcome: "no_show" });
    expect(recipients()).toEqual([AMOR, DAWN]);
  });

  it("does not notify the logger, even when they own the lead", async () => {
    state.lead = { ...state.lead, assigned_to: ACTOR };
    await logConsultOutcome("lead-1", { outcome: "reschedule_requested" });
    expect(recipients()).not.toContain(ACTOR);
    expect(recipients()).toEqual([AMOR, DAWN]);
  });

  it("still succeeds, with the activity written, when notify rejects", async () => {
    notify.mockImplementation(async () => {
      throw new Error("bell down");
    });
    await expect(logConsultOutcome("lead-1", { outcome: "no_show" })).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalled();
  });

  it("still succeeds, with the activity written, when the member directory throws", async () => {
    state.directoryThrows = true;
    await expect(logConsultOutcome("lead-1", { outcome: "no_show" })).resolves.toBeUndefined();
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it("still notifies, without an activity id, when the row can't be found again", async () => {
    state.activityRow = null;
    await logConsultOutcome("lead-1", { outcome: "no_show" });
    expect(notify).toHaveBeenCalled();
    expect(notify.mock.calls[0][0].activityId).toBeNull();
  });

  it("refuses an invalid outcome with a sentence and writes nothing", async () => {
    for (const outcome of ["", "ghosted", undefined, null]) {
      await expect(logConsultOutcome("lead-1", { outcome })).rejects.toThrow("Choose what happened to the consult.");
    }
    expect(logActivity).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses a note over NOTE_MAX_LENGTH", async () => {
    await expect(
      logConsultOutcome("lead-1", { outcome: "no_show", note: "x".repeat(NOTE_MAX_LENGTH + 1) }),
    ).rejects.toThrow(/under 5000 characters/);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it.each(["viewer", "social_media"])("refuses the %s role: no activity, no notification", async (role) => {
    state.role = role;
    await expect(logConsultOutcome("lead-1", { outcome: "no_show" })).rejects.toMatchObject({ forbidden: true });
    expect(logActivity).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("says 'Lead not found.' for a lead the scoped client can't see, and writes nothing", async () => {
    state.lead = null;
    await expect(logConsultOutcome("someone-elses", { outcome: "no_show" })).rejects.toThrow("Lead not found.");
    expect(logActivity).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("surfaces a failed activity write to the caller and notifies nobody", async () => {
    logActivity.mockImplementation(async () => {
      throw new Error("insert failed");
    });
    await expect(logConsultOutcome("lead-1", { outcome: "no_show" })).rejects.toThrow("insert failed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("never queues a draft or writes anything itself (the one write is logActivity)", async () => {
    await logConsultOutcome("lead-1", { outcome: "no_show" });
    expect(createDraft).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
});

describe("logConsultOutcomeAction", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("returns saved on success", async () => {
    expect(await logConsultOutcomeAction({}, form({ leadId: "lead-1", outcome: "no_show", note: "" }))).toEqual({ saved: true });
  });

  it("returns a friendly error, never a raw Postgres string, when the data layer throws", async () => {
    logActivity.mockImplementation(async () => {
      throw { code: "42P01", message: 'relation "crm_activity" does not exist' };
    });
    const res = await logConsultOutcomeAction({}, form({ leadId: "lead-1", outcome: "no_show" }));
    expect(res).toEqual({ error: "Couldn't save this outcome." });
  });

  it("turns a role refusal into the permission sentence", async () => {
    state.role = "viewer";
    const res = await logConsultOutcomeAction({}, form({ leadId: "lead-1", outcome: "no_show" }));
    expect(res.error).toMatch(/permission/);
    expect(res.error).not.toMatch(/Forbidden: role/);
  });

  it("passes an invalid outcome back as a sentence", async () => {
    const res = await logConsultOutcomeAction({}, form({ leadId: "lead-1", outcome: "nope" }));
    expect(res.error).toBe("Choose what happened to the consult.");
  });
});

describe("no send path", () => {
  it("the new files never mention a draft or a send", () => {
    const root = path.resolve(__dirname, "../..");
    for (const rel of [
      "src/lib/pipeline/consult-outcome.ts",
      "src/lib/pipeline/consult-outcome-labels.ts",
      "src/app/dashboard/leads/[id]/outcome-actions.ts",
      "src/components/leads/ConsultOutcomeForm.tsx",
    ]) {
      expect(readFileSync(path.join(root, rel), "utf8")).not.toMatch(/createDraft|sendProposal|resolveQueueItem|sendMail/);
    }
  });
});
