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

  it("a failure that got no answer (timeout) followed by a 409 is done: Resend had accepted it, so it is never retried", () => {
    const slot = recordSlot(KEY, "booked");
    const folded = foldSendRecords([rec({ status: "failed", resendId: null, noResponse: true, at: T(0) }), rec({ status: "duplicate", resendId: null, at: T(1) })]);
    expect(folded.get(slot)?.status).toBe("duplicate");
    expect(plan(50, { existing: folded, madeNow: false }).actions.some((a) => a.kind === "booked")).toBe(false);
    // the flag round-trips through the payload, and only on a failed row
    expect(sendRecordPayload({ prepKey: KEY, kind: "booked", resendId: null, scheduledFor: null, status: "failed", noResponse: true }).no_response).toBe(true);
    expect(sendRecordPayload({ prepKey: KEY, kind: "booked", resendId: null, scheduledFor: null, status: "sent", noResponse: true }).no_response).toBeUndefined();
    expect(parseSendRecord({ lead_id: null, created_at: T(0), payload: { prep_key: KEY, kind: "booked", status: "failed", no_response: true } })?.noResponse).toBe(true);
  });
});

describe("S2a: an email carries a full brief; the facts brief is emailed only as a marked 1 h email", () => {
  const withheld = (kind: "booked" | "24h", over: Partial<SendRecord> = {}) => rec({ kind, status: "withheld", resendId: null, ...over });
  const slots = (...records: SendRecord[]) => new Map(records.map((r) => [recordSlot(r.prepKey, r.kind), r]));

  it("a facts brief withholds booked and 24h (they stay owed), and still plans the 1 h", () => {
    const p = plan(50, { brief: "facts" });
    expect(p.actions).toEqual([{ kind: "1h", mode: "schedule", at: new Date(at(49)).toISOString() }]);
    expect(p.withheld).toEqual(["booked", "24h"]);
  });
  it("a full brief plans all three, as before, and withholds nothing", () => {
    for (const brief of [undefined, "full" as const]) {
      const p = plan(50, { brief });
      expect(p.actions.map((a) => a.kind)).toEqual(["booked", "24h", "1h"]);
      expect(p.withheld).toEqual([]);
    }
  });
  it("a stage-keyed prep with a facts brief withholds its booked email", () => {
    const p = plan(null, { brief: "facts" });
    expect(p.actions).toEqual([]);
    expect(p.withheld).toEqual(["booked"]);
  });
  it("a later run with a full brief sends the withheld booked and 24h while they are still due", () => {
    const existing = slots(withheld("booked"), withheld("24h"));
    const p = plan(50, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - HOUR_MS });
    expect(p.actions.map((a) => a.kind)).toEqual(["booked", "24h", "1h"]);
  });
  it("a later run with still only facts withholds them again (no new action), and the 1 h is planned once", () => {
    const existing = slots(withheld("booked"), withheld("24h"));
    const p = plan(50, { madeNow: false, brief: "facts", existing });
    expect(p.actions.map((a) => a.kind)).toEqual(["1h"]);
    expect(p.withheld).toEqual(["booked", "24h"]);
  });
  it("a withheld booked email is never sent late: not once the 24 h time has passed", () => {
    const existing = slots(withheld("booked"));
    const before = plan(24.5, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - HOUR_MS });
    expect(before.actions.map((a) => a.kind)).toEqual(["booked", "24h", "1h"]);
    const after = plan(23.9, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - HOUR_MS });
    expect(after.actions.map((a) => a.kind)).toEqual(["1h"]);
    expect(after.withheld).toEqual([]);
  });
  it("a withheld stage-keyed booked email is dropped 3 days after the prep was made", () => {
    const stageKey = stagePrepKey(LEAD, "row-1");
    const existing = new Map([[recordSlot(stageKey, "booked"), withheld("booked", { prepKey: stageKey })]]);
    const base = { prepKey: stageKey, madeNow: false, brief: "full" as const, existing };
    expect(plan(null, { ...base, preppedAtMs: NOW - 2 * 24 * HOUR_MS }).actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(plan(null, { ...base, preppedAtMs: NOW - 4 * 24 * HOUR_MS }).actions).toEqual([]);
  });
  it("a withheld 24h whose time has passed is sent NOW with a full brief, until 2 hours before the start; never later", () => {
    const existing = slots(withheld("24h"));
    const p = plan(10, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - 30 * HOUR_MS });
    expect(p.actions).toContainEqual({ kind: "24h", mode: "now" });
    const tooLate = plan(1.9, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - 30 * HOUR_MS });
    expect(tooLate.actions.map((a) => a.kind)).not.toContain("24h");
    const stillFacts = plan(10, { madeNow: false, brief: "facts", existing, preppedAtMs: NOW - 30 * HOUR_MS });
    expect(stillFacts.actions.map((a) => a.kind)).not.toContain("24h");
  });
  it("a 24h that was never wanted (the prep was made under a day ahead) is not made owed by a full brief", () => {
    const p = plan(10, { madeNow: false, brief: "full", existing: new Map() });
    expect(p.actions).toEqual([{ kind: "1h", mode: "schedule", at: new Date(at(9)).toISOString() }]);
  });
  it("a slot that is done is never planned again, whatever the brief", () => {
    const existing = slots(rec({ kind: "booked" }), rec({ kind: "24h", status: "scheduled" }), rec({ kind: "1h", status: "scheduled" }));
    expect(plan(50, { madeNow: false, brief: "full", existing }).actions).toEqual([]);
    expect(plan(50, { madeNow: false, brief: "facts", existing }).withheld).toEqual([]);
  });
  it("a re-run (booked only) with a facts brief withholds its booked email and plans no reminder", () => {
    const p = plan(50, { bookedOnly: true, brief: "facts" });
    expect(p.actions).toEqual([]);
    expect(p.withheld).toEqual(["booked"]);
  });
});

