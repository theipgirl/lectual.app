import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, writesTo, type FakeDb } from "./helpers/fake-db";
import { READ_ONLY_ROLES, WRITE_ROLES, formData, standardSeed } from "./helpers/seed";
import { TASK_TITLE_MAX, validateTaskEdit } from "@/lib/matters/task-edit";

const h = vi.hoisted(() => ({
  db: null as unknown as { client(): unknown },
  members: [] as Array<{ userId: string }>,
  membersFail: false,
}));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: vi.fn(async () => {
    if (h.membersFail) throw new Error("directory down");
    return h.members;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { updateTask, deleteTask, createTask, completeTask } = await import("@/lib/matters/tasks");
const { updateTaskAction, deleteTaskAction, createTaskAction, completeTaskAction } = await import("../../src/app/dashboard/matters/[id]/actions");

let db: FakeDb;
const task = (id: string) => db.rows("crm_task").find((r) => r.id === id);
beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
  h.members = [{ userId: "user-2" }, { userId: "user-3" }];
  h.membersFail = false;
});

describe("validateTaskEdit (pure)", () => {
  const cur = { title: "Call the client", due_at: "2026-10-30T00:00:00Z", assignee_id: null as string | null };
  it("returns only the changed columns and compares the due date by day", () => {
    expect(validateTaskEdit({ title: "Call the client", dueAt: "2026-10-30" }, cur)).toMatchObject({ ok: true, patch: {}, fields: [] });
    expect(validateTaskEdit({ title: "Call back", dueAt: "2026-11-02", assigneeId: "user-2" }, cur)).toEqual({
      ok: true,
      patch: { title: "Call back", due_at: "2026-11-02", assignee_id: "user-2" },
      fields: ["title", "due_at", "assignee_id"],
    });
  });
  it("refuses an empty or long title and a fake date, and clears the date or assignee when blank", () => {
    expect(validateTaskEdit({ title: "  " }, cur)).toEqual({ ok: false, error: "Enter a task title." });
    expect(validateTaskEdit({ title: "x".repeat(TASK_TITLE_MAX + 1) }, cur).ok).toBe(false);
    expect(validateTaskEdit({ dueAt: "2026-13-40" }, cur).ok).toBe(false);
    expect(validateTaskEdit({ dueAt: "" }, cur)).toMatchObject({ ok: true, patch: { due_at: null } });
    expect(validateTaskEdit({ assigneeId: "" }, { ...cur, assignee_id: "user-2" })).toMatchObject({ ok: true, patch: { assignee_id: null } });
  });
});

