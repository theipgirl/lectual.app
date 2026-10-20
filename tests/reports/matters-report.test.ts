import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportPeriod } from "@/lib/reports/period";

const NOW = new Date("2026-10-20T16:00:00Z");
const DAY = 86_400_000;
const civil = (offset: number) => new Date(NOW.getTime() + offset * DAY).toISOString().slice(0, 10);

function dl(id: string, offset: number, over: Record<string, unknown> = {}) {
  return {
    id,
    matter_id: `m-${id}`,
    kind: "office_action_response",
    title: `Response ${id}`,
    due_date: civil(offset),
    source: "calculated",
    status: "open",
    attorney_confirmed: false,
    matter_number: `RPB-${id}`,
    matter_title: `Mark ${id}`,
    ...over,
  };
}

const PHANTOM = dl("phantom", -346, { source: "manual" });
const OVERDUE = dl("overdue", -2);
const SOON = dl("soon", 10);
const FAR = dl("far", 40);

async function load(deadlines: unknown[] | "fail", opts: { matters?: unknown[] | "fail" } = {}) {
  vi.doMock("@/lib/matters", () => ({
    listMatters: vi.fn(async () => {
      if (opts.matters === "fail") throw new Error("down");
      return opts.matters ?? [];
    }),
    listUpcomingDeadlines: vi.fn(async () => {
      if (deadlines === "fail") throw new Error("down");
      return deadlines;
    }),
    matterLabel: vi.fn((m: { id: string }) => `Matter ${m.id}`),
    summarizeDocket: vi.fn(() => ({ open: 3, waitingOn: { firm: 1 } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  const { loadMattersReport } = await import("@/lib/reports/matters");
  return loadMattersReport(reportPeriod(30, NOW));
}

const kpi = (r: Awaited<ReturnType<typeof load>>, label: string) => r.kpis.find((k) => k.label === label)!;

describe("matters report: deadlines and needs review (N3)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the 30-day KPI counts only dates from today to today + 30", async () => {
    const report = await load([OVERDUE, SOON, FAR, PHANTOM]);
    expect(kpi(report, "USPTO deadlines · 30 days").value).toBe(1);
  });

  it("a date due today and one due on day 30 both count", async () => {
    const report = await load([dl("today", 0), dl("edge", 30), dl("over", 31)]);
    expect(kpi(report, "USPTO deadlines · 30 days").value).toBe(2);
  });

  it("shows a needs-review tile for the phantom, linking to the agenda", async () => {
    const report = await load([OVERDUE, SOON, FAR, PHANTOM]);
    const tile = report.links.find((l) => l.label === "1 old unconfirmed deadline needs review");
    expect(tile).toBeDefined();
    expect(tile?.href).toBe("/dashboard/calendar/?view=agenda");
    expect(tile?.count).toBe(1);
  });

  it("uses the plural for other counts", async () => {
    const report = await load([PHANTOM, dl("p2", -400, { source: "manual" })]);
    expect(report.links.some((l) => l.label === "2 old unconfirmed deadlines need review")).toBe(true);
  });

  it("the real overdue deadline leads the waiting list, linked to its matter", async () => {
    const report = await load([OVERDUE, SOON, FAR, PHANTOM], { matters: [] });
    expect(report.waiting[0]).toMatchObject({ href: "/dashboard/matters/m-overdue/", meta: "2 days overdue" });
    expect(report.waiting[0].text).toContain("Response overdue");
  });

  it("the phantom is nowhere in the waiting list", async () => {
    const report = await load([OVERDUE, SOON, FAR, PHANTOM]);
    expect(JSON.stringify(report.waiting)).not.toContain("phantom");
    expect(report.waiting.every((w) => !w.href.includes("m-phantom"))).toBe(true);
  });

  it("an old calculated date stays loud: it is overdue, not needs-review", async () => {
    const report = await load([dl("old", -400, { source: "calculated" })]);
    expect(report.waiting[0].meta).toBe("400 days overdue");
    expect(report.links.some((l) => /need.* review/.test(l.label))).toBe(false);
  });

  it("with no phantom there is no needs-review tile and the tile list is unchanged", async () => {
    const report = await load([OVERDUE, SOON, FAR]);
    expect(report.links.map((l) => l.label)).toEqual(["All matters", "Pipeline", "Documents"]);
  });

  it("a failed deadlines read gives the couldn't-load metric and banner, and no tile", async () => {
    const report = await load("fail");
    const k = kpi(report, "USPTO deadlines · 30 days");
    expect(k.value).toBeNull();
    expect(k.note).toBe("Deadlines couldn't be loaded");
    expect(report.banner).toContain("Deadlines couldn't be loaded");
    expect(report.links.some((l) => /need.* review/.test(l.label))).toBe(false);
    expect(report.waiting).toEqual([]);
  });

  it("counts the firm's day, not the server's: late evening in New York is still 'today'", async () => {
    // 2026-10-21T02:00Z is 10pm on the 20th in New York.
    vi.setSystemTime(new Date("2026-10-21T02:00:00Z"));
    const report = await load([dl("ny", 0, { due_date: "2026-10-20" })]);
    expect(kpi(report, "USPTO deadlines · 30 days").value).toBe(1);
    expect(report.waiting).toEqual([]);
  });
});
