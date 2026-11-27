import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { INTENDED_NY_HOUR, newYorkHour, shouldRunNow, type CronJob } from "@/lib/cron/ny-hour";

type Entry = { path: string; schedule: string };
const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Entry[] }).crons;
const JOBS = Object.keys(INTENDED_NY_HOUR) as CronJob[];

/** The vercel.json entries of one job, as { utcHour, minute }. */
function entriesOf(job: CronJob) {
  return crons
    .filter((c) => c.path === `/api/cron/${job}/`)
    .map((c) => {
      const m = /^(\d+) (\d+) \* \* \*$/.exec(c.schedule);
      if (!m) throw new Error(`unexpected schedule ${c.schedule}`);
      return { minute: Number(m[1]), utcHour: Number(m[2]) };
    });
}

/** Every UTC calendar date of 2026 and 2027. */
function* dates(): Generator<{ y: number; m: number; d: number; label: string }> {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 86_400_000) {
    const x = new Date(t);
    yield { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), label: x.toISOString().slice(0, 10) };
  }
}

/** One job's entries grouped into its pairs: for each intended hour, the summer (UTC-4) and winter (UTC-5) entry. */
function pairsOf(job: CronJob) {
  const e = entriesOf(job);
  return INTENDED_NY_HOUR[job].map((h) => ({
    hour: h,
    summer: e.find((x) => x.utcHour === h + 4),
    winter: e.find((x) => x.utcHour === h + 5),
  }));
}

