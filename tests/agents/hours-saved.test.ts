import { describe, it, expect } from "vitest";
import {
  autopilotFromRow,
  autopilotStateLine,
  canPauseAutopilot,
  canResumeAutopilot,
  DEFAULT_MINUTES_PER_TASK,
  estimateAssumption,
  estimateHoursSaved,
  parseMinutesForm,
  resolveMinutes,
} from "@/lib/agents/autopilot-rules";
import { deadlinesMetThisMonth, mattersOpenedThisMonth, monthStartCivil } from "@/lib/today/outcomes";

const r = (agent: string, status: string, items_in: number, drafts_out: number) => ({ agent, status, items_in, drafts_out, started_at: "2026-09-10T00:00:00Z" });

describe("Hours saved (est.)", () => {
  it("counts only completed tasks × the firm's minutes, in hours to one decimal", () => {
    const est = estimateHoursSaved(
      [r("intake-triage", "ok", 12, 3), r("email-intel", "ok", 6, 1), r("post-consult", "ok", 4, 3), r("intake-triage", "error", 50, 0), r("post-consult", "skipped", 9, 0), r("mailbox-sync", "ok", 99, 0)],
      DEFAULT_MINUTES_PER_TASK,
    );
    // 12×10 + 6×5 + 3×20 = 210 min
    expect(est.tasks).toEqual({ "intake-triage": 12, "email-intel": 6, "post-consult": 3 });
    expect(est.hours).toBe(3.5);
  });

  it("uses the firm's own minutes when set, and defaults for the rest", () => {
    const { minutes, customised } = resolveMinutes({ "intake-triage": 30, "email-intel": 999, bogus: 5 });
    expect(customised).toBe(true);
    expect(minutes).toEqual({ "intake-triage": 30, "email-intel": 5, "post-consult": 20 });
    expect(estimateHoursSaved([r("intake-triage", "ok", 4, 0)], minutes).hours).toBe(2);
    expect(estimateAssumption(minutes)).toBe("5 min per client email read, 30 min per lead screened, 20 min per follow-up drafted");
  });

  it("parses the settings form: blank = default, out of range refused", () => {
    const fd = new FormData();
    fd.set("minutes-intake-triage", "12.25");
    fd.set("minutes-email-intel", "");
    expect(parseMinutesForm(fd)).toEqual({ ok: true, value: { "intake-triage": 12.3 } });
    fd.set("minutes-post-consult", "500");
    expect(parseMinutesForm(fd).ok).toBe(false);
  });
});

describe("Autopilot rules", () => {
  it("attorney and above pause; only admins resume", () => {
    expect(["owner", "admin", "senior_admin", "attorney"].every((x) => canPauseAutopilot(x as never))).toBe(true);
    expect(canPauseAutopilot("paralegal")).toBe(false);
    expect(canResumeAutopilot("attorney")).toBe(false);
    expect(canResumeAutopilot("senior_admin")).toBe(true);
  });

  it("no row means on", () => {
    expect(autopilotFromRow(null)).toMatchObject({ paused: false, minutesPerTask: DEFAULT_MINUTES_PER_TASK });
  });

  it("writes the state line on the firm's clock", () => {
    const now = new Date("2026-09-29T15:00:00Z");
    expect(autopilotStateLine({ paused: false, pausedAt: null }, { lastRunAt: "2026-09-29T10:02:00Z", pausedByName: null, now, tz: "America/New_York" })).toBe(
      "Autopilot on · last run 6:02 AM",
    );
    expect(autopilotStateLine({ paused: true, pausedAt: "2026-09-29T13:14:00Z" }, { lastRunAt: null, pausedByName: "Dana Ruiz", now, tz: "America/New_York" })).toBe(
      "Paused by Dana Ruiz at 9:14 AM",
    );
  });
});

describe("outcome metrics", () => {
  const now = new Date("2026-10-01T02:00:00Z"); // still Sep 30 in New York
  it("uses the firm's month", () => {
    expect(monthStartCivil(now, "America/New_York")).toBe("2026-09-01");
    expect(monthStartCivil(now, "UTC")).toBe("2026-10-01");
  });
  it("counts matters opened this month", () => {
    expect(mattersOpenedThisMonth([{ opened_at: "2026-09-15T12:00:00Z", created_at: "x" }, { opened_at: "2026-08-31T12:00:00Z", created_at: "x" }], now, "America/New_York")).toBe(1);
  });
  it("counts deadlines met on or before the due date", () => {
    const rows = [
      { due_date: "2026-09-20", satisfied_at: "2026-09-20T20:00:00Z", status: "satisfied" },
      { due_date: "2026-09-10", satisfied_at: "2026-09-12T12:00:00Z", status: "satisfied" },
      { due_date: "2026-09-10", satisfied_at: "2026-08-12T12:00:00Z", status: "satisfied" },
      { due_date: "2026-09-10", satisfied_at: null, status: "waived" },
    ];
    expect(deadlinesMetThisMonth(rows, now, "America/New_York")).toEqual({ met: 1, closed: 2 });
  });
});
