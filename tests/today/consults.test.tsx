import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OutlookRead, TodayConsult } from "@/lib/calendar/outlook-read";
import { storedConsult } from "../calendar/fixtures";
import type { ConsultDeps } from "@/lib/calendar/consult-sources";
import type { UpcomingZoom } from "@/lib/meetings/zoom";

// next.config.ts sets trailingSlash: true, which <Link> reads from this variable.
process.env.__NEXT_TRAILING_SLASH = "true";

/** Today's Consults card (Sprint 15, F13): three states, and nothing for a firm without the mailbox module. */
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "").replaceAll(" ", " ");
const loadConsultsForToday = vi.fn();

function consult(over: Partial<TodayConsult> = {}): TodayConsult {
  return { ...storedConsult(), lead_name: "Amara Nwosu", ...over };
}

type Opts = {
  mailbox?: boolean;
  read?: OutlookRead<{ consults: TodayConsult[] }>;
  outlookConns?: { ok: true; active: number; withCalendar: number } | { ok: false };
  zoom?: { state: "ok"; accessToken: string } | { state: "not-connected" | "reconnect" | "unreadable" };
  zoomRead?: UpcomingZoom;
};

/** Renders the self-loading card with every read faked: Outlook ok and Zoom not connected unless told otherwise. */
async function render(opts: Opts = {}) {
  vi.resetModules();
  loadConsultsForToday.mockReset();
  loadConsultsForToday.mockResolvedValue(opts.read ?? { status: "ok", consults: [] });
  const deps: ConsultDeps = {
    hasMailboxModule: async () => opts.mailbox ?? true,
    outlookConnections: async () => opts.outlookConns ?? { ok: true, active: 1, withCalendar: 1 },
    outlook: loadConsultsForToday,
    zoomAccess: async () => opts.zoom ?? { state: "ok", accessToken: "tok" },
    zoomUpcoming: async () => opts.zoomRead ?? { status: "ok", meetings: [] },
    zoomLeads: async () => new Map(),
  };
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: deps }));
  const { TodayConsults } = await import("@/components/calendar/TodayConsults");
  return text(renderToStaticMarkup(await TodayConsults()));
}

beforeEach(() => vi.resetModules());

describe("Today: Consults card", () => {
  it("lists time in the firm zone, title, a lead link and Join, for the row shape the sync stores", async () => {
    const html = await render({ read: { status: "ok", consults: [consult()] } });
    expect(html).toContain(">Consults<");
    expect(html).toContain("Strategy Session: Amara Nwosu");
    expect(html).toContain("Thu, Oct 22, 2:00 PM");
    expect(html).toMatch(/<a href="\/dashboard\/leads\/lead-amara\/">Amara Nwosu<\/a>/);
    expect(html).toMatch(/<a [^>]*href="https:\/\/teams\.microsoft\.com\/l\/meetup-join\/strategy-1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Join<\/a>/);
    expect(loadConsultsForToday).toHaveBeenCalledTimes(1);
    expect(loadConsultsForToday.mock.calls[0][1]).toBe("America/New_York");
  });

  it("a consult with no linked lead has no lead link, and one with no join URL has no Join", async () => {
    const html = await render({ read: { status: "ok", consults: [consult({ lead_id: null, lead_name: null, join_url: null })] } });
    expect(html).toContain("Strategy Session");
    expect(html).not.toContain("/dashboard/leads/");
    expect(html).not.toContain("Join");
  });

  it("a linked lead whose name couldn't be read still links, as 'Open lead'", async () => {
    const html = await render({ read: { status: "ok", consults: [consult({ lead_name: null })] } });
    expect(html).toMatch(/<a href="\/dashboard\/leads\/lead-amara\/">Open lead<\/a>/);
  });

  it("a real empty list says there are no consults in the next 7 days only when every source was read", async () => {
    const html = await render({ read: { status: "ok", consults: [] } });
    expect(html).toContain("No consults in the next 7 days.");
  });

  it("an unreadable or pending Outlook read says so in its own words and never the empty-list sentence", async () => {
    const unavailable = await render({ read: { status: "unavailable" } });
    const waiting = await render({ read: { status: "database-update-needed" } });
    expect(unavailable).toContain("Outlook consults couldn't be read just now.");
    expect(waiting).toContain("aren't switched on for your firm yet");
    for (const html of [unavailable, waiting]) {
      expect(html).not.toContain("No consults in the next");
      expect(html).toContain(">Consults<");
    }
    expect(unavailable).not.toBe(waiting);
  });

  it("a firm without the mailbox module still gets a card with a sentence and a next step, and no Outlook read", async () => {
    const html = await render({ mailbox: false });
    expect(html).toContain(">Consults<");
    expect(html).toContain("Outlook calendar isn't switched on for your firm.");
    expect(html).toContain("/dashboard/settings/integrations/");
    expect(loadConsultsForToday).not.toHaveBeenCalled();
  });
});

describe("Today page wiring", () => {
  it("mounts the card with one import and one element, touching nothing else in Today", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(page.match(/<TodayConsults\b/g)).toHaveLength(1);
    expect(page.match(/import \{ TodayConsults \} from "@\/components\/calendar\/TodayConsults";/g)).toHaveLength(1);
  });
});
