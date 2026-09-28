import { describe, it, expect } from "vitest";
import { buildPriorities, emptyPrioritiesNote, hourInZone } from "@/lib/today/priorities";
import type { CalendarRow } from "@/lib/matters/calendar-rows";
import type { StalledMatter } from "@/lib/matters/docket-summary";

const NOW = new Date("2026-09-26T12:00:00Z");
const row = (key: string, dueDate: string, overdueDays = 0): CalendarRow => ({ key, href: `/dashboard/matters/${key}`, name: key, detail: "TM-1", dueDate, overdueDays, source: "deadline" });
const stalled = (id: string, over: number): StalledMatter => ({ id, label: id, matterNumber: id, stageCode: "15", stageLabel: "Awaiting Client Signature", waitingOn: "client", daysInStage: 21 + over, daysOverThreshold: over });
const q = (id: string, created_at: string) => ({ id, headline: `Draft ${id}`, client_name: null, created_at });
const empty = { deadlines: [], queue: [], stalled: [], hotLeads: [], now: NOW };

describe("buildPriorities", () => {
  it("ranks overdue deadlines first, most overdue on top, then drafts, hot leads, quiet matters", () => {
    const out = buildPriorities({
      deadlines: [row("late2", "2026-09-24", 2), row("late9", "2026-09-17", 9), row("soon", "2026-09-30")],
      queue: [q("a", "2026-09-26T08:00:00Z")],
      stalled: [stalled("m1", 30)],
      hotLeads: [{ id: "l1", name: "Amara", reason: null }],
      now: NOW,
    }, 10);
    expect(out.map((p) => p.tag)).toEqual(["overdue", "overdue", "deadline", "approval", "hot", "quiet"]);
    expect(out[0].title).toBe("late9");
  });

  it("leaves out a deadline more than two weeks away", () => {
    expect(buildPriorities({ ...empty, deadlines: [row("far", "2026-12-01")] })).toEqual([]);
  });

  it("lifts a draft that has waited three days above a fresh one", () => {
    const out = buildPriorities({ ...empty, queue: [q("fresh", "2026-09-26T11:00:00Z"), q("old", "2026-09-22T11:00:00Z")] });
    expect(out.map((p) => p.key)).toEqual(["q-old", "q-fresh"]);
  });

  it("caps the list and links every row somewhere real", () => {
    const out = buildPriorities({ ...empty, stalled: [stalled("a", 1), stalled("b", 2), stalled("c", 3)], queue: [q("x", "2026-09-26T00:00:00Z"), q("y", "2026-09-26T00:00:00Z")] }, 3);
    expect(out).toHaveLength(3);
    for (const p of out) expect(p.href).toMatch(/^\/dashboard\/(queue|matters)\/[a-z]+\/$/);
  });
});

describe("emptyPrioritiesNote — three queue states, never two", () => {
  it("is calm when everything loaded", () => {
    expect(emptyPrioritiesNote({ queue: "ok", calendarOk: true, docketOk: true })).toMatch(/^Nothing overdue, nothing waiting/);
  });

  it("says no queue is connected, not that sources are unavailable, when the queue is unconfigured", () => {
    const note = emptyPrioritiesNote({ queue: "unconfigured", calendarOk: true, docketOk: true });
    expect(note).toMatch(/No approval queue is connected/);
    expect(note).not.toMatch(/unavailable/);
  });

  it("keeps the warning when the queue is unreachable, and never calls it empty", () => {
    const note = emptyPrioritiesNote({ queue: "unavailable", calendarOk: true, docketOk: true });
    expect(note).toMatch(/Some sources are unavailable/);
    expect(note).not.toMatch(/Nothing overdue, nothing waiting/);
  });

  it("warns when another source failed, whatever the queue said", () => {
    expect(emptyPrioritiesNote({ queue: "unconfigured", calendarOk: false, docketOk: true })).toMatch(/unavailable/);
    expect(emptyPrioritiesNote({ queue: "ok", calendarOk: true, docketOk: false })).toMatch(/unavailable/);
  });
});

describe("hourInZone", () => {
  it("reads the hour on the firm's clock, not the server's", () => {
    const t = new Date("2026-09-26T03:30:00Z");
    expect(hourInZone(t, "America/New_York")).toBe(23);
    expect(hourInZone(t, "UTC")).toBe(3);
  });
});
