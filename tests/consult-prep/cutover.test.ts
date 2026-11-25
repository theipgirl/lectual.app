// S2c: the switch-over from lawmatics-mcp's brief. Pure rules: the cutover instant, how far lawmatics-mcp can have scheduled,
// which Lectual emails that covers, and the records, card and timeline words for a superseded email.

import { describe, expect, it } from "vitest";
import { lawmaticsReach, parseCutoverAt, supersededByCutover } from "@/lib/consult-prep/cutover";
import { HOUR_MS, foldSendRecords, parseSendRecord, planSends, recordSlot, sendRecordPayload, type SendRecord } from "@/lib/consult-prep/sends";
import { eventPrepKey, stagePrepKey } from "@/lib/consult-prep/keys";
import { consultPrepCardView } from "@/lib/consult-prep/card";
import { CONSULT_PREP_SUPERSEDED, consultPrepTimelineSend } from "@/lib/ui/words";

const Z = (iso: string) => Date.parse(iso);

describe("CONSULT_PREP_CUTOVER_AT", () => {
  it("is read only as a full ISO instant with a zone", () => {
    expect(parseCutoverAt("2026-12-01T15:00:00-05:00")).toBe(Z("2026-12-01T20:00:00Z"));
    expect(parseCutoverAt(" 2026-12-01T20:00Z ")).toBe(Z("2026-12-01T20:00:00Z"));
    expect(parseCutoverAt("2026-12-01T20:00:00.123Z")).toBe(Z("2026-12-01T20:00:00.123Z"));
  });
  it("unset, empty, a date alone, a time with no zone, or nonsense is no cutover rule", () => {
    for (const v of [undefined, null, "", "   ", "2026-12-01", "2026-12-01T15:00:00", "tomorrow", "2026-13-45T99:00:00Z", "1764619200000"]) expect(parseCutoverAt(v as string | undefined)).toBeNull();
  });
});

describe("how far lawmatics-mcp can have scheduled (its slots.ts rules, either weekday setting)", () => {
  it("a weekday afternoon: its last run was the 7:30 AM one, which schedules to 8 PM (24 h briefs) and 11 PM (1 h briefs, the late-EOD grace)", () => {
    // Tue Dec 1 2026, 3:00 PM EST
    const r = lawmaticsReach(Z("2026-12-01T20:00:00Z"));
    expect(r.day).toBe(Z("2026-12-02T01:00:00Z")); // Tue 8:00 PM EST
    expect(r.hour).toBe(Z("2026-12-02T04:00:00Z")); // Tue 11:00 PM EST
  });
  it("within an hour of a slot counts as that slot (a tick may fire up to 1 h early)", () => {
    // Tue 7:00 PM EST: the 8 PM run may already have fired, and it schedules to Wed 7:30 AM
    const r = lawmaticsReach(Z("2026-12-02T00:00:00Z"));
    expect(r.day).toBe(Z("2026-12-02T12:30:00Z"));
    expect(r.hour).toBe(Z("2026-12-02T12:30:00Z"));
  });
  it("a Friday evening covers Monday 7:30 AM, in case lawmatics-mcp skips weekends (BRIEF_WEEKDAYS_ONLY)", () => {
    // Fri Nov 27 2026, 7:30 PM EST
    const r = lawmaticsReach(Z("2026-11-28T00:30:00Z"));
    expect(r.day).toBe(Z("2026-11-30T12:30:00Z")); // Mon 7:30 AM EST
    expect(r.hour).toBe(Z("2026-11-30T12:30:00Z"));
  });
  it("summer time is read in New York's own offset", () => {
    // Fri Sep 25 2026, 8:00 AM EDT: the 7:30 AM run, so 8 PM EDT and 11 PM EDT
    const r = lawmaticsReach(Z("2026-09-25T12:00:00Z"));
    expect(r.day).toBe(Z("2026-09-26T00:00:00Z"));
    expect(r.hour).toBe(Z("2026-09-26T03:00:00Z"));
  });
});

