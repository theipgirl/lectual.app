import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// next.config.ts sets trailingSlash: true, which <Link> reads from this variable.
process.env.__NEXT_TRAILING_SLASH = "true";

const NOW = new Date("2026-10-20T12:00:00Z");
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

const PHANTOM = dl("phantom", -346, { source: "manual", title: "Phantom response" });
const REAL_OVERDUE = dl("real", -4, { title: "Real overdue response" });
const UPCOMING = dl("soon", 6, { title: "Upcoming statement of use" });

async function render(deadlines: unknown[] | "fail", view = "agenda", tasks: unknown[] = []) {
  vi.doMock("@/lib/matters", () => ({
    listUpcomingDeadlines: vi.fn(async () => {
      if (deadlines === "fail") throw new Error("down");
      return deadlines;
    }),
    listTasks: vi.fn(async () => tasks),
  }));
  vi.doMock("@/lib/calendar/events", () => ({ listCalendarEvents: vi.fn(async () => []) }));
  vi.doMock("@/lib/org/profile", () => ({ getOrgProfile: vi.fn(async () => ({ time_zone: "America/New_York" })) }));
  const { default: Page } = await import("../../src/app/dashboard/calendar/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view }) }));
}

/** The "Needs review" band only (it is the last band on the agenda). */
const band = (html: string) => html.slice(html.indexOf('aria-labelledby="cal-needs-review"'));

describe("Calendar agenda: Needs review band (N4)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a Needs review heading after the live groups, listing the phantom", async () => {
    const html = await render([PHANTOM, REAL_OVERDUE, UPCOMING]);
    expect(html).toContain(">Needs review<");
    expect(html.indexOf(">Needs review<")).toBeGreaterThan(html.indexOf(">Overdue<"));
    expect(html.indexOf(">Needs review<")).toBeGreaterThan(html.indexOf(">This week<"));
    expect(band(html)).toContain("Phantom response");
  });

  it("each item has its matter, due date, days past due, a link to the matter and the sentence", async () => {
    const b = band(await render([PHANTOM, REAL_OVERDUE, UPCOMING]));
    expect(b).toContain("RPB-phantom · Mark phantom");
    expect(b).toContain(`due ${new Date(NOW.getTime() - 346 * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`);
    expect(b).toContain("346 days past due");
    expect(b).toContain('href="/dashboard/matters/m-phantom/"');
    expect(b).toContain("Entered by hand, never confirmed, and more than 180 days past due. Confirm, close or correct it on the matter.");
  });

  it("the phantom is not under Overdue, where only the real one is", async () => {
    const html = await render([PHANTOM, REAL_OVERDUE, UPCOMING]);
    const overdue = html.slice(html.indexOf('aria-labelledby="cal-overdue"'), html.indexOf('aria-labelledby="cal-week"'));
    expect(overdue).toContain("Real overdue response");
    expect(overdue).not.toContain("Phantom response");
  });

  it("when the only deadline is a phantom the page shows the band, not the empty state", async () => {
    const html = await render([PHANTOM]);
    expect(html).toContain(">Needs review<");
    expect(html).not.toContain("Nothing on the docket or task list");
  });

  it("with no phantom there is no Needs review heading", async () => {
    const html = await render([REAL_OVERDUE, UPCOMING]);
    expect(html).not.toContain("Needs review");
  });

  it("with nothing at all the empty state still shows", async () => {
    expect(await render([])).toContain("Nothing on the docket or task list");
  });

  it("the month and week views do not list the phantom", async () => {
    for (const view of ["month", "week"]) {
      const html = await render([PHANTOM, REAL_OVERDUE, UPCOMING], view);
      expect(html).not.toContain("Phantom response");
      expect(html).not.toContain("Needs review");
    }
  });

  it("an old calculated date is not moved: it stays under Overdue", async () => {
    const html = await render([dl("old", -400, { title: "Old calculated", source: "calculated" })]);
    expect(html).not.toContain("Needs review");
    expect(html.slice(html.indexOf('aria-labelledby="cal-overdue"'))).toContain("Old calculated");
  });

  it("the band edits and closes nothing: it has no form and no button", async () => {
    const b = band(await render([PHANTOM]));
    expect(b).not.toContain("<form");
    expect(b).not.toContain("<button");
  });

  it("a failed deadlines read is said, and no band is invented", async () => {
    const html = await render("fail");
    expect(html).toContain("Couldn&#x27;t load docket dates");
    expect(html).not.toContain("Needs review");
  });
});
