import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline, timelineDate } from "../../src/components/timeline/Timeline";

const row = (id: string, created_at: string) => ({ id, type: "note", actor_type: "user", created_at, payload: { text: "Called the client" } });
const thisYear = new Date().getUTCFullYear();

describe("Timeline dates are real dates (Nov 17)", () => {
  it("shows 'Nov 11', never relative words, even for a row from a few days ago", () => {
    const recent = new Date(Date.now() - 6 * 86_400_000).toISOString();
    const html = renderToStaticMarkup(<Timeline rows={[row("a", recent), row("b", `${thisYear}-03-04T15:00:00Z`)]} timeZone="America/New_York" />);
    expect(html).not.toMatch(/ago|just now|min|\bh\b/);
    expect(html).toContain("Mar 4");
    expect(html).toMatch(/lx-note">[A-Z][a-z]{2} \d{1,2}</);
  });

  it("uses the firm's zone: a late-evening Eastern entry is the same day, not the next UTC day", () => {
    expect(timelineDate(`${thisYear}-11-11T02:30:00Z`, "America/New_York")).toBe("Nov 10");
    expect(timelineDate(`${thisYear}-11-11T02:30:00Z`, "UTC")).toBe("Nov 11");
  });

  it("adds the year only when it is not this year", () => {
    expect(timelineDate("2019-11-11T15:00:00Z", "America/New_York")).toBe("Nov 11, 2019");
  });

  it("keeps entries, detail and order exactly as given", () => {
    const html = renderToStaticMarkup(<Timeline rows={[row("a", `${thisYear}-05-02T12:00:00Z`), row("b", `${thisYear}-04-01T12:00:00Z`)]} timeZone="America/New_York" />);
    expect(html.indexOf("May 2")).toBeLessThan(html.indexOf("Apr 1"));
    expect(html.split("Called the client").length - 1).toBe(2);
  });

  it("today's entries also show the time (so same-day entries keep their order); other days do not", () => {
    const now = new Date("2026-11-17T20:00:00Z");
    expect(timelineDate("2026-11-17T19:30:00Z", "America/New_York", now)).toBe("Nov 17, 2:30 PM");
    expect(timelineDate("2026-11-16T19:30:00Z", "America/New_York", now)).toBe("Nov 16");
  });
});
