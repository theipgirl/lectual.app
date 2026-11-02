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
});
