import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, type FakeDb } from "../matters/helpers/fake-db";
import { NOTE_KINDS, isNoteKind, validateNote } from "@/lib/pipeline/lead-input";

/**
 * Sprint 8: the lead composer gains Meeting. A meeting has no activity type of
 * its own (no migration is allowed), so it is stored as a `note` row tagged
 * entry: "meeting". The existing kinds and the @mention path must be untouched.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as { client(): unknown },
  notify: vi.fn(async () => {}),
  directory: vi.fn(async () => [{ userId: "user-dawn", displayName: "Dawn Okafor", email: "dawn@example.com", role: "attorney", identified: true }]),
}));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/notifications", () => ({ notify: h.notify }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: h.directory }));

const { addLeadNote } = await import("@/lib/pipeline/notes");

let db: FakeDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeDb({ tables: { crm_lead: [{ id: "lead-1", org_id: "org-1", first_name: "Mireille", last_name: "T", email: "m@example.com", last_activity_at: null }] } });
  h.db = db;
});

describe("the lead note kinds", () => {
  it("includes meeting, and validateNote accepts it", () => {
    expect([...NOTE_KINDS]).toEqual(["note", "call_logged", "email_sent", "meeting"]);
    expect(isNoteKind("meeting")).toBe(true);
    expect(isNoteKind("voicemail")).toBe(false);
    expect(validateNote({ kind: "meeting", body: "Met at the booth" })).toMatchObject({ ok: true, value: { kind: "meeting" } });
  });
});

describe("addLeadNote", () => {
  it("writes a meeting as a note row tagged entry: meeting", async () => {
    await addLeadNote("lead-1", { kind: "meeting", body: "Walked through the plan" });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0]).toMatchObject({ lead_id: "lead-1", matter_id: null, type: "note", actor_type: "user" });
    expect(db.activity()[0].payload).toEqual({ note: "Walked through the plan", entry: "meeting" });
  });

  it("never scans a meeting for @mentions", async () => {
    await addLeadNote("lead-1", { kind: "meeting", body: "@Dawn joined us" });
    expect(h.directory).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
    expect(db.activity()[0].payload).toEqual({ note: "@Dawn joined us", entry: "meeting" });
  });

  it("still scans a plain note and notifies the person tagged", async () => {
    await addLeadNote("lead-1", { kind: "note", body: "@Dawn can you look at this?" });
    expect(db.activity()[0].payload).toMatchObject({ note: "@Dawn can you look at this?", mentions: ["user-dawn"] });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-dawn", kind: "mentioned", leadId: "lead-1" }));
  });

  it("keeps the note, call and email payloads as they were", async () => {
    await addLeadNote("lead-1", { kind: "note", body: "  Called the founder.  " });
    await addLeadNote("lead-1", { kind: "call_logged", body: "15 minutes", subject: "Discovery call" });
    await addLeadNote("lead-1", { kind: "email_sent", body: "Sent the LOE.", subject: "Your LOE" });
    expect(db.activity().map((a) => [a.type, a.payload])).toEqual([
      ["note", { note: "Called the founder." }],
      ["call_logged", { summary: "Discovery call", notes: "15 minutes" }],
      ["email_sent", { subject: "Your LOE", body: "Sent the LOE.", logged_manually: true }],
    ]);
  });

  it("bumps the lead's last touch for a lead-side meeting", async () => {
    await addLeadNote("lead-1", { kind: "meeting", body: "Met" });
    expect(db.rows("crm_lead")[0].last_activity_at).toBeTruthy();
  });

  it("refuses a viewer", async () => {
    db.role = "viewer";
    await expect(addLeadNote("lead-1", { kind: "meeting", body: "Met" })).rejects.toThrow(/Forbidden|permission/i);
    expect(db.activity()).toEqual([]);
  });
});