describe("which Lectual emails that covers", () => {
  const reach = { day: Z("2026-12-02T01:00:00Z"), hour: Z("2026-12-02T04:00:00Z"), seenBy: Z("2026-12-01T11:30:00Z") };
  it("the 24 h email: only when its send time is before the reach (exclusive)", () => {
    expect(supersededByCutover("24h", reach.day + 24 * HOUR_MS - 1, reach)).toBe(true);
    expect(supersededByCutover("24h", reach.day + 24 * HOUR_MS, reach)).toBe(false);
  });
  it("the 1 h email: likewise, against the 1 h reach", () => {
    expect(supersededByCutover("1h", reach.hour + HOUR_MS - 1, reach)).toBe(true);
    expect(supersededByCutover("1h", reach.hour + HOUR_MS, reach)).toBe(false);
  });
  it("the booked email: when either of lawmatics-mcp's briefs was in reach (it sends only when lawmatics-mcp sent nothing)", () => {
    expect(supersededByCutover("booked", reach.day + 24 * HOUR_MS - 1, reach)).toBe(true);
    expect(supersededByCutover("booked", reach.hour + HOUR_MS - 1, reach)).toBe(true);
    expect(supersededByCutover("booked", Math.max(reach.day + 24 * HOUR_MS, reach.hour + HOUR_MS), reach)).toBe(false);
  });
  it("no cutover, or no consult time (a stage-keyed prep), covers nothing", () => {
    expect(supersededByCutover("booked", reach.day, null)).toBe(false);
    expect(supersededByCutover("booked", null, reach)).toBe(false);
  });
});

describe("planSends with a cutover", () => {
  const NOW = Z("2026-12-01T20:30:00Z");
  const reach = lawmaticsReach(Z("2026-12-01T20:00:00Z")); // day Wed 01:00Z, hour Wed 04:00Z
  const at = (h: number) => NOW + h * HOUR_MS;
  const key = (startMs: number) => eventPrepKey("lead-1", "ev-1", new Date(startMs).toISOString());
  const plan = (startMs: number | null, over: Partial<Parameters<typeof planSends>[0]> = {}) =>
    planSends({ prepKey: startMs === null ? stagePrepKey("lead-1", "row-1") : key(startMs), startsAtMs: startMs, nowMs: NOW, preppedAtMs: NOW, madeNow: true, suppressBooked: false, existing: new Map(), cutover: reach, ...over });

  it("inside the window: no email at all, each recorded as superseded", () => {
    const p = plan(at(20)); // under a day ahead: no 24 h email; its 1 h email (Wed 15:30Z) is past the 04:00Z reach, but lawmatics-mcp had its 24 h brief
    expect(p.actions.map((a) => a.kind)).toEqual(["1h"]);
    expect(p.superseded).toEqual(["booked"]);
    const q = plan(reach.hour + 30 * 60_000); // its 1 h email lands before the 1 h reach
    expect(q.actions).toEqual([]);
    expect(q.superseded).toEqual(["booked", "1h"]);
    const r = plan(reach.day + 20 * HOUR_MS); // more than a day ahead: its 24 h email is before the 24 h reach
    expect(r.actions.map((a) => a.kind)).toEqual(["1h"]);
    expect(r.superseded).toEqual(["booked", "24h"]);
  });
  it("outside the window: every email as before", () => {
    const start = reach.day + 24 * HOUR_MS;
    const p = plan(start);
    expect(p.actions.map((a) => a.kind)).toEqual(["booked", "24h", "1h"]);
    expect(p.superseded).toEqual([]);
    expect(plan(start, { cutover: null })).toEqual({ ...p });
  });
  it("the boundary is exclusive: one millisecond earlier is covered", () => {
    const start = reach.day + 24 * HOUR_MS;
    expect(plan(start - 1).superseded).toEqual(["booked", "24h"]);
    expect(plan(start).superseded).toEqual([]);
  });
  it("covers a slot whatever the brief: a facts brief's booked and 24 h are superseded, not withheld", () => {
    const p = plan(reach.day + 20 * HOUR_MS, { brief: "facts" });
    expect(p.withheld).toEqual([]);
    expect(p.superseded).toEqual(["booked", "24h"]);
    expect(p.actions.map((a) => a.kind)).toEqual(["1h"]);
  });
  it("an owed (withheld) 24 h email in the window is superseded, not sent late", () => {
    const start = reach.day + 20 * HOUR_MS;
    const existing = new Map([[recordSlot(key(start), "24h"), { leadId: "lead-1", prepKey: key(start), kind: "24h", resendId: null, scheduledFor: null, status: "withheld", at: new Date(NOW).toISOString() } as SendRecord]]);
    const p = plan(start, { nowMs: start - 10 * HOUR_MS, madeNow: false, existing });
    expect(p.actions.map((a) => a.kind)).not.toContain("24h");
    expect(p.superseded).toContain("24h");
  });
  it("a superseded slot is done: a later plan never sends it, even with no cutover rule any more", () => {
    const start = reach.day + 20 * HOUR_MS;
    const k = key(start);
    const existing = new Map(
      (["booked", "24h"] as const).map((kind) => [recordSlot(k, kind), { leadId: "lead-1", prepKey: k, kind, resendId: null, scheduledFor: null, status: "superseded", at: new Date(NOW).toISOString() } as SendRecord]),
    );
    const p = plan(start, { madeNow: false, cutover: null, existing, nowMs: NOW + HOUR_MS });
    expect(p.actions.map((a) => a.kind)).toEqual(["1h"]);
    expect(p.superseded).toEqual([]);
  });
  it("a stage-keyed prep (no consult time) is untouched by the cutover", () => {
    expect(plan(null).actions).toEqual([{ kind: "booked", mode: "now" }]);
    expect(plan(null).superseded).toEqual([]);
  });
  it("a person's re-run passes no cutover: its booked email goes", () => {
    const p = plan(at(5), { bookedOnly: true, cutover: null });
    expect(p.actions).toEqual([{ kind: "booked", mode: "now" }]);
  });
});

