import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "./helpers/fake-db";
import { READ_ONLY_ROLES, WRITE_ROLES, formData, standardSeed } from "./helpers/seed";
import { NOTE_KINDS, NOTE_KIND_OPTIONS, NOTE_MAX_LENGTH, noteEntry } from "@/lib/pipeline/lead-input";

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown }, notify: vi.fn() }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
vi.mock("@/lib/notifications", () => ({ notify: h.notify }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { addMatterNote } = await import("@/lib/matters/notes");
const { addMatterNoteAction } = await import("../../src/app/dashboard/matters/[id]/actions");

let db: FakeDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeDb({ tables: { ...standardSeed(), crm_lead: [{ id: "lead-1", org_id: "org-1", last_activity_at: null }] } });
  h.db = db;
});

describe("the four entry kinds", () => {
  it("offers Note, Call, Email (logged) and Meeting, in that order", () => {
    expect(NOTE_KIND_OPTIONS.map(([, label]) => label)).toEqual(["Note", "Call", "Email (logged)", "Meeting"]);
    expect([...NOTE_KINDS]).toEqual(["note", "call_logged", "email_sent", "meeting"]);
  });

  it("maps each kind to its activity type and payload keys", () => {
    expect(noteEntry("note", "hello", null)).toEqual({ type: "note", payload: { note: "hello" } });
    expect(noteEntry("call_logged", "15 min", "Discovery")).toEqual({ type: "call_logged", payload: { summary: "Discovery", notes: "15 min" } });
    expect(noteEntry("email_sent", "Body", "Subj")).toEqual({ type: "email_sent", payload: { subject: "Subj", body: "Body", logged_manually: true } });
    expect(noteEntry("meeting", "Met at the booth", null)).toEqual({ type: "note", payload: { note: "Met at the booth", entry: "meeting" } });
  });
});

describe("addMatterNote", () => {
  it.each([
    ["note", { body: "Client prefers email" }, "note", { note: "Client prefers email" }],
    ["call_logged", { body: "Talked classes", subject: "Check-in" }, "call_logged", { summary: "Check-in", notes: "Talked classes" }],
    ["email_sent", { body: "Sent the LOE", subject: "Your LOE" }, "email_sent", { subject: "Your LOE", body: "Sent the LOE", logged_manually: true }],
    ["meeting", { body: "Walked through the filing" }, "note", { note: "Walked through the filing", entry: "meeting" }],
  ])("%s writes one matter-keyed row with the right payload", async (kind, input, type, payload) => {
    await addMatterNote("matter-1", { kind, ...input });
    expect(db.activity()).toHaveLength(1);
    const row = db.activity()[0];
    expect(row).toMatchObject({ matter_id: "matter-1", lead_id: null, type, actor_id: "user-1", actor_type: "user", org_id: "org-1" });
    expect(row.payload).toEqual(payload);
  });

  it("falls back to the body for a call or email with no subject", async () => {
    await addMatterNote("matter-1", { kind: "call_logged", body: "Short call" });
    expect(db.activity()[0].payload).toEqual({ summary: "Short call", notes: "Short call" });
  });

  it("refuses an empty body, an unknown kind and an over-length body, writing nothing", async () => {
    await expect(addMatterNote("matter-1", { kind: "note", body: "   " })).rejects.toThrow(/Write something/);
    await expect(addMatterNote("matter-1", { kind: "voicemail", body: "x" })).rejects.toThrow(/valid entry type/);
    await expect(addMatterNote("matter-1", { kind: "meeting", body: "x".repeat(NOTE_MAX_LENGTH + 1) })).rejects.toThrow(/under 5000/);
    expect(db.writes).toEqual([]);
  });

  it("reports another firm's matter as not found and writes no row", async () => {
    await expect(addMatterNote("matter-x", { kind: "note", body: "hi" })).rejects.toThrow(/matter couldn't be found/);
    expect(db.writes).toEqual([]);
  });

  it("raises no notification, even when the text @-mentions a teammate, and bumps no lead", async () => {
    await addMatterNote("matter-1", { kind: "note", body: "@Dawn please look at this" });
    expect(h.notify).not.toHaveBeenCalled();
    expect(db.activity()[0].payload).toEqual({ note: "@Dawn please look at this" });
    expect(db.writes.filter((w) => w.table === "crm_lead")).toEqual([]);
  });

  it("surfaces a failed insert to the caller instead of swallowing it", async () => {
    db.fail("crm_activity", "insert");
    await expect(addMatterNote("matter-1", { kind: "note", body: "hi" })).rejects.toBeTruthy();
  });
});

describe("addMatterNoteAction", () => {
  const post = (extra: Record<string, string> = {}) => formData({ matterId: "matter-1", kind: "note", body: "Logged", ...extra });

  it.each(READ_ONLY_ROLES)("refuses %s with the permission sentence", async (role) => {
    db.role = role;
    expect((await addMatterNoteAction({}, post())).error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s log an entry", async (role) => {
    db.role = role;
    expect(await addMatterNoteAction({}, post({ kind: "meeting" }))).toEqual({ saved: true });
    expect(db.activity()).toHaveLength(1);
  });

  it("returns the validation sentence and not-found sentence as form errors", async () => {
    expect((await addMatterNoteAction({}, post({ body: "" }))).error).toMatch(/Write something/);
    expect((await addMatterNoteAction({}, formData({ matterId: "matter-x", kind: "note", body: "hi" }))).error).toMatch(/couldn't be found/);
  });

  it("shows a failed insert as an error, with no raw database text", async () => {
    db.fail("crm_activity", "insert");
    const result = await addMatterNoteAction({}, post());
    expect(result.error).toBeTruthy();
    expect(result.error).not.toMatch(/boom|internal detail/);
  });
});
