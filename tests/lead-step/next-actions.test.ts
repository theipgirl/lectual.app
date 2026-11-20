import { describe, expect, it } from "vitest";
import { notSetUp, unavailable } from "@/lib/lead-step/facts";
import { consultPrepGate, nextAction, postConsultGate } from "@/lib/lead-step/next-actions";
import { firstRunAfterImport, nextRunWindow, prepRunFor, windowWords } from "@/lib/lead-step/schedule";
import { INTENDED_NY_HOUR, newYorkHour } from "@/lib/cron/ny-hour";
import { NOW, THURSDAY_CONSULT, facts, jobsOn } from "./fixtures";

const booked = { consult: { status: "ok" as const, value: THURSDAY_CONSULT } };
const recorded = { meetings: { status: "ok" as const, value: [{ id: "m-1", provider: "zoom", title: "Strategy session", startedAt: "2026-11-16T19:00:00.000Z", durationSeconds: 2700, hasMaterial: true }] } };

describe("the schedule comes from the cron code", () => {
  it("the assistants' window is the New York hour INTENDED_NY_HOUR names, in winter and in summer", () => {
    const winter = nextRunWindow("agents", new Date(NOW));
    expect(winter?.start).toBe("2026-11-18T10:00:00.000Z");
    expect(newYorkHour(new Date(winter!.start))).toBe(INTENDED_NY_HOUR.agents);
    const summer = nextRunWindow("agents", new Date("2026-07-01T12:00:00.000Z"));
    expect(summer?.start).toBe("2026-07-02T09:00:00.000Z");
    expect(newYorkHour(new Date(summer!.start))).toBe(INTENDED_NY_HOUR.agents);
  });

  it("a window is the whole hour (the minute moves), and reads in the firm's zone", () => {
    const w = nextRunWindow("agents", new Date(NOW))!;
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(3_600_000);
    expect(windowWords(w, new Date(NOW), "America/New_York")).toEqual({ day: "Tomorrow", from: "5 AM", to: "6 AM" });
    expect(windowWords(w, new Date(NOW), "America/Chicago")).toEqual({ day: "Tomorrow", from: "4 AM", to: "5 AM" });
  });

  it("consult prep: the run whose next 24 hours hold the consult, never a run that could miss it", () => {
    expect(prepRunFor(THURSDAY_CONSULT.startsAt, new Date(NOW))?.start).toBe("2026-11-19T10:00:00.000Z");
    // 5:30 AM: the same morning's window contains it, and the run the day before is more than 24 hours earlier.
    expect(prepRunFor("2026-11-19T10:30:00.000Z", new Date(NOW))).toBeNull();
    expect(prepRunFor("2026-11-16T10:30:00.000Z", new Date(NOW))).toBeNull();
  });

  it("after a call: the import's hour first, then the assistants' hour", () => {
    expect(firstRunAfterImport(THURSDAY_CONSULT.endsAt)?.start).toBe("2026-11-20T10:00:00.000Z");
    // A call ending at 3 AM is imported at 4 and drafted at 5 the same morning.
    expect(firstRunAfterImport("2026-11-20T08:00:00.000Z")?.start).toBe("2026-11-20T10:00:00.000Z");
  });
});