describe("the superseded record", () => {
  const k = eventPrepKey("lead-1", "ev-1", "2026-12-02T10:00:00.000Z");
  const row = (status: string, at: string, over: Record<string, unknown> = {}) => ({ lead_id: "lead-1", created_at: at, payload: { source: "consult-prep-send", prep_key: k, kind: "booked", status, resend_id: null, scheduled_for: null, ...over } });
  it("round-trips, ids and times only", () => {
    const payload = sendRecordPayload({ prepKey: k, kind: "booked", resendId: null, scheduledFor: null, status: "superseded" });
    expect(Object.keys(payload).sort()).toEqual(["kind", "prep_key", "resend_id", "scheduled_for", "source", "status"]);
    expect(parseSendRecord({ lead_id: "lead-1", created_at: "2026-12-01T20:00:00Z", payload })?.status).toBe("superseded");
  });
  it("never hides a row that says an email went out, and a later withheld row never hides it", () => {
    const sent = parseSendRecord(row("sent", "2026-12-01T20:00:00Z", { resend_id: "re_1" }))!;
    const sup = parseSendRecord(row("superseded", "2026-12-01T21:00:00Z"))!;
    expect(foldSendRecords([sent, sup]).get(recordSlot(k, "booked"))?.status).toBe("sent");
    const withheld = parseSendRecord(row("withheld", "2026-12-01T22:00:00Z"))!;
    expect(foldSendRecords([sup, withheld]).get(recordSlot(k, "booked"))?.status).toBe("superseded");
    // and it replaces an earlier withheld row (that slot is no longer owed)
    const early = parseSendRecord(row("withheld", "2026-12-01T19:00:00Z"))!;
    expect(foldSendRecords([early, sup]).get(recordSlot(k, "booked"))?.status).toBe("superseded");
  });
  it("the lead page card and the timeline say it plainly", () => {
    const rec = parseSendRecord(row("superseded", "2026-12-01T21:00:00Z"))!;
    const view = consultPrepCardView({
      agents: "on",
      setting: "on",
      markers: { status: "ok", value: [{ prepKey: k, queueItemId: "q-1", at: "2026-12-01T21:00:00Z" }] },
      sends: { status: "ok", value: [rec] },
      recipients: { status: "ok", value: { names: ["Rebecca"], cc: [] } },
      emailOn: true,
      adminTier: true,
      tz: "America/New_York",
      nowMs: Z("2026-12-01T21:00:00Z"),
    });
    expect(view.kind).toBe("prepared");
    expect(view.kind === "prepared" && view.lines[0]).toContain(CONSULT_PREP_SUPERSEDED);
    expect(CONSULT_PREP_SUPERSEDED).toBe("not emailed: the old brief was already scheduled for this consult");
    expect(consultPrepTimelineSend("booked", "superseded")).toBe(`Consult prep email: ${CONSULT_PREP_SUPERSEDED}`);
  });
});

