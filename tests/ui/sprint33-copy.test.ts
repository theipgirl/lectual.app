import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stepLabel, zoneLabel } from "@/lib/calendar/zone-label";
import { reconnectSentence } from "@/lib/meetings/reconnect-copy";
import { ROOT, stripAndCollect, walk } from "./_scan";

const read = (p: string) => readFileSync(p, "utf8");
const files = [...walk("src/app"), ...walk("src/components"), ...walk("src/lib")];
const visible = (f: string) => stripAndCollect(read(f)).strings.map((s) => s.text).join("\n");

describe("F17: queue item, notifications, calendar, meetings copy", () => {
  it("the queue item's tab title is its headline, with the Approval fallback", () => {
    const src = read("src/app/dashboard/queue/[id]/page.tsx");
    expect(src).toContain("generateMetadata");
    expect(src).toMatch(/\.headline\?\.trim\(\) \|\| null[\s\S]*"Approval"/);
    expect(src).not.toContain('pageTitle("Approval item")');
  });

  it("Notifications has no Inbox eyebrow and the new error sentence", () => {
    const src = read("src/app/dashboard/notifications/page.tsx");
    expect(src).not.toContain('<div className="lx-label">Inbox</div>');
    expect(src).toContain("We couldn&apos;t load your notifications. Try again in a moment.");
    expect(src).not.toContain("This isn&apos;t the same as having none");
  });

  it("Calendar notes are plain: no 'database update', Eastern time, and arrows that name the period", () => {
    const src = read("src/app/dashboard/calendar/page.tsx");
    expect(src).toContain("Your Outlook calendar isn't showing yet. Lectual will turn it on.");
    expect(src).toContain("We couldn't load your Outlook calendar. Docket dates and tasks are shown.");
    expect(src).not.toMatch(/database update/i);
    expect(zoneLabel("America/New_York")).toBe("Eastern time");
    expect(zoneLabel("Europe/London")).toBe("London time");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires time");
    expect(stepLabel("previous", "month")).toBe("Previous month");
    expect(stepLabel("next", "week")).toBe("Next week");
    expect(stepLabel("next", "agenda")).toBe("Next period");
  });

  it("Meetings names the source that needs reconnecting", () => {
    expect(reconnectSentence(["Fathom"])).toBe("Your Fathom connection needs to be reconnected. New meetings aren't coming in.");
    expect(reconnectSentence(["Fathom", "Zoom"])).toBe("Your Fathom and Zoom connections need to be reconnected. New meetings aren't coming in.");
    expect(read("src/app/dashboard/meetings/page.tsx")).not.toContain("stopped accepting your firm");
  });
});

describe("V3: words that must not come back", () => {
  const scanned = files.filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/lib/db/") && !f.includes("/legacy/"));

  it("no firm-facing 'Coming soon', 'from the tracker' or 'database update'", () => {
    const skip = new Set(["src/components/integrations/states.ts", "src/lib/integrations/copy.ts"]);
    for (const f of scanned) {
      const text = visible(f);
      if (!skip.has(f)) expect(text, `${f} Coming soon`).not.toMatch(/Coming soon/);
      expect(text, `${f} from the tracker`).not.toContain("(from the tracker)");
      expect(text, `${f} database update`).not.toMatch(/database update/i);
    }
  });

  it("'Quotes & proposals' appears only on the older Quotes surface, never on the Proposals pages", () => {
    const allowed = new Set(["src/app/dashboard/quotes/page.tsx", "src/lib/nav.ts", "src/lib/reports/intake.ts"]);
    for (const f of scanned) {
      if (allowed.has(f)) continue;
      expect(visible(f), f).not.toMatch(/Quotes (&|&amp;|and) proposals/);
    }
    expect(ROOT).toBeTruthy();
  });
});