describe("updateTask", () => {
  it("edits the title and due date, and logs 'Task edited' with field names only", async () => {
    await updateTask("task-1", { title: "Call back about classes", dueAt: "2026-11-05" });
    expect(task("task-1")).toMatchObject({ title: "Call back about classes", due_at: "2026-11-05" });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0]).toMatchObject({ matter_id: "matter-1", lead_id: null });
    expect(db.activity()[0].payload).toEqual({ change: "task_edited", task_id: "task-1", fields: ["title", "due_at"] });
    expect(JSON.stringify(db.activity()[0].payload)).not.toContain("classes");
  });

  it("assigns to a member of this firm and logs 'Task assigned' with the new assignee's id", async () => {
    await updateTask("task-1", { assigneeId: "user-2" });
    expect(task("task-1")!.assignee_id).toBe("user-2");
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "task_assigned", task_id: "task-1", title: "Call the client", assignee_id: "user-2" });
  });

  it("logs both rows when a save changes the title and the assignee", async () => {
    await updateTask("task-1", { title: "New", assigneeId: "user-3" });
    expect(db.activity().map((a) => (a.payload as { change: string }).change)).toEqual(["task_edited", "task_assigned"]);
  });

  it("refuses an assignee who isn't in the member directory, writing nothing", async () => {
    await expect(updateTask("task-1", { assigneeId: "user-from-another-firm" })).rejects.toThrow(/isn't a member of your firm/);
    expect(db.writes).toEqual([]);
  });

  it("refuses an assignment when the directory can't be read, instead of allowing it unchecked", async () => {
    h.membersFail = true;
    await expect(updateTask("task-1", { assigneeId: "user-2" })).rejects.toThrow(/Couldn't check the team list/);
    expect(db.writes).toEqual([]);
  });

  it("clears the assignee without needing the directory", async () => {
    task("task-1")!.assignee_id = "user-2";
    h.membersFail = true;
    await updateTask("task-1", { assigneeId: "" });
    expect(task("task-1")!.assignee_id).toBeNull();
    expect(db.activity()[0].payload).toMatchObject({ change: "task_assigned", assignee_id: null });
  });

  it("refuses an empty title and writes nothing; an unchanged save writes nothing", async () => {
    await expect(updateTask("task-1", { title: "   " })).rejects.toThrow(/Enter a task title/);
    await updateTask("task-1", { title: "Call the client", dueAt: "2026-10-30", assigneeId: "" });
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("takes the timeline target from the task row, not from anything posted", async () => {
    // The form posts another matter's id; the log still lands on the task's own matter.
    db.role = "attorney";
    await updateTaskAction({}, formData({ taskId: "task-1", matterId: "matter-x", title: "Retitled" }));
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].matter_id).toBe("matter-1");
  });

  it("logs a lead-only task against its lead", async () => {
    db.rows("crm_task").push({ id: "task-lead", org_id: "org-1", matter_id: null, lead_id: "lead-1", title: "Follow up", due_at: null, assignee_id: null, status: "open", type: "custom" });
    db.rows("crm_lead").push({ id: "lead-1", org_id: "org-1", last_activity_at: null });
    await updateTask("task-lead", { title: "Follow up soon" });
    expect(db.activity()[0]).toMatchObject({ lead_id: "lead-1", matter_id: null });
  });

  it("reports another firm's task as not found", async () => {
    await expect(updateTask("task-x", { title: "Hijack" })).rejects.toThrow(/task couldn't be found/);
    expect(db.writes).toEqual([]);
  });
});

describe("deleteTask", () => {
  it("removes the task and logs 'Task deleted' with its title against the task's own matter", async () => {
    await deleteTask("task-1");
    expect(task("task-1")).toBeUndefined();
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0]).toMatchObject({ matter_id: "matter-1" });
    expect(db.activity()[0].payload).toEqual({ change: "task_deleted", task_id: "task-1", title: "Call the client" });
  });

  it("reports another firm's task as not found, and a zero-row delete as a failure", async () => {
    await expect(deleteTask("task-x")).rejects.toThrow(/couldn't be found/);
    expect(task("task-x")).toBeDefined();
    db.denyDeletes.add("crm_task");
    await expect(deleteTask("task-1")).rejects.toThrow(/couldn't be deleted/);
    expect(db.activity()).toEqual([]);
  });
});

describe("task actions (role matrix)", () => {
  const post = (id: string, extra: Record<string, string> = {}) => formData({ matterId: "matter-1", taskId: id, ...extra });

  it.each(READ_ONLY_ROLES)("refuses %s for edit, assign and delete without writing", async (role) => {
    db.role = role;
    for (const result of [
      await updateTaskAction({}, post("task-1", { title: "x" })),
      await updateTaskAction({}, post("task-1", { assigneeId: "user-2" })),
      await deleteTaskAction({}, post("task-1")),
    ]) {
      expect(result.error).toMatch(/permission/i);
    }
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s edit, assign and delete", async (role) => {
    db.role = role;
    expect(await updateTaskAction({}, post("task-1", { title: "Edited", dueAt: "2026-11-01" }))).toEqual({ saved: true });
    expect(await updateTaskAction({}, post("task-1", { assigneeId: "user-2" }))).toEqual({ saved: true });
    expect(await deleteTaskAction({}, post("task-1"))).toEqual({});
    expect(db.activity().map((a) => (a.payload as { change: string }).change)).toEqual(["task_edited", "task_assigned", "task_deleted"]);
  });

  it("returns 'couldn't be found' for another firm's task", async () => {
    for (const result of [await updateTaskAction({}, post("task-x", { title: "x" })), await deleteTaskAction({}, post("task-x"))]) {
      expect(result.error).toMatch(/couldn't be found/);
    }
    expect(db.writes).toEqual([]);
  });

  it("shows a database failure without its raw text", async () => {
    db.fail("crm_task", "update");
    const result = await updateTaskAction({}, post("task-1", { title: "Edited" }));
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/boom|internal detail/);
  });
});

describe("create and complete behave as before", () => {
  it("createTask still inserts with the matter's org_id and writes no activity", async () => {
    const created = await createTask({ matterId: "matter-1", title: "New task", dueAt: "2026-12-01" });
    expect(created).toMatchObject({ org_id: "org-1", matter_id: "matter-1", title: "New task", assignee_id: null });
    expect(db.activity()).toEqual([]);
  });
  it("completeTask still marks the task completed without logging", async () => {
    await completeTask("task-1");
    expect(task("task-1")!.status).toBe("completed");
    expect(db.activity()).toEqual([]);
  });
  it("the create and complete actions still work for a write role and refuse a viewer", async () => {
    expect(await createTaskAction({}, formData({ matterId: "matter-1", title: "Another" }))).toEqual({});
    expect(await completeTaskAction({}, formData({ matterId: "matter-1", taskId: "task-1" }))).toEqual({});
    db.role = "viewer";
    expect((await createTaskAction({}, formData({ matterId: "matter-1", title: "Nope" }))).error).toMatch(/permission/i);
    expect(writesTo(db, "crm_task").length).toBe(2);
  });
});
