import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, writesTo, type FakeDb } from "./helpers/fake-db";
import { READ_ONLY_ROLES, WRITE_ROLES, formData, standardSeed } from "./helpers/seed";
import { DEADLINE_TITLE_MAX, validateDeadlineEdit } from "@/lib/matters/deadline-edit";

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown } }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { updateDeadline, reopenDeadline, deleteDeadline, confirmDeadline, closeDeadline, DEADLINE_DELETE_ROLES, DEADLINE_CONFIRM_ROLES } = await import("@/lib/matters/deadlines");
const { updateDeadlineAction, reopenDeadlineAction, deleteDeadlineAction, closeDeadlineAction } = await import("../../src/app/dashboard/matters/[id]/actions");

let db: FakeDb;
const deadline = (id: string) => db.rows("crm_matter_deadline").find((r) => r.id === id);
beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
});

describe("validateDeadlineEdit (pure)", () => {
  const cur = { due_date: "2026-11-03", title: null as string | null };
  it("returns only what changed and says whether the date moved", () => {
    expect(validateDeadlineEdit({ dueDate: "2026-11-10", title: "" }, cur)).toEqual({ ok: true, patch: { due_date: "2026-11-10" }, dateMoved: true, fields: ["due_date"] });
    expect(validateDeadlineEdit({ dueDate: "2026-11-03", title: "Respond" }, cur)).toEqual({ ok: true, patch: { title: "Respond" }, dateMoved: false, fields: ["title"] });
    expect(validateDeadlineEdit({ dueDate: "2026-11-03" }, cur)).toMatchObject({ ok: true, fields: [], dateMoved: false });
  });
  it("refuses a date that isn't a real calendar date, a blank date and a long title", () => {
    for (const dueDate of ["2026-02-30", "11/03/2026", "soon"]) {
      expect(validateDeadlineEdit({ dueDate }, cur)).toEqual({ ok: false, error: "Enter a real calendar date for the deadline." });
    }
    expect(validateDeadlineEdit({ dueDate: "" }, cur)).toEqual({ ok: false, error: "Enter the due date." });
    expect(validateDeadlineEdit({ title: "x".repeat(DEADLINE_TITLE_MAX + 1) }, cur).ok).toBe(false);
    expect(validateDeadlineEdit({ title: "x".repeat(DEADLINE_TITLE_MAX) }, cur).ok).toBe(true);
  });
  it("clears the title when it is blank", () => {
    expect(validateDeadlineEdit({ title: "  " }, { ...cur, title: "Old" })).toMatchObject({ ok: true, patch: { title: null } });
  });
});