describe("a promise only from a job that is switched on", () => {
  it("everything on: consult prep is promised, with the client email only for the Agent toolkit", () => {
    expect(nextAction(facts(booked))).toMatchObject({ status: "promise", promise: { job: "consult-prep", withClientEmail: true } });
    const noToolkit = facts({ ...booked, jobs: { status: "ok", value: jobsOn({ modules: { mailbox: true, proposals: true, agentToolkit: false } }) } });
    expect(nextAction(noToolkit)).toMatchObject({ status: "promise", promise: { job: "consult-prep", withClientEmail: false } });
  });

  const offCases: Array<[string, ReturnType<typeof jobsOn>, string]> = [
    ["Assistants feature off", jobsOn({ agentsOn: false }), "assistants-off"],
    ["AI not configured", jobsOn({ aiOn: false }), "ai-off"],
    ["Autopilot paused", jobsOn({ autopilot: "paused" }), "paused"],
    ["the setting off (no row)", jobsOn({ settings: {} }), "assistant-off"],
    ["the setting disabled", jobsOn({ settings: { "consult-prep": { enabled: false, autonomy: "draft" }, "post-consult": { enabled: false, autonomy: "draft" } } }), "assistant-off"],
    ["suggest only", jobsOn({ settings: { "consult-prep": { enabled: true, autonomy: "suggest" }, "post-consult": { enabled: true, autonomy: "suggest" } } }), "suggest-only"],
  ];
  for (const [name, jobs, why] of offCases) {
    it(`${name}: nothing promised, and why`, () => {
      const next = nextAction(facts({ ...booked, jobs: { status: "ok", value: jobs } }));
      expect(next).toMatchObject({ status: "off", why });
      expect(next.status).not.toBe("promise");
    });
  }

  it("prep off but the proposal drafter on: the proposal after the consult is promised instead", () => {
    const jobs = jobsOn({ settings: { "post-consult": { enabled: true, autonomy: "act" } } });
    expect(nextAction(facts({ ...booked, jobs: { status: "ok", value: jobs } }))).toMatchObject({ status: "promise", promise: { job: "post-consult", source: "after-consult" } });
  });

  it("the proposal drafter needs the Proposals feature, a named approver and a recorder for a call still to come", () => {
    const prepOff = { "post-consult": { enabled: true, autonomy: "draft" as const } };
    for (const [over, why] of [
      [{ modules: { mailbox: true, proposals: false, agentToolkit: true } }, "proposals-off"],
      [{ proposalApprovers: false }, "no-approvers"],
      [{ meetingSourceActive: false }, "no-recordings"],
    ] as const) {
      const next = nextAction(facts({ ...booked, markers: { status: "ok", value: { preppedEventIds: [THURSDAY_CONSULT.eventId], handledMeetingIds: [], outcomeLogged: false } }, jobs: { status: "ok", value: jobsOn({ ...over }) } }));
      expect(next).toMatchObject({ status: "off", for: "post-consult", why });
      // With prep still to do and its job off, the card says why prep isn't coming first.
      const notPrepped = nextAction(facts({ ...booked, jobs: { status: "ok", value: jobsOn({ settings: prepOff, ...over }) } }));
      expect(notPrepped).toMatchObject({ status: "off", for: "consult-prep", why: "assistant-off" });
    }
  });

  it("a recording already imported needs no recorder connection, but the rest of the gate", () => {
    expect(nextAction(facts({ ...recorded, jobs: { status: "ok", value: jobsOn({ meetingSourceActive: false }) } }))).toMatchObject({ status: "promise", promise: { source: "recording" } });
    expect(nextAction(facts({ ...recorded, jobs: { status: "ok", value: jobsOn({ proposalApprovers: false }) } }))).toMatchObject({ status: "off", why: "no-approvers" });
  });

  it("a recording the drafter already handled is not promised again", () => {
    expect(nextAction(facts({ ...recorded, markers: { status: "ok", value: { preppedEventIds: [], handledMeetingIds: ["m-1"], outcomeLogged: false } } }))).toEqual({ status: "none" });
  });

  it("a recording without a transcript or summary, or older than the drafter looks, is not promised", () => {
    const thin = { meetings: { status: "ok" as const, value: [{ ...recorded.meetings.value[0], hasMaterial: false }] } };
    expect(nextAction(facts(thin))).toEqual({ status: "none" });
    const old = { meetings: { status: "ok" as const, value: [{ ...recorded.meetings.value[0], startedAt: "2026-10-20T19:00:00.000Z" }] } };
    expect(nextAction(facts(old))).toEqual({ status: "none" });
  });

  it("no approval queue: both drafters write nothing, so nothing is promised", () => {
    expect(consultPrepGate(jobsOn(), notSetUp("queue-off"))).toEqual({ on: false, why: "approvals-off" });
    expect(postConsultGate(jobsOn(), notSetUp("queue-off"), { callStillToCome: false })).toEqual({ on: false, why: "approvals-off" });
    expect(consultPrepGate(jobsOn(), unavailable())).toEqual({ on: "unknown" });
  });

  it("Mailboxes off: consult prep is never promised", () => {
    expect(consultPrepGate(jobsOn({ modules: { mailbox: false, proposals: true, agentToolkit: true } }), { status: "ok", value: [] })).toEqual({ on: false, why: "mailbox-off" });
  });

  it("a recorder or approvers read that failed: unknown, never promised", () => {
    const prepOff = { "post-consult": { enabled: true, autonomy: "draft" as const } };
    expect(nextAction(facts({ ...booked, jobs: { status: "ok", value: jobsOn({ settings: prepOff, meetingSourceActive: null }) } }))).toEqual({ status: "unknown" });
    expect(nextAction(facts({ ...recorded, jobs: { status: "ok", value: jobsOn({ proposalApprovers: null }) } }))).toEqual({ status: "unknown" });
  });

  it("the Stage Keeper is never the card's promise (it makes nothing for a yes)", () => {
    const onlyKeeper = jobsOn({ settings: { "stage-keeper": { enabled: true, autonomy: "act" } } });
    expect(nextAction(facts({ ...booked, jobs: { status: "ok", value: onlyKeeper } })).status).not.toBe("promise");
  });
});