describe("emails wait for the switch-over (fail closed)", async () => {
  const { emailsStarted } = await import("@/lib/consult-prep/cutover");
  const { CONSULT_PREP_EMAILS_WAIT } = await import("@/lib/ui/words");
  it("only when set, valid and now at or after it", () => {
    const at = Z("2026-12-01T20:00:00Z");
    expect(emailsStarted(at, at - 1)).toBe(false);
    expect(emailsStarted(at, at)).toBe(true);
    expect(emailsStarted(at, at + 1)).toBe(true);
    expect(emailsStarted(null, at)).toBe(false);
    expect(emailsStarted(undefined, at)).toBe(false);
    expect(emailsStarted(Number.NaN, at)).toBe(false);
    expect(emailsStarted(parseCutoverAt("2026-12-01"), at)).toBe(false);
  });
  it("the card says so instead of 'not emailed'", () => {
    const k = eventPrepKey("lead-1", "ev-1", "2026-12-04T10:00:00.000Z");
    const view = consultPrepCardView({
      agents: "on",
      setting: "on",
      markers: { status: "ok", value: [{ prepKey: k, queueItemId: "q-1", at: "2026-12-01T21:00:00Z" }] },
      sends: { status: "ok", value: [] },
      recipients: { status: "ok", value: { names: ["Rebecca"], cc: [] } },
      emailOn: true,
      emailsStarted: false,
      adminTier: true,
      tz: "America/New_York",
    });
    expect(view.kind === "prepared" && view.lines[0]).toContain(CONSULT_PREP_EMAILS_WAIT);
    expect(CONSULT_PREP_EMAILS_WAIT).toBe("not emailed: emails start when the switch-over is done");
  });
});