describe("updateDeadline", () => {
  it("changes the date and title of an open deadline and logs 'Deadline edited'", async () => {
    await updateDeadline("dl-open", { dueDate: "2026-11-20", title: "Respond to Office Action" });
    expect(deadline("dl-open")).toMatchObject({ due_date: "2026-11-20", title: "Respond to Office Action", status: "open" });
    expect(typeof (writesTo(db, "crm_matter_deadline")[0].payload as Record<string, unknown>).updated_at).toBe("string");
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0]).toMatchObject({ matter_id: "matter-1", type: "matter_updated" });
    expect(db.activity()[0].payload).toMatchObject({ change: "deadline_edited", kind: "office_action_response", due_date: "2026-11-20", from: "2026-11-03", title_changed: true });
  });

  it("clears the attorney confirmation in the same write when a confirmed date moves", async () => {
    await updateDeadline("dl-conf", { dueDate: "2026-12-15" });
    expect(deadline("dl-conf")).toMatchObject({ due_date: "2026-12-15", attorney_confirmed: false, confirmed_by: null, confirmed_at: null });
    expect(writesTo(db, "crm_matter_deadline")).toHaveLength(1);
    expect(db.activity()[0].payload).toMatchObject({ confirmation_cleared: true });
  });

  it("keeps the confirmation on a title-only edit", async () => {
    await updateDeadline("dl-conf", { title: "Statement of Use (renamed)", dueDate: "2026-12-01" });
    expect(deadline("dl-conf")).toMatchObject({ title: "Statement of Use (renamed)", attorney_confirmed: true, confirmed_by: "user-9" });
    expect((writesTo(db, "crm_matter_deadline")[0].payload as Record<string, unknown>).attorney_confirmed).toBeUndefined();
  });

  it("does not count as an extension", async () => {
    await updateDeadline("dl-open", { dueDate: "2026-11-30" });
    expect(deadline("dl-open")!.extensions_used).toBe(0);
  });

  it("refuses a bad date, and a closed deadline, with a sentence and no write", async () => {
    await expect(updateDeadline("dl-open", { dueDate: "2026-02-31" })).rejects.toThrow(/real calendar date/);
    await expect(updateDeadline("dl-closed", { dueDate: "2026-12-31" })).rejects.toThrow(/Only an open deadline/);
    expect(db.writes).toEqual([]);
  });

  it("writes nothing when nothing changed", async () => {
    await updateDeadline("dl-open", { dueDate: "2026-11-03", title: "" });
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("reports another firm's deadline as not found", async () => {
    await expect(updateDeadline("dl-x", { title: "Hijack" })).rejects.toThrow(/deadline couldn't be found/);
    expect(db.writes).toEqual([]);
  });
});

describe("reopenDeadline", () => {
  it.each(["satisfied", "waived", "superseded"])("turns a %s deadline back to open and clears the satisfied time", async (status) => {
    deadline("dl-closed")!.status = status;
    await reopenDeadline("dl-closed");
    expect(deadline("dl-closed")).toMatchObject({ status: "open", satisfied_at: null });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toMatchObject({ change: "deadline_reopened", kind: "other", from_status: status });
  });

  it("leaves the confirmation as it was (the date did not move)", async () => {
    Object.assign(deadline("dl-closed")!, { attorney_confirmed: true, confirmed_by: "user-9", confirmed_at: "2026-09-01T00:00:00Z" });
    await reopenDeadline("dl-closed");
    expect(deadline("dl-closed")).toMatchObject({ attorney_confirmed: true, confirmed_by: "user-9" });
  });

  it("refuses an already open deadline", async () => {
    await expect(reopenDeadline("dl-open")).rejects.toThrow(/already open/);
    expect(db.writes).toEqual([]);
  });

  it("says so when another open deadline of the same kind blocks it, without the constraint name", async () => {
    db.fail("crm_matter_deadline", "update", { code: "23505", message: 'duplicate key value violates unique constraint "crm_matter_deadline_one_open_per_kind"' });
    await expect(reopenDeadline("dl-closed")).rejects.toThrow(/already has another open/);
  });

  it("reports another firm's deadline as not found", async () => {
    await expect(reopenDeadline("dl-x")).rejects.toThrow(/couldn't be found/);
  });
});

describe("deleteDeadline", () => {
  it.each(DEADLINE_DELETE_ROLES)("lets %s remove an unconfirmed deadline and logs one row with its kind and date", async (role) => {
    db.role = role;
    await deleteDeadline("dl-open");
    expect(deadline("dl-open")).toBeUndefined();
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0]).toMatchObject({ matter_id: "matter-1" });
    expect(db.activity()[0].payload).toEqual({ change: "deadline_deleted", kind: "office_action_response", title: null, due_date: "2026-11-03", status: "open" });
  });

  it("keeps the timeline row after the deadline is gone", async () => {
    db.role = "owner";
    await deleteDeadline("dl-closed");
    expect(deadline("dl-closed")).toBeUndefined();
    expect(db.activity().filter((a) => (a.payload as { change: string }).change === "deadline_deleted")).toHaveLength(1);
  });

  it.each(["owner", "admin", "senior_admin", "attorney"])("refuses a confirmed deadline for %s", async (role) => {
    db.role = role;
    await expect(deleteDeadline("dl-conf")).rejects.toThrow(/can't be deleted|Only an owner/);
    expect(deadline("dl-conf")).toBeDefined();
    expect(writesTo(db, "crm_matter_deadline")).toEqual([]);
  });

  it.each(["attorney", "paralegal", "intake", "clerk", "law_clerk", "viewer", "social_media"])("refuses an unconfirmed deadline for %s, leaving the row and logging nothing", async (role) => {
    db.role = role;
    await expect(deleteDeadline("dl-open")).rejects.toThrow(/Only an owner or an admin/);
    expect(deadline("dl-open")).toBeDefined();
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("reports another firm's deadline as not found and logs nothing", async () => {
    db.role = "owner";
    await expect(deleteDeadline("dl-x")).rejects.toThrow(/deadline couldn't be found/);
    expect(deadline("dl-x")).toBeDefined();
    expect(db.activity()).toEqual([]);
  });

  it("does not claim success when the database removed nothing", async () => {
    db.role = "owner";
    db.denyDeletes.add("crm_matter_deadline"); // RLS filters the delete down to zero rows, with no error
    await expect(deleteDeadline("dl-open")).rejects.toThrow(/couldn't be deleted/);
    expect(deadline("dl-open")).toBeDefined();
    expect(db.activity()).toEqual([]);
  });
});

describe("confirming stays owner and attorney only", () => {
  it("lists exactly owner and attorney", () => {
    expect([...DEADLINE_CONFIRM_ROLES]).toEqual(["owner", "attorney"]);
  });
  it.each(["owner", "attorney"])("%s can confirm", async (role) => {
    db.role = role;
    await confirmDeadline("dl-open");
    expect(deadline("dl-open")!.attorney_confirmed).toBe(true);
  });
  it.each(["admin", "senior_admin", "paralegal", "intake", "clerk", "law_clerk", "viewer", "social_media"])("%s cannot", async (role) => {
    db.role = role;
    await expect(confirmDeadline("dl-open")).rejects.toThrow(/Only a licensed attorney/);
    expect(deadline("dl-open")!.attorney_confirmed).toBe(false);
  });
  it("close still closes (the existing docket action is unchanged)", async () => {
    await closeDeadline("dl-open", "waived");
    expect(deadline("dl-open")!.status).toBe("waived");
  });
});

describe("deadline actions (role matrix)", () => {
  const post = (id: string, extra: Record<string, string> = {}) => formData({ matterId: "matter-1", deadlineId: id, ...extra });

  it.each(READ_ONLY_ROLES)("refuses %s for edit, reopen and delete without writing", async (role) => {
    db.role = role;
    for (const result of [
      await updateDeadlineAction({}, post("dl-open", { title: "x" })),
      await reopenDeadlineAction({}, post("dl-closed")),
      await deleteDeadlineAction({}, post("dl-open")),
    ]) {
      expect(result.error).toMatch(/permission/i);
    }
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s edit and reopen", async (role) => {
    db.role = role;
    expect(await updateDeadlineAction({}, post("dl-open", { title: "New title", dueDate: "2026-11-09" }))).toEqual({ saved: true });
    expect(await reopenDeadlineAction({}, post("dl-closed"))).toEqual({});
    expect(db.activity()).toHaveLength(2);
  });

  it.each(WRITE_ROLES)("delete is allowed for %s only when the role is owner, admin or senior_admin", async (role) => {
    db.role = role;
    const result = await deleteDeadlineAction({}, post("dl-open"));
    if ((DEADLINE_DELETE_ROLES as readonly string[]).includes(role)) {
      expect(result).toEqual({});
      expect(deadline("dl-open")).toBeUndefined();
    } else {
      expect(result.error).toMatch(/Only an owner or an admin/);
      expect(deadline("dl-open")).toBeDefined();
      expect(db.writes).toEqual([]);
    }
  });

  it("returns 'couldn't be found' for another firm's deadline on every action", async () => {
    db.role = "owner";
    for (const result of [await updateDeadlineAction({}, post("dl-x", { title: "x" })), await reopenDeadlineAction({}, post("dl-x")), await deleteDeadlineAction({}, post("dl-x"))]) {
      expect(result.error).toMatch(/couldn't be found/);
    }
    expect(db.writes).toEqual([]);
  });

  it("the existing close action still works", async () => {
    expect(await closeDeadlineAction({}, post("dl-open", { status: "satisfied" }))).toEqual({});
  });
});
