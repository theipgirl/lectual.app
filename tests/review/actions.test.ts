import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

const createTask = vi.fn(async () => ({}));
const completeTask = vi.fn(async () => ({}));
const addMatterNote = vi.fn(async () => {});
const addLeadNote = vi.fn(async () => {});
let role = "attorney";
let visible = true;
let members = [{ userId: USER }];

function setup() {
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: async () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: ID, status: "open" } : null, error: null }) }) }) }),
    }),
  }));
  vi.doMock("@/lib/pipeline", () => ({
    CAN_WRITE_LEAD: ["owner", "attorney"], resolveCurrentRole: async () => role, addLeadNote,
  }));
  vi.doMock("@/lib/matters/matters", () => ({ MATTER_WRITE_ROLES: ["owner", "attorney"] }));
  vi.doMock("@/lib/matters/notes", () => ({ addMatterNote }));
  vi.doMock("@/lib/matters/tasks", () => ({ createTask, completeTask }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => members }));
}

describe("review actions", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); role = "attorney"; visible = true; members = [{ userId: USER }]; setup(); });

  it("sets a next step on a matter through createTask", async () => {
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    const res = await setNextStepAction({}, fd({ kind: "matter", id: ID, title: "Call", dueAt: "2026-11-05", assigneeId: USER }));
    expect(res).toEqual({ saved: true });
    expect(createTask).toHaveBeenCalledWith({ title: "Call", matterId: ID, dueAt: "2026-11-05", assigneeId: USER });
  });
  it("uses leadId for a lead", async () => {
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    await setNextStepAction({}, fd({ kind: "lead", id: ID, title: "Call" }));
    expect(createTask).toHaveBeenCalledWith({ title: "Call", leadId: ID, dueAt: undefined, assigneeId: undefined });
  });
  it("refuses a viewer with a fixed sentence and writes nothing", async () => {
    role = "viewer";
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    const res = await setNextStepAction({}, fd({ kind: "matter", id: ID, title: "Call" }));
    expect(res.error).toMatch(/permission/);
    expect(createTask).not.toHaveBeenCalled();
  });
  it("treats an invisible record as not found", async () => {
    visible = false;
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    expect((await setNextStepAction({}, fd({ kind: "matter", id: ID, title: "Call" }))).error).toMatch(/couldn't be found/);
    expect(createTask).not.toHaveBeenCalled();
  });
  it("refuses an assignee outside the firm", async () => {
    members = [];
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    expect((await setNextStepAction({}, fd({ kind: "matter", id: ID, title: "Call", assigneeId: USER }))).error).toMatch(/isn't a member/);
    expect(createTask).not.toHaveBeenCalled();
  });
  it("rejects bad input before any read", async () => {
    const { setNextStepAction } = await import("../../src/app/dashboard/review/actions");
    expect((await setNextStepAction({}, fd({ kind: "matter", id: ID, title: "" }))).error).toBeTruthy();
  });
  it("completes an open task; viewer cannot", async () => {
    const { completeNextStepAction } = await import("../../src/app/dashboard/review/actions");
    expect(await completeNextStepAction({}, fd({ taskId: ID }))).toEqual({ saved: true });
    expect(completeTask).toHaveBeenCalledWith(ID);
    role = "viewer";
    expect((await completeNextStepAction({}, fd({ taskId: ID }))).error).toMatch(/permission/);
  });
  it("logs a note on the right record kind", async () => {
    const { logWhatHappenedAction } = await import("../../src/app/dashboard/review/actions");
    await logWhatHappenedAction({}, fd({ kind: "matter", id: ID, body: "Spoke" }));
    expect(addMatterNote).toHaveBeenCalledWith(ID, { kind: "note", body: "Spoke" });
    await logWhatHappenedAction({}, fd({ kind: "lead", id: ID, body: "Spoke" }));
    expect(addLeadNote).toHaveBeenCalledWith(ID, { kind: "note", body: "Spoke" });
  });
  it("refuses a note on another firm's (or a missing) lead or matter and writes nothing", async () => {
    visible = false;
    const { logWhatHappenedAction } = await import("../../src/app/dashboard/review/actions");
    for (const kind of ["lead", "matter"]) {
      const res = await logWhatHappenedAction({}, fd({ kind, id: ID, body: "Spoke" }));
      expect(res).toEqual({ error: "That record couldn't be found. It may have been removed." });
    }
    expect(addLeadNote).not.toHaveBeenCalled();
    expect(addMatterNote).not.toHaveBeenCalled();
  });
});