describe("vercel.json", () => {
  it("has 12 entries: two per intended hour of each job, exactly one UTC hour apart, same minute", () => {
    expect(crons).toHaveLength(12);
    for (const job of JOBS) {
      const e = entriesOf(job);
      expect(e, job).toHaveLength(2 * INTENDED_NY_HOUR[job].length);
      for (const p of pairsOf(job)) {
        expect(p.summer, `${job} ${p.hour} summer`).toBeDefined();
        expect(p.winter, `${job} ${p.hour} winter`).toBeDefined();
        expect(p.winter!.utcHour - p.summer!.utcHour).toBe(1);
        expect(p.winter!.minute).toBe(p.summer!.minute);
      }
    }
  });

  it("the Lawmatics daily sync: 4 AM, 12 PM and 4 PM New York, the pairs `8 9`/`8 8`, `8 17`/`8 16`, `8 21`/`8 20`", () => {
    expect(INTENDED_NY_HOUR["lawmatics-matters"]).toEqual([4, 12, 16]);
    const schedules = crons.filter((c) => c.path === "/api/cron/lawmatics-matters/").map((c) => c.schedule).sort();
    expect(schedules).toEqual(["8 16 * * *", "8 17 * * *", "8 20 * * *", "8 21 * * *", "8 8 * * *", "8 9 * * *"].sort());
  });

  it("the hours of one job are at least 2 apart (adjacent hours would let two pairs through one UTC hour)", () => {
    for (const job of JOBS) {
      const hours = [...INTENDED_NY_HOUR[job]].sort((a, b) => a - b);
      for (let i = 1; i < hours.length; i++) expect(hours[i] - hours[i - 1], job).toBeGreaterThanOrEqual(2);
      // And across midnight.
      if (hours.length > 1) expect(hours[0] + 24 - hours[hours.length - 1], job).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the order and gaps: lawmatics 4:08, meetings 4:38, mailbox 4:53, agents 5:23 (winter New York time)", () => {
    const winter = (job: CronJob) => pairsOf(job)[0].winter!;
    const at = (j: CronJob) => `${winter(j).utcHour}:${String(winter(j).minute).padStart(2, "0")}`;
    expect([at("lawmatics-matters"), at("meetings-import"), at("mailbox-sync"), at("agents")]).toEqual(["9:08", "9:38", "9:53", "10:23"]);
    const t = (j: CronJob) => winter(j).utcHour * 60 + winter(j).minute;
    expect(t("lawmatics-matters")).toBeLessThan(t("meetings-import"));
    expect(t("meetings-import")).toBeLessThan(t("mailbox-sync"));
    expect(t("mailbox-sync")).toBeLessThan(t("agents"));
  });
});

describe("shouldRunNow: exactly one of each pair runs on every date of 2026 and 2027", () => {
  for (const job of JOBS) {
    it(`${job}: each intended hour runs exactly once a day (never zero, never two), at :00, :59 and the scheduled minute`, () => {
      const entries = entriesOf(job);
      let days = 0;
      for (const { y, m, d, label } of dates()) {
        for (const minuteOf of [() => 0, () => 59, (e: { minute: number }) => e.minute]) {
          const ran = entries
            .map((e) => shouldRunNow(job, new Date(Date.UTC(y, m, d, e.utcHour, minuteOf(e), minuteOf(e) === 59 ? 59 : 0))))
            .filter((h): h is number => h !== null);
          // Every intended hour once, nothing else.
          expect([...ran].sort((a, b) => a - b), `${job} ${label}`).toEqual([...INTENDED_NY_HOUR[job]]);
        }
        days++;
      }
      expect(days).toBe(730);
    });

    it(`${job}: the whole UTC hour of an entry answers the same (jitter cannot matter)`, () => {
      const entries = entriesOf(job);
      for (const { y, m, d } of dates()) {
        for (const e of entries) {
          const answers = new Set<number | null>();
          for (const min of [0, 1, 29, 30, 58, 59]) answers.add(shouldRunNow(job, new Date(Date.UTC(y, m, d, e.utcHour, min, min === 59 ? 59 : 0))));
          expect(answers.size).toBe(1);
        }
      }
    });
  }

  it("the transition days and the days around them, with who runs", () => {
    const expectRuns: Record<string, 0 | 1> = {
      // 1 = the winter entry (later UTC hour) runs, 0 = the summer entry (earlier) runs
      "2026-03-07": 1, "2026-03-08": 0, "2026-03-09": 0,
      "2026-10-31": 0, "2026-11-01": 1, "2026-11-02": 1,
      "2027-03-13": 1, "2027-03-14": 0, "2027-03-15": 0,
      "2027-11-06": 0, "2027-11-07": 1, "2027-11-08": 1,
    };
    for (const job of JOBS) {
      for (const p of pairsOf(job)) {
        const e = [p.summer!, p.winter!];
        for (const [iso, pick] of Object.entries(expectRuns)) {
          const [y, m, d] = iso.split("-").map(Number);
          const ran = e.map((x) => shouldRunNow(job, new Date(Date.UTC(y, m - 1, d, x.utcHour, x.minute))));
          expect(ran.filter((h) => h !== null).length, `${job} ${p.hour} ${iso}`).toBe(1);
          expect(ran[pick], `${job} ${p.hour} ${iso}`).toBe(p.hour);
        }
      }
    }
  });

  it("New York hour sanity: 2026-03-08 spring forward and 2026-11-01 fall back", () => {
    expect(newYorkHour(new Date("2026-03-08T06:59:59Z"))).toBe(1); // 1:59 EST
    expect(newYorkHour(new Date("2026-03-08T07:00:00Z"))).toBe(3); // 3:00 EDT
    expect(newYorkHour(new Date("2026-03-08T08:30:00Z"))).toBe(4); // 4:30 EDT
    expect(newYorkHour(new Date("2026-03-08T09:30:00Z"))).toBe(5); // 5:30 EDT
    expect(newYorkHour(new Date("2026-11-01T05:59:59Z"))).toBe(1); // 1:59 EDT
    expect(newYorkHour(new Date("2026-11-01T06:00:00Z"))).toBe(1); // 1:00 EST (the hour repeats)
    expect(newYorkHour(new Date("2026-11-01T08:30:00Z"))).toBe(3);
    expect(newYorkHour(new Date("2026-11-01T09:30:00Z"))).toBe(4);
    expect(newYorkHour(new Date("2026-11-01T10:23:00Z"))).toBe(5);
  });

  it("an invalid date never runs", () => {
    expect(shouldRunNow("agents", new Date("nope"))).toBeNull();
  });

  it("returns the matched hour, so the route knows the 4 AM tick from a daytime one", () => {
    expect(shouldRunNow("lawmatics-matters", new Date("2026-12-01T09:30:00Z"))).toBe(4);
    expect(shouldRunNow("lawmatics-matters", new Date("2026-12-01T17:30:00Z"))).toBe(12);
    expect(shouldRunNow("lawmatics-matters", new Date("2026-07-01T20:30:00Z"))).toBe(16);
    expect(shouldRunNow("lawmatics-matters", new Date("2026-07-01T14:30:00Z"))).toBeNull(); // 10 AM EDT
    expect(shouldRunNow("agents", new Date("2026-12-01T09:30:00Z"))).toBeNull();
  });
});