describe("review fixes", async () => {
  const { cutoverFor } = await import("@/lib/consult-prep/cutover");
  const { dropPreCutoverOwed } = await import("@/lib/consult-prep/sends");

  it("parseCutoverAt refuses an impossible date or time", () => {
    for (const v of ["2026-02-30T10:00:00Z", "2026-11-31T10:00:00-05:00", "2026-12-01T24:00:00Z", "2026-12-01T10:60:00Z", "2026-12-01T10:00:61Z", "2026-12-01T10:00:00+15:00", "2026-12-01T10:00:00-05:75"]) {
      expect(parseCutoverAt(v), v).toBeNull();
    }
    expect(parseCutoverAt("2028-02-29T10:00:00Z")).toBe(Z("2028-02-29T10:00:00Z"));
  });

  it("the reach says when lawmatics-mcp's last run can first have fired", () => {
    // Tue Dec 1 2026, 2:30 PM EST: its last run was for 7:30 AM, so it fired no earlier than 6:30 AM.
    expect(lawmaticsReach(Z("2026-12-01T19:30:00Z")).seenBy).toBe(Z("2026-12-01T11:30:00Z"));
  });

  it("a consult booked after lawmatics-mcp's last run is Lectual's: booked Tue 10 AM for Tue 6 PM, cut over at 2:30 PM, gets its emails", () => {
    const reach = lawmaticsReach(Z("2026-12-01T19:30:00Z"));
    const start = Z("2026-12-01T23:00:00Z"); // Tue 6:00 PM EST
    const known = { knownSinceMs: Z("2026-12-01T15:00:00Z") }; // Tue 10:00 AM EST
    expect(cutoverFor(reach, known)).toBeNull();
    const k = eventPrepKey("lead-1", "ev-1", new Date(start).toISOString());
    const p = planSends({ prepKey: k, startsAtMs: start, nowMs: Z("2026-12-01T20:00:00Z"), preppedAtMs: Z("2026-12-01T20:00:00Z"), madeNow: true, suppressBooked: false, existing: new Map(), cutover: cutoverFor(reach, known) });
    expect(p.actions.map((a) => a.kind)).toEqual(["booked", "1h"]);
    // the same consult known before that run: covered, as before
    expect(cutoverFor(reach, { knownSinceMs: Z("2026-12-01T11:00:00Z") })).toBe(reach);
  });

  it("an unknown booking time keeps the time-only rule; an Outlook-only consult (null) and a re-run get none", () => {
    const reach = lawmaticsReach(Z("2026-12-01T19:30:00Z"));
    expect(cutoverFor(reach, { knownSinceMs: null })).toBe(reach);
    expect(cutoverFor(reach, null)).toBeNull();
    expect(cutoverFor(reach, undefined)).toBeNull();
    expect(cutoverFor(reach, { knownSinceMs: null }, { rerun: true })).toBeNull();
    expect(cutoverFor(null, { knownSinceMs: null })).toBeNull();
  });

  it("withheld and failed rows from before the switch-over are not owed; later ones, and sent or scheduled ones, stay", () => {
    const k = eventPrepKey("lead-1", "ev-1", "2026-12-04T10:00:00.000Z");
    const r = (kind: "booked" | "24h" | "1h", status: SendRecord["status"], at: string): [string, SendRecord] => [recordSlot(k, kind), { leadId: "lead-1", prepKey: k, kind, resendId: status === "scheduled" ? "re_1" : null, scheduledFor: null, status, at }];
    const cut = Z("2026-12-01T19:30:00Z");
    const folded = new Map([r("booked", "withheld", "2026-12-01T10:00:00Z"), r("24h", "failed", "2026-12-01T19:00:00Z"), r("1h", "scheduled", "2026-12-01T10:00:00Z")]);
    expect([...dropPreCutoverOwed(folded, cut).values()].map((x) => x.status)).toEqual(["scheduled"]);
    const later = new Map([r("booked", "withheld", "2026-12-01T20:00:00Z")]);
    expect(dropPreCutoverOwed(later, cut).size).toBe(1);
    expect(dropPreCutoverOwed(folded, null).size).toBe(3);
  });

  it("the card no longer calls a pre-switch-over withheld booked email pending", () => {
    const k = eventPrepKey("lead-1", "ev-1", "2026-12-08T10:00:00.000Z");
    const rec: SendRecord = { leadId: "lead-1", prepKey: k, kind: "booked", resendId: null, scheduledFor: null, status: "withheld", at: "2026-12-01T10:00:00Z" };
    const view = (cutoverAtMs: number | null) =>
      consultPrepCardView({
        agents: "on",
        setting: "on",
        markers: { status: "ok", value: [{ prepKey: k, queueItemId: "q-1", at: "2026-12-01T10:00:00Z" }] },
        sends: { status: "ok", value: [rec] },
        recipients: { status: "ok", value: { names: ["Rebecca"], cc: [] } },
        emailOn: true,
        emailsStarted: true,
        cutoverAtMs,
        adminTier: true,
        tz: "America/New_York",
        nowMs: Z("2026-12-02T10:00:00Z"),
      });
    const a = view(Z("2026-12-01T19:30:00Z"));
    expect(a.kind === "prepared" && a.lines[0]).toContain("· not emailed");
    expect(a.kind === "prepared" && a.lines[0]).not.toContain("waiting for the full prep");
    const b = view(null);
    expect(b.kind === "prepared" && b.lines[0]).toContain("waiting for the full prep");
  });
});