describe("closeLeadAction (Lost / Nurture)", () => {
  const STAGE = "00000000-0000-4000-8000-000000000009";
  const moveLeadStage = vi.fn(async () => ({}));
  let category = "lost";
  let leadStage = "00000000-0000-4000-8000-000000000008";
  let leadFound = true;
  let stageFound = true;
  let canMove = true;

  function setupClose() {
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === "crm_lead"
                  ? { data: leadFound ? { id: ID, current_stage_id: leadStage } : null, error: null }
                  : { data: stageFound ? { id: STAGE, name: "Nurture 2027", category } : null, error: null },
            }),
          }),
        }),
      }),
    }));
    vi.doMock("@/lib/pipeline", () => ({
      CAN_WRITE_LEAD: ["owner", "attorney", "paralegal"],
      CAN_MOVE_STAGE: canMove ? ["owner", "attorney"] : [],
      resolveCurrentRole: async () => role,
      addLeadNote,
      moveLeadStage,
    }));
    vi.doMock("@/lib/matters/matters", () => ({ MATTER_WRITE_ROLES: ["owner", "attorney"] }));
    vi.doMock("@/lib/matters/notes", () => ({ addMatterNote }));
    vi.doMock("@/lib/matters/tasks", () => ({ createTask, completeTask }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => members }));
  }

  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    role = "attorney"; category = "lost"; leadFound = true; stageFound = true; canMove = true;
    leadStage = "00000000-0000-4000-8000-000000000008";
    setupClose();
  });

  it("moves with moveLeadStage, then saves the reason as a lead note", async () => {
    const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
    const res = await closeLeadAction({}, fd({ id: ID, stageId: STAGE, reason: "Went quiet" }));
    expect(res).toEqual({ saved: true });
    expect(moveLeadStage).toHaveBeenCalledWith(ID, STAGE);
    expect(addLeadNote).toHaveBeenCalledWith(ID, { kind: "note", body: "Moved to Nurture 2027: Went quiet" });
    expect(moveLeadStage.mock.invocationCallOrder[0]).toBeLessThan(addLeadNote.mock.invocationCallOrder[0]);
    expect(createTask).not.toHaveBeenCalled();
    expect(completeTask).not.toHaveBeenCalled();
  });
  it("writes no note without a reason", async () => {
    const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
    expect(await closeLeadAction({}, fd({ id: ID, stageId: STAGE }))).toEqual({ saved: true });
    expect(addLeadNote).not.toHaveBeenCalled();
  });
  it("refuses a role that cannot move stages", async () => {
    role = "viewer";
    const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
    expect((await closeLeadAction({}, fd({ id: ID, stageId: STAGE }))).error).toMatch(/permission/);
    expect(moveLeadStage).not.toHaveBeenCalled();
  });
  it("refuses a stage that is not lost or nurture", async () => {
    for (const c of ["open", "won"]) {
      vi.resetModules(); category = c; setupClose();
      const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
      expect((await closeLeadAction({}, fd({ id: ID, stageId: STAGE }))).error).toMatch(/Lost or Nurture/);
    }
    expect(moveLeadStage).not.toHaveBeenCalled();
  });
  it("treats a foreign (invisible) stage or lead as refused / not found", async () => {
    stageFound = false;
    const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
    expect((await closeLeadAction({}, fd({ id: ID, stageId: STAGE }))).error).toMatch(/Lost or Nurture/);
    vi.resetModules(); stageFound = true; leadFound = false; setupClose();
    const again = await import("../../src/app/dashboard/review/actions");
    expect((await again.closeLeadAction({}, fd({ id: ID, stageId: STAGE }))).error).toMatch(/couldn't be found/);
    expect(moveLeadStage).not.toHaveBeenCalled();
  });
  it("rejects a reason over 200 characters before any read", async () => {
    const { closeLeadAction } = await import("../../src/app/dashboard/review/actions");
    expect((await closeLeadAction({}, fd({ id: ID, stageId: STAGE, reason: "x".repeat(201) }))).error).toMatch(/200/);
  });
});

