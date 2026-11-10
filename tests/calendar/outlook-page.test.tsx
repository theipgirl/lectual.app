import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutlookCalendarEvent, OutlookRead } from "@/lib/calendar/outlook-read";
import { storedConsult } from "./fixtures";

// next.config.ts sets trailingSlash: true, which <Link> reads from this variable.
process.env.__NEXT_TRAILING_SLASH = "true";

/** The Calendar page with Outlook events (Sprint 15, F14), through the real page with its loaders mocked. */

const NOW = new Date("2026-10-21T12:00:00Z");
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "").replaceAll(" ", " ");

const deadline = {
  id: "d1",
  matter_id: "m-1",
  kind: "office_action_response",
  title: "Respond to office action",
  due_date: "2026-10-22",
  source: "calculated",
  status: "open",
  attorney_confirmed: true,
  matter_number: "RPB-1",
  matter_title: "SANKOFA",
};
const task = { id: "t1", title: "Call the examiner", due_at: "2026-10-23T15:00:00Z", matter_id: "m-1", lead_id: null, status: "open", assignee_id: null };

const listOutlookCalendarEvents = vi.fn();

async function render(opts: { mailbox?: boolean; outlook?: OutlookRead<{ events: OutlookCalendarEvent[] }> | "throws"; view?: string; baseEvents?: unknown[] }) {
  vi.resetModules();
  listOutlookCalendarEvents.mockReset();
  if (opts.outlook === "throws") listOutlookCalendarEvents.mockRejectedValue(new Error("boom"));
  else listOutlookCalendarEvents.mockResolvedValue(opts.outlook ?? { status: "ok", events: [] });
  vi.doMock("@/lib/matters", () => ({
    listUpcomingDeadlines: vi.fn(async () => [deadline]),
    listTasks: vi.fn(async () => [task]),
  }));
  vi.doMock("@/lib/calendar/events", () => ({ listCalendarEvents: vi.fn(async () => opts.baseEvents ?? []) }));
  vi.doMock("@/lib/calendar/outlook-read", () => ({ listOutlookCalendarEvents }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "mailbox" && (opts.mailbox ?? true)) }));
  vi.doMock("@/lib/org/profile", () => ({ getOrgProfile: vi.fn(async () => ({ time_zone: "America/New_York" })) }));
  const { default: Page } = await import("../../src/app/dashboard/calendar/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: opts.view ?? "month", d: "2026-10-21" }) })));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("Calendar page: Outlook events", () => {
  it("month: an Outlook event appears beside the deadline and the task", async () => {
    const html = await render({ outlook: { status: "ok", events: [storedConsult()] } });
    expect(html).toContain("Respond to office action");
    expect(html).toContain("Call the examiner");
    expect(html).toContain("Strategy Session: Amara Nwosu");
    expect(html).not.toContain("Outlook events aren't available");
    expect(html).not.toContain("We couldn't load your Outlook calendar");
  });

  it("reads Outlook for the month grid's range", async () => {
    await render({ outlook: { status: "ok", events: [] } });
    expect(listOutlookCalendarEvents).toHaveBeenCalledWith("2026-09-27", "2026-10-31");
  });

  it("?view=agenda is not a view any more: it draws the default Month, no Agenda toggle, no error", async () => {
    const agenda = await render({ view: "agenda", outlook: { status: "ok", events: [storedConsult()] } });
    const month = await render({ view: "month", outlook: { status: "ok", events: [storedConsult()] } });
    expect(agenda).toBe(month);
    expect(agenda).toContain("October 2026");
    expect(agenda).not.toContain("Agenda");
    expect(agenda).toContain("Month");
    expect(agenda).toContain("Week");
  });

  it("week view: the chip sits beside the deadline and task on its day, marked Consult, with Join beside it", async () => {
    const html = await render({ view: "week", outlook: { status: "ok", events: [storedConsult()] } });
    expect(html).toContain("Respond to office action");
    expect(html).toContain("Call the examiner");
    expect(html).toMatch(/is-event[^>]*>[\s\S]*?Consult[\s\S]*?Strategy Session: Amara Nwosu/);
    expect(html).toMatch(/<a [^>]*href="https:\/\/teams\.microsoft\.com\/[^"]*"[^>]*>Join<\/a>/);
    // The Join link is a sibling of the chip, never nested inside a link.
    expect(html).not.toMatch(/<a [^>]*class="lx-cal-item[^"]*"[^>]*>(?:(?!<\/a>)[\s\S])*<a /);
  });

  it("an Outlook row the base read also returns is drawn once", async () => {
    const base = { id: "row-1", title: "Strategy Session: Amara Nwosu", starts_at: "2026-10-22T18:00:00.000Z", ends_at: null, all_day: false, location: null, event_type: null, contact_name: null, matter_id: null };
    const html = await render({ view: "week", baseEvents: [base], outlook: { status: "ok", events: [storedConsult({ id: "row-1" })] } });
    expect(html.match(/class="lx-cal-item is-event/g)).toHaveLength(1);
  });

  it("a database-update-needed Outlook read keeps deadlines and tasks and adds one quiet line", async () => {
    const html = await render({ outlook: { status: "database-update-needed" } });
    expect(html).toContain("Respond to office action");
    expect(html).toContain("Call the examiner");
    expect(html).toContain("Your Outlook calendar isn't showing yet. Lectual will turn it on.");
    expect(html).not.toContain("We couldn't load your Outlook calendar");
    expect(html).not.toContain("Meetings and consults");
  });

  it("an unavailable Outlook read keeps deadlines and tasks and says it couldn't be loaded", async () => {
    const html = await render({ outlook: { status: "unavailable" } });
    expect(html).toContain("Respond to office action");
    expect(html).toContain("Call the examiner");
    expect(html).toContain("We couldn't load your Outlook calendar. Docket dates and tasks are shown.");
    expect(html).not.toContain("Your Outlook calendar isn't showing yet");
  });

  it("a thrown Outlook read is the unavailable line, not a crashed page", async () => {
    const html = await render({ outlook: "throws" });
    expect(html).toContain("Respond to office action");
    expect(html).toContain("We couldn't load your Outlook calendar. Docket dates and tasks are shown.");
  });

  it("a firm without the mailbox module: no read, no Outlook line, and the header names only the docket and tasks", async () => {
    const html = await render({ mailbox: false });
    expect(listOutlookCalendarEvents).not.toHaveBeenCalled();
    expect(html).not.toContain("Outlook");
    expect(html).not.toContain("Meetings and consults");
    expect(html).toContain("Docket deadlines and task due dates.");
    expect(html).toContain("Respond to office action");
  });

  it("the header no longer claims events are synced from Lawmatics", async () => {
    for (const mailbox of [true, false]) {
      for (const view of ["week", "month"]) {
        const html = await render({ mailbox, view });
        expect(html).not.toContain("synced from Lawmatics");
        expect(html).not.toContain("Lawmatics");
      }
    }
    const withMailbox = await render({ mailbox: true });
    expect(withMailbox).toContain("Docket deadlines, task due dates, and events from your connected Outlook calendars.");
    expect(withMailbox).toContain("Times are in Eastern time.");
  });

  it("an empty Outlook list on a successful read says nothing extra", async () => {
    const html = await render({ outlook: { status: "ok", events: [] } });
    expect(html).not.toContain("Outlook events");
    expect(html).not.toContain("Meetings and consults");
  });
});