describe("S2a: withheld records and the quality mark", () => {
  it("a withheld row round-trips, and never hides an email that was sent, scheduled, handled elsewhere or failed", () => {
    const w = rec({ status: "withheld", resendId: null, at: new Date(NOW + 1000).toISOString() });
    expect(parseSendRecord({ lead_id: LEAD, created_at: w.at, payload: sendRecordPayload(w) })).toMatchObject({ status: "withheld", kind: "booked" });
    for (const status of ["sent", "scheduled", "duplicate", "failed"] as const) {
      const first = rec({ status, at: new Date(NOW).toISOString() });
      expect(foldSendRecords([first, w]).get(recordSlot(KEY, "booked"))?.status, status).toBe(status);
    }
    const cancelled = rec({ status: "cancelled", at: new Date(NOW).toISOString() });
    expect(foldSendRecords([cancelled, w]).get(recordSlot(KEY, "booked"))?.status).toBe("withheld");
  });
  it("a send that carried the facts brief is marked, and an unmarked one is full", () => {
    const facts = rec({ kind: "1h", status: "scheduled", quality: "facts" });
    expect(sendRecordPayload(facts)).toHaveProperty("quality", "facts");
    expect(parseSendRecord({ payload: sendRecordPayload(facts) })?.quality).toBe("facts");
    expect(sendRecordPayload(rec({ kind: "1h" }))).not.toHaveProperty("quality");
    expect(parseSendRecord({ payload: sendRecordPayload(rec({ kind: "1h" })) })?.quality).toBeUndefined();
  });
});

describe("D4: lateness holds whatever state the slot is in", () => {
  const slot = (kind: "booked" | "24h", status: SendRecord["status"]) => new Map([[recordSlot(KEY, kind), rec({ kind, status, resendId: null })]]);
  const later = (startHours: number, existing: Map<string, SendRecord>) => plan(startHours, { madeNow: false, brief: "full", existing, preppedAtMs: NOW - 30 * HOUR_MS });
  it("a booked email that failed is retried inside its window and never after start - 24 h", () => {
    expect(later(30, slot("booked", "failed")).actions.map((a) => a.kind)).toContain("booked");
    expect(later(23, slot("booked", "failed")).actions.map((a) => a.kind)).not.toContain("booked");
    expect(later(23, slot("booked", "withheld")).actions.map((a) => a.kind)).not.toContain("booked");
  });
  it("a stage-keyed booked email that failed is not retried 3 days after the prep", () => {
    const stageKey = stagePrepKey(LEAD, "r");
    const existing = new Map([[recordSlot(stageKey, "booked"), rec({ prepKey: stageKey, status: "failed", resendId: null })]]);
    const base = { prepKey: stageKey, madeNow: false, brief: "full" as const, existing };
    expect(plan(null, { ...base, preppedAtMs: NOW - 2 * 24 * HOUR_MS }).actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(plan(null, { ...base, preppedAtMs: NOW - 4 * 24 * HOUR_MS }).actions).toEqual([]);
  });
  it("a 24h that failed is retried while inside its window (sent now once its time has passed) and never within 2 h of the start", () => {
    expect(later(10, slot("24h", "failed")).actions).toContainEqual({ kind: "24h", mode: "now" });
    expect(later(1.9, slot("24h", "failed")).actions.map((a) => a.kind)).not.toContain("24h");
    expect(later(1.9, slot("24h", "withheld")).actions.map((a) => a.kind)).not.toContain("24h");
    expect(plan(10, { madeNow: false, brief: "facts", existing: slot("24h", "failed"), preppedAtMs: NOW - 30 * HOUR_MS }).actions.map((a) => a.kind)).not.toContain("24h");
  });
});