describe("panel actions", () => {
  const TASK = "00000000-0000-4000-8000-000000000003";
  const STAGE = "00000000-0000-4000-8000-000000000009";
  const updateTask = vi.fn(async () => ({}));
  const updateMatterStage = vi.fn(async () => {});
  const assignMatterOwner = vi.fn(async () => ({}));
  const assignLead = vi.fn(async () => ({}));
  const moveLeadStage = vi.fn(async () => ({}));
  let taskStatus: string | null = "open";
  let stageCategory = "open";
  let leadStage = "00000000-0000-4000-8000-000000000008";

  function setupPanel() {
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (table === "crm_task") return { data: taskStatus ? { id: TASK, status: taskStatus } : null, error: null };
                if (table === "crm_stage") return { data: { id: STAGE, category: stageCategory }, error: null };
                if (table === "crm_lead") return { data: { id: ID, current_stage_id: leadStage }, error: null };
                return { data: { id: ID }, error: null };
              },
            }),
          }),
        }),
      }),
    }));
    vi.doMock("@/lib/pipeline", () => ({
      CAN_WRITE_LEAD: ["owner", "attorney", "paralegal"],
      CAN_MOVE_STAGE: ["owner", "attorney"],
      resolveCurrentRole: async () => role,
      addLeadNote, assignLead, moveLeadStage,
    }));
    vi.doMock("@/lib/matters/matters", () => ({ MATTER_WRITE_ROLES: ["owner", "attorney", "paralegal"], assignMatterOwner }));
    vi.doMock("@/lib/matters/stages", () => ({ updateMatterStage }));
    vi.doMock("@/lib/matters/notes", () => ({ addMatterNote }));
    vi.doMock("@/lib/matters/tasks", () => ({ createTask, completeTask, updateTask }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: async () => members }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
  }
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    role = "attorney"; taskStatus = "open"; stageCategory = "open"; members = [{ userId: USER }];
    leadStage = "00000000-0000-4000-8000-000000000008";
    setupPanel();
  });

  it("edits only the posted fields of the existing step through updateTask", async () => {
    const { updateNextStepAction } = await import("../../src/app/dashboard/review/actions");
    const res = await updateNextStepAction({}, fd({ taskId: TASK, title: " New ", dueAt: "2026-11-12", assigneeId: USER }));
    expect(res).toEqual({ saved: true });
    expect(updateTask).toHaveBeenCalledWith(TASK, { title: " New ", dueAt: "2026-11-12", assigneeId: USER });
    await updateNextStepAction({}, fd({ taskId: TASK, assigneeId: "" }));
    expect(updateTask).toHaveBeenLastCalledWith(TASK, { assigneeId: "" });
    expect(createTask).not.toHaveBeenCalled();
  });
  it("refuses a viewer, a missing task and a finished one, writing nothing", async () => {
    const { updateNextStepAction } = await import("../../src/app/dashboard/review/actions");
    role = "viewer";
    expect((await updateNextStepAction({}, fd({ taskId: TASK, title: "x" }))).error).toMatch(/permission/);
    role = "attorney"; taskStatus = null;
    expect((await updateNextStepAction({}, fd({ taskId: TASK, title: "x" }))).error).toMatch(/couldn't be found/);
    taskStatus = "completed";
    expect((await updateNextStepAction({}, fd({ taskId: TASK, title: "x" }))).error).toMatch(/already done/);
    expect((await updateNextStepAction({}, fd({ taskId: "nope", title: "x" }))).error).toMatch(/couldn't be found/);
    expect(updateTask).not.toHaveBeenCalled();
  });
  it("snooze moves the due date only, computed from the firm's date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T15:00:00Z")); // a Monday in New York
    try {
      const { snoozeNextStepAction } = await import("../../src/app/dashboard/review/actions");
      expect(await snoozeNextStepAction({}, fd({ taskId: TASK, when: "monday" }))).toEqual({ saved: true });
      expect(updateTask).toHaveBeenCalledWith(TASK, { dueAt: "2026-11-16" });
      await snoozeNextStepAction({}, fd({ taskId: TASK, when: "tomorrow" }));
      expect(updateTask).toHaveBeenLastCalledWith(TASK, { dueAt: "2026-11-10" });
      expect((await snoozeNextStepAction({}, fd({ taskId: TASK, when: "never" }))).error).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("snooze late on Sunday night New York time still counts as Sunday there", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z")); // 10pm Sunday in New York
    try {
      const { snoozeNextStepAction } = await import("../../src/app/dashboard/review/actions");
      await snoozeNextStepAction({}, fd({ taskId: TASK, when: "tomorrow" }));
      expect(updateTask).toHaveBeenCalledWith(TASK, { dueAt: "2026-11-09" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("moves a matter through updateMatterStage and a lead through moveLeadStage", async () => {
    const { moveStageAction } = await import("../../src/app/dashboard/review/actions");
    expect(await moveStageAction({}, fd({ kind: "matter", id: ID, stageId: STAGE }))).toEqual({ saved: true });
    expect(updateMatterStage).toHaveBeenCalledWith(ID, STAGE);
    expect(await moveStageAction({}, fd({ kind: "lead", id: ID, stageId: STAGE }))).toEqual({ saved: true });
    expect(moveLeadStage).toHaveBeenCalledWith(ID, STAGE);
  });
  it("never moves a lead to a won stage, nor to its own stage, nor without CAN_MOVE_STAGE", async () => {
    const { moveStageAction } = await import("../../src/app/dashboard/review/actions");
    stageCategory = "won";
    expect((await moveStageAction({}, fd({ kind: "lead", id: ID, stageId: STAGE }))).error).toMatch(/won stage/);
    stageCategory = "open"; leadStage = STAGE;
    expect((await moveStageAction({}, fd({ kind: "lead", id: ID, stageId: STAGE }))).error).toMatch(/already in that stage/);
    leadStage = "00000000-0000-4000-8000-000000000008"; role = "paralegal";
    expect((await moveStageAction({}, fd({ kind: "lead", id: ID, stageId: STAGE }))).error).toMatch(/permission/);
    expect(moveLeadStage).not.toHaveBeenCalled();
    role = "viewer";
    expect((await moveStageAction({}, fd({ kind: "matter", id: ID, stageId: STAGE }))).error).toMatch(/permission/);
    expect(updateMatterStage).not.toHaveBeenCalled();
  });
  it("assigns through assignMatterOwner / assignLead, checks membership, and unassigns on empty", async () => {
    const { assignRecordAction } = await import("../../src/app/dashboard/review/actions");
    await assignRecordAction({}, fd({ kind: "matter", id: ID, userId: USER }));
    expect(assignMatterOwner).toHaveBeenCalledWith(ID, USER);
    await assignRecordAction({}, fd({ kind: "lead", id: ID, userId: "" }));
    expect(assignLead).toHaveBeenCalledWith(ID, null);
    members = [];
    expect((await assignRecordAction({}, fd({ kind: "lead", id: ID, userId: USER }))).error).toMatch(/isn't a member/);
    role = "viewer";
    expect((await assignRecordAction({}, fd({ kind: "lead", id: ID, userId: "" }))).error).toMatch(/permission/);
  });
});
