import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  SCHEDULE_HORIZON_MS,
  foldSendRecords,
  parseSendRecord,
  planSends,
  recordSlot,
  sendRecordPayload,
  shouldCancel,
  stageBookedRecently,
  type SendRecord,
} from "@/lib/consult-prep/sends";
import { eventPrepKey, stagePrepKey } from "@/lib/consult-prep/keys";

const LEAD = "lead-1";
const NOW = Date.parse("2026-11-24T15:00:00Z");
const at = (hoursFromNow: number) => NOW + hoursFromNow * HOUR_MS;
const KEY = eventPrepKey(LEAD, "ev-1", new Date(at(50)).toISOString());

const rec = (over: Partial<SendRecord>): SendRecord => ({ leadId: LEAD, prepKey: KEY, kind: "booked", resendId: "r1", scheduledFor: null, status: "sent", at: new Date(NOW).toISOString(), ...over });
const plan = (startHours: number | null, over: Partial<Parameters<typeof planSends>[0]> = {}) =>
  planSends({ prepKey: KEY, startsAtMs: startHours === null ? null : at(startHours), nowMs: NOW, preppedAtMs: NOW, madeNow: true, suppressBooked: false, existing: new Map(), ...over });

describe("the three sends of an event-keyed prep", () => {
  it("booked now, a day before, an hour before, when the prep is made more than a day ahead and inside the 72 hour window", () => {
    const p = plan(50);
    expect(p.actions).toEqual([
      { kind: "booked", mode: "now" },
      { kind: "24h", mode: "schedule", at: new Date(at(26)).toISOString() },
      { kind: "1h", mode: "schedule", at: new Date(at(49)).toISOString() },
    ]);
    expect(p.owedLater).toEqual([]);
  });

  it("booked less than a day ahead: no 24 hour reminder, the 1 hour one still goes", () => {
    const p = plan(10);
    expect(p.actions.map((a) => a.kind)).toEqual(["booked", "1h"]);
  });

  it("exactly a day ahead is not MORE than a day: no 24 hour reminder", () => {
    expect(plan(24).actions.map((a) => a.kind)).toEqual(["booked", "1h"]);
  });

  it("under an hour left: only the booked email, nothing more after it", () => {
    expect(plan(0.5).actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(plan(1).actions).toEqual([{ kind: "booked", mode: "now" }]);
  });

  it("a send more than 72 hours away is owed, not handed to Resend", () => {
    const p = plan(200);
    expect(p.actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(p.owedLater).toEqual(["24h", "1h"]);
    // the next run inside the window schedules it
    const later = plan(200, { nowMs: at(130), madeNow: false, preppedAtMs: NOW, existing: new Map([[recordSlot(KEY, "booked"), rec({})]]) });
    expect(later.actions.map((a) => a.kind)).toEqual(["24h", "1h"].filter((k) => k === "24h" || k === "1h"));
  });

  it("the 72 hour horizon is inclusive at the edge", () => {
    const p = plan(24 + 72 + 0, { preppedAtMs: NOW - 100 * HOUR_MS, nowMs: NOW });
    expect(p.actions.some((a) => a.kind === "24h")).toBe(true);
    const out = plan(24 + 72 + 0.01, { preppedAtMs: NOW - 100 * HOUR_MS });
    expect(out.owedLater).toContain("24h");
    expect(SCHEDULE_HORIZON_MS).toBe(72 * HOUR_MS);
  });

  it("a later run sends no booked email again, but retries one recorded as failed", () => {
    const sent = new Map([[recordSlot(KEY, "booked"), rec({ status: "sent" })]]);
    expect(plan(50, { madeNow: false, existing: sent }).actions.map((a) => a.kind)).toEqual(["24h", "1h"]);
    expect(plan(50, { madeNow: false }).actions.map((a) => a.kind)).toEqual(["24h", "1h"]);
    const failed = new Map([[recordSlot(KEY, "booked"), rec({ status: "failed", resendId: null })]]);
    expect(plan(50, { madeNow: false, existing: failed }).actions[0]).toEqual({ kind: "booked", mode: "now" });
  });

  it("a reminder already scheduled or sent is not scheduled again; a cancelled or failed one is", () => {
    const base = new Map([[recordSlot(KEY, "booked"), rec({})]]);
    const scheduled = new Map(base).set(recordSlot(KEY, "1h"), rec({ kind: "1h", status: "scheduled", scheduledFor: new Date(at(49)).toISOString() }));
    expect(plan(50, { madeNow: false, existing: scheduled }).actions.map((a) => a.kind)).toEqual(["24h"]);
    const cancelled = new Map(base).set(recordSlot(KEY, "1h"), rec({ kind: "1h", status: "cancelled" }));
    expect(plan(50, { madeNow: false, existing: cancelled }).actions.map((a) => a.kind)).toEqual(["24h", "1h"]);
  });

  it("the 24 hour rule is judged from when the prep was made, not from now", () => {
    // prepped 30h before the start, now 20h before it: its 24h moment has passed, so it is not owed
    const p = plan(20, { preppedAtMs: at(-10), madeNow: false, existing: new Map([[recordSlot(KEY, "booked"), rec({})]]) });
    expect(p.actions.map((a) => a.kind)).toEqual(["1h"]);
  });

  it("a stage-keyed prep sends booked only", () => {
    const stageKey = stagePrepKey(LEAD, "row-1");
    const p = planSends({ prepKey: stageKey, startsAtMs: null, nowMs: NOW, preppedAtMs: NOW, madeNow: true, suppressBooked: false, existing: new Map() });
    expect(p.actions).toEqual([{ kind: "booked", mode: "now" }]);
  });

  it("an event prep right after a stage-keyed booked email sends only the reminders", () => {
    expect(plan(50, { suppressBooked: true }).actions.map((a) => a.kind)).toEqual(["24h", "1h"]);
  });
});

describe("stage-keyed booked email in the last 7 days", () => {
  const stageKey = stagePrepKey(LEAD, "row-1");
  const sent = (daysAgo: number, over: Partial<SendRecord> = {}) => rec({ prepKey: stageKey, at: new Date(NOW - daysAgo * 24 * HOUR_MS).toISOString(), ...over });
  it("holds for 7 days and not for 8", () => {
    expect(stageBookedRecently([sent(6.9)], LEAD, NOW)).toBe(true);
    expect(stageBookedRecently([sent(7.1)], LEAD, NOW)).toBe(false);
  });
  it("needs a booked email that went out or is scheduled, for THIS lead, from a stage key", () => {
    expect(stageBookedRecently([sent(1, { status: "failed" })], LEAD, NOW)).toBe(false);
    expect(stageBookedRecently([sent(1, { status: "cancelled" })], LEAD, NOW)).toBe(false);
    expect(stageBookedRecently([sent(1)], "other-lead", NOW)).toBe(false);
    expect(stageBookedRecently([rec({ at: new Date(NOW - HOUR_MS).toISOString() })], LEAD, NOW)).toBe(false); // an event key's own booked email
    expect(stageBookedRecently([sent(1, { kind: "24h" })], LEAD, NOW)).toBe(false);
  });
});

describe("cancel on change", () => {
  const scheduled = rec({ kind: "1h", status: "scheduled", scheduledFor: new Date(at(49)).toISOString() });
  const startIso = new Date(at(50)).toISOString();
  const same = { startsAt: startIso, leadId: LEAD, isConsult: true };
  it("an unchanged event keeps its reminders", () => {
    expect(shouldCancel(scheduled, same)).toBe(false);
    expect(shouldCancel(scheduled, { ...same, startsAt: startIso.replace("Z", "+00:00") })).toBe(false); // the same instant
  });
  it("cancels when the event is gone, its start changed, it is no longer a consult, or its lead changed", () => {
    expect(shouldCancel(scheduled, null)).toBe(true);
    expect(shouldCancel(scheduled, { ...same, startsAt: new Date(at(52)).toISOString() })).toBe(true);
    expect(shouldCancel(scheduled, { ...same, isConsult: false })).toBe(true);
    expect(shouldCancel(scheduled, { ...same, isConsult: null })).toBe(true);
    expect(shouldCancel(scheduled, { ...same, leadId: "someone-else" })).toBe(true);
    expect(shouldCancel(scheduled, { ...same, leadId: null })).toBe(true);
  });
  it("only a scheduled send is ever cancelled", () => {
    for (const status of ["sent", "cancelled", "failed"] as const) expect(shouldCancel({ ...scheduled, status }, null)).toBe(false);
  });
  it("a stage-keyed record is never cancelled by the calendar", () => {
    expect(shouldCancel({ ...scheduled, prepKey: stagePrepKey(LEAD, "row") }, null)).toBe(false);
  });
});

describe("send records", () => {
  it("round-trip with ids and times only", () => {
    const payload = sendRecordPayload({ prepKey: KEY, kind: "24h", resendId: "re_1", scheduledFor: "2026-11-25T14:00:00.000Z", status: "scheduled" });
    expect(Object.keys(payload).sort()).toEqual(["kind", "prep_key", "resend_id", "scheduled_for", "source", "status"]);
    expect(parseSendRecord({ lead_id: LEAD, created_at: "2026-11-24T15:00:00Z", payload })).toMatchObject({ leadId: LEAD, prepKey: KEY, kind: "24h", status: "scheduled", resendId: "re_1" });
  });
  it("a row that is not exactly one reads as nothing", () => {
    expect(parseSendRecord({ payload: { source: "consult-prep-send", prep_key: KEY, kind: "weekly", status: "sent" } })).toBeNull();
    expect(parseSendRecord({ payload: { prep_key: KEY, kind: "booked", status: "lost" } })).toBeNull();
    expect(parseSendRecord({ payload: null })).toBeNull();
    expect(parseSendRecord({ payload: [] })).toBeNull();
  });
  it("the newest row per key and kind is the truth (a cancel is a newer row)", () => {
    const older = rec({ kind: "1h", status: "scheduled", at: "2026-11-24T10:00:00Z" });
    const newer = rec({ kind: "1h", status: "cancelled", at: "2026-11-24T11:00:00Z" });
    const other = rec({ kind: "booked", at: "2026-11-24T09:00:00Z" });
    const folded = foldSendRecords([older, other, newer]);
    expect(folded.get(recordSlot(KEY, "1h"))?.status).toBe("cancelled");
    expect(folded.get(recordSlot(KEY, "booked"))?.status).toBe("sent");
    expect(folded.size).toBe(2);
  });
});

describe("review fixes: folding and planning", () => {
  const T = (h: number) => new Date(NOW + h * HOUR_MS).toISOString();
  it("a later failed row never hides an earlier row that holds a Resend id (sent or scheduled)", () => {
    for (const status of ["sent", "scheduled"] as const) {
      const folded = foldSendRecords([rec({ kind: "24h", status, resendId: "re_9", at: T(0) }), rec({ kind: "24h", status: "failed", resendId: null, at: T(1) })]);
      expect(folded.get(recordSlot(KEY, "24h"))).toMatchObject({ status, resendId: "re_9" });
    }
  });
  it("a later duplicate row never hides it either, and a later cancelled row does win", () => {
    const scheduled = rec({ kind: "24h", status: "scheduled", resendId: "re_9", at: T(0) });
    expect(foldSendRecords([scheduled, rec({ kind: "24h", status: "duplicate", resendId: null, at: T(1) })]).get(recordSlot(KEY, "24h"))?.status).toBe("scheduled");
    expect(foldSendRecords([scheduled, rec({ kind: "24h", status: "cancelled", at: T(1) })]).get(recordSlot(KEY, "24h"))?.status).toBe("cancelled");
  });
  it("a failed row after nothing (or after a failed one) still reads as failed, so a retry happens", () => {
    expect(foldSendRecords([rec({ kind: "booked", status: "failed", resendId: null, at: T(0) })]).get(recordSlot(KEY, "booked"))?.status).toBe("failed");
  });
  it("a duplicate counts as done: nothing is planned for it", () => {
    const existing = foldSendRecords([rec({ kind: "booked", status: "duplicate", resendId: null }), rec({ kind: "24h", status: "duplicate", resendId: null }), rec({ kind: "1h", status: "duplicate", resendId: null })]);
    expect(plan(50, { existing, madeNow: true }).actions).toEqual([]);
  });
  it("bookedOnly (a re-run) plans the booked email and never a reminder", () => {
    expect(plan(50, { bookedOnly: true }).actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(plan(50, { bookedOnly: true }).owedLater).toEqual([]);
  });
  it("shouldCancel: a vanished event id is kept while a twin of the same call stands", () => {
    const r = rec({ kind: "24h", status: "scheduled" });
    expect(shouldCancel(r, null)).toBe(true);
    expect(shouldCancel(r, null, { twinExists: true })).toBe(false);
    expect(shouldCancel(r, { startsAt: new Date(at(52)).toISOString(), leadId: LEAD, isConsult: true }, { twinExists: true })).toBe(true);
  });
  it("a duplicate never covers a failure of ours: failed then duplicate (no Resend id) is still owed", () => {
    const slot = recordSlot(KEY, "booked");
    const folded = foldSendRecords([rec({ status: "failed", resendId: null, at: T(0) }), rec({ status: "duplicate", resendId: null, at: T(1) })]);
    expect(folded.get(slot)?.status).toBe("failed");
    expect(plan(50, { existing: folded, madeNow: false }).actions[0]).toEqual({ kind: "booked", mode: "now" });
    // a duplicate with no failure is done, and a failure after a duplicate is owed again
    expect(foldSendRecords([rec({ status: "duplicate", resendId: null, at: T(0) })]).get(slot)?.status).toBe("duplicate");
    expect(foldSendRecords([rec({ status: "duplicate", resendId: null, at: T(0) }), rec({ status: "failed", resendId: null, at: T(1) })]).get(slot)?.status).toBe("failed");
    // but a real sent row with an id keeps covering a later failed and duplicate
    expect(foldSendRecords([rec({ status: "sent", resendId: "re_1", at: T(0) }), rec({ status: "failed", resendId: null, at: T(1) }), rec({ status: "duplicate", resendId: null, at: T(2) })]).get(slot)?.status).toBe("sent");
  });
});
