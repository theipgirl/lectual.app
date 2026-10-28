import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { listUpcomingZoomMeetings, zoomAuthorizeUrl, ZOOM_SCOPES, ZOOM_UPCOMING_SCOPE, type UpcomingZoom, type ZoomUpcoming } from "@/lib/meetings/zoom";
import {
  joinKey,
  loadTodayConsults,
  mergeConsults,
  outlookItem,
  sourceNote,
  zoomConsults,
  type ConsultDeps,
  type ConsultItem,
  type TodayConsultsResult,
} from "@/lib/calendar/consult-sources";
import type { OutlookRead, TodayConsult } from "@/lib/calendar/outlook-read";
import { storedConsult } from "../calendar/fixtures";
import { TodayConsultsView } from "@/components/calendar/TodayConsults";

process.env.__NEXT_TRAILING_SLASH = "true";

// The card's self-loading wrapper imports the live reads; only the pure view is rendered here.
vi.mock("@/lib/calendar/consult-sources-live", () => ({ liveConsultDeps: {} }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn() }));

const NOW = new Date("2026-10-27T15:00:00Z");
const TZ = "America/New_York";
const SENTINEL = "SENTINEL-TITLE-ATTENDEE-TOKEN";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("Zoom upcoming-meetings reader", () => {
  it("calls GET /users/me/meetings?type=upcoming with the Bearer token and a timeout signal, and maps meetings", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { meetings: [{ id: 81234567890, topic: " Strategy Session: Amara ", start_time: "2026-10-28T18:00:00Z", join_url: "https://us02web.zoom.us/j/81234567890?pwd=x" }, { id: 5, topic: "no start" }] }),
    );
    const res = await listUpcomingZoomMeetings({ accessToken: "tok", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.zoom.us/v2/users/me/meetings?type=upcoming");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(res).toEqual({
      status: "ok",
      meetings: [{ id: "81234567890", title: "Strategy Session: Amara", startsAt: "2026-10-28T18:00:00.000Z", joinUrl: "https://us02web.zoom.us/j/81234567890?pwd=x" }],
    });
  });

  it.each([
    [403, {}, "needs-permission"],
    [401, { code: 4711, message: "Invalid access token, does not contain scopes:[meeting:read:list_meetings]." }, "needs-permission"],
    [400, { message: "Invalid scope" }, "needs-permission"],
    [401, { code: 124, message: "Invalid access token." }, "reconnect"],
    [500, {}, "unavailable"],
    [429, {}, "unavailable"],
  ])("HTTP %i maps to %s", async (status, body, expected) => {
    const res = await listUpcomingZoomMeetings({ accessToken: "t", fetchImpl: vi.fn(async () => json(status, body)) });
    expect(res.status).toBe(expected);
  });

  it("a network failure or a bad body is 'unavailable', never an empty list", async () => {
    expect((await listUpcomingZoomMeetings({ accessToken: "t", fetchImpl: vi.fn(async () => Promise.reject(new Error("net"))) })).status).toBe("unavailable");
    expect((await listUpcomingZoomMeetings({ accessToken: "t", fetchImpl: vi.fn(async () => new Response("not json", { status: 200 })) })).status).toBe("unavailable");
  });

  it("no title, attendee or token reaches any logger", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    await listUpcomingZoomMeetings({
      accessToken: SENTINEL,
      fetchImpl: vi.fn(async () => json(200, { meetings: [{ id: 1, topic: `Consult ${SENTINEL}`, start_time: "2026-10-28T18:00:00Z", registrants: [SENTINEL] }] })),
    });
    await listUpcomingZoomMeetings({ accessToken: SENTINEL, fetchImpl: vi.fn(async () => json(401, { message: SENTINEL })) });
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
  });

  it("is read only: no database or storage call in the reader module", () => {
    const src = fs.readFileSync("src/lib/meetings/zoom.ts", "utf8");
    expect(src).not.toMatch(/getAdminClient|getScopedClient|\.insert\(|\.upsert\(/);
  });
});

describe("connect request carries the list scope", () => {
  it("ZOOM_SCOPES has meeting:read:list_meetings and the authorize URL sends all of them as `scope`", () => {
    expect(ZOOM_UPCOMING_SCOPE).toBe("meeting:read:list_meetings");
    expect(ZOOM_SCOPES).toContain("meeting:read:list_meetings");
    expect(ZOOM_SCOPES).toContain("cloud_recording:read:list_user_recordings");
    const url = new URL(zoomAuthorizeUrl({ clientId: "c", redirectUri: "https://x/cb/", nonce: "n", challenge: "ch" }));
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...ZOOM_SCOPES]);
  });

  it("docs/meetings-setup.md names the scope and says Taylor adds it in the Zoom app", () => {
    const doc = fs.readFileSync("docs/meetings-setup.md", "utf8");
    expect(doc).toContain("meeting:read:list_meetings");
    expect(doc).toMatch(/Taylor must ADD this one in the Zoom\s+app's scope picker/);
  });

  it("the sealed-token helper is the meetings module's own, and no new file imports the admin client", () => {
    const files = [
      "src/lib/calendar/consult-sources.ts",
      "src/lib/calendar/consult-sources-live.ts",
      "src/lib/mailbox/read-message.ts",
      "src/lib/mailbox/read-message-live.ts",
      "src/lib/org/logo.ts",
      "src/lib/account/name.ts",
      "src/lib/account/actions.ts",
      "src/components/calendar/TodayConsults.tsx",
      "src/components/mailbox/MailReadingPane.tsx",
      "src/components/mailbox/LiveInboxList.tsx",
      "src/components/account/YourNameDialog.tsx",
      "src/components/account/AddNameLink.tsx",
      "src/components/today/NeedsYouSection.tsx",
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/mail/page.tsx",
      "src/app/dashboard/layout.tsx",
    ];
    for (const f of files) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/@\/lib\/db\/admin|getAdminClient\(/);
    expect(fs.readFileSync("src/lib/calendar/consult-sources-live.ts", "utf8")).toContain("ownZoomAccess");
    expect(fs.readFileSync("src/lib/meetings/connection.ts", "utf8")).toContain("export async function ownZoomAccess");
  });
});

function meeting(id: string, title: string, startsAt: string, joinUrl: string | null = `https://us02web.zoom.us/j/${id}`): ZoomUpcoming {
  return { id, title, startsAt, joinUrl };
}

describe("Zoom consults", () => {
  const meetings = [
    meeting("81111111111", "Strategy Session: Amara", "2026-10-28T18:00:00Z"),
    meeting("82222222222", "Team standup", "2026-10-28T14:00:00Z"),
    meeting("83333333333", "Initial call - Bo", "2026-10-30T15:00:00Z"),
    meeting("84444444444", "Consultation: far away", "2026-12-30T15:00:00Z"),
    meeting("85555555555", "Discovery Call: yesterday", "2026-10-20T15:00:00Z"),
  ];

  it("only titles matching the consult rule, inside the window, are consults", () => {
    const items = zoomConsults(meetings, new Map(), NOW, TZ);
    expect(items.map((i) => i.key)).toEqual(["zoom:81111111111", "zoom:83333333333"]);
  });

  it("a lead is linked only on an exact match; otherwise none", () => {
    const leads = new Map([["zoom:81111111111", { leadId: "lead-1", leadName: "Amara Nwosu" }]]);
    const items = zoomConsults(meetings, leads, NOW, TZ);
    expect(items[0]).toMatchObject({ leadId: "lead-1", leadName: "Amara Nwosu" });
    expect(items[1]).toMatchObject({ leadId: null, leadName: null });
  });
});

describe("merge", () => {
  const outlookRow = (over: Partial<TodayConsult> = {}): ConsultItem => outlookItem({ ...storedConsult(), lead_name: "Amara Nwosu", ...over });
  const zoomItem = (id: string, startsAt: string, over: Partial<ConsultItem> = {}): ConsultItem => ({
    key: `zoom:${id}`, source: "zoom", title: "Consult", startsAt, allDay: false, joinUrl: `https://us02web.zoom.us/j/${id}?pwd=abc`, leadId: null, leadName: null, ...over,
  });

  it("sorts both sources by start", () => {
    const merged = mergeConsults([outlookRow({ id: "o1", starts_at: "2026-10-30T18:00:00Z", join_url: null })], [zoomItem("81111111111", "2026-10-28T18:00:00Z")]);
    expect(merged.map((m) => m.source)).toEqual(["zoom", "outlook"]);
  });

  it("the same Zoom join URL or meeting id on both sources appears once, keeping the Outlook row and borrowing a lead", () => {
    const o = outlookRow({ id: "o2", join_url: "https://us02web.zoom.us/j/81111111111", lead_id: null, lead_name: null });
    const z = zoomItem("81111111111", "2026-10-28T18:00:00Z", { leadId: "lead-9", leadName: "Z Lead" });
    const merged = mergeConsults([o], [z]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: "outlook", leadId: "lead-9", leadName: "Z Lead" });
  });

  it("joinKey ties a Zoom /j/<id> link to the meeting id and leaves other links their own", () => {
    expect(joinKey("https://us02web.zoom.us/j/81111111111?pwd=x")).toBe("zoom:81111111111");
    expect(joinKey("https://teams.microsoft.com/l/meetup-join/abc?x=1")).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(joinKey(null)).toBeNull();
  });
});

function deps(over: Partial<ConsultDeps> = {}): ConsultDeps {
  return {
    hasMailboxModule: async () => true,
    outlookConnections: async () => ({ ok: true, active: 1, withCalendar: 1 }),
    outlook: async () => ({ status: "ok", consults: [] }),
    zoomAccess: async () => ({ state: "ok", accessToken: "tok" }),
    zoomUpcoming: async () => ({ status: "ok", meetings: [] }),
    zoomLeads: async () => new Map(),
    ...over,
  };
}

describe("source states", () => {
  const zoomIn = (status: UpcomingZoom["status"]): UpcomingZoom => (status === "ok" ? { status: "ok", meetings: [] } : ({ status } as UpcomingZoom));

  it("Zoom: scope missing / dead sign-in / not connected / failed each map to their own state", async () => {
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomUpcoming: async () => zoomIn("needs-permission") }))).zoom).toBe("needs-permission");
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomUpcoming: async () => zoomIn("reconnect") }))).zoom).toBe("reconnect");
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomAccess: async () => ({ state: "reconnect" }) }))).zoom).toBe("reconnect");
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomAccess: async () => ({ state: "not-connected" }) }))).zoom).toBe("not-connected");
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomUpcoming: async () => zoomIn("unavailable") }))).zoom).toBe("unavailable");
  });

  it("the token helper returning nothing is 'couldn't be read', never 'no consults'", async () => {
    const r = await loadTodayConsults(NOW, TZ, deps({ zoomAccess: async () => ({ state: "unreadable" }) }));
    expect(r.zoom).toBe("unavailable");
    const html = renderCard(r);
    expect(html).toContain("couldn't be read");
    expect(html).toContain("Check Zoom");
    expect(html).toContain("/dashboard/settings/integrations/meetings/");
    expect(html).not.toContain("No consults in the next");
  });

  it("a Zoom read that throws is 'unavailable'", async () => {
    expect((await loadTodayConsults(NOW, TZ, deps({ zoomUpcoming: async () => Promise.reject(new Error("x")) }))).zoom).toBe("unavailable");
  });

  it("Outlook: no module, not connected, calendar scope missing, update pending, failed", async () => {
    const outlookCalls = vi.fn(async (): Promise<OutlookRead<{ consults: TodayConsult[] }>> => ({ status: "ok", consults: [] }));
    expect((await loadTodayConsults(NOW, TZ, deps({ hasMailboxModule: async () => false, outlook: outlookCalls }))).outlook).toBe("no-module");
    expect((await loadTodayConsults(NOW, TZ, deps({ outlookConnections: async () => ({ ok: true, active: 0, withCalendar: 0 }), outlook: outlookCalls }))).outlook).toBe("not-connected");
    expect((await loadTodayConsults(NOW, TZ, deps({ outlookConnections: async () => ({ ok: true, active: 1, withCalendar: 0 }), outlook: outlookCalls }))).outlook).toBe("needs-calendar");
    expect(outlookCalls).not.toHaveBeenCalled();
    expect((await loadTodayConsults(NOW, TZ, deps({ outlook: async () => ({ status: "database-update-needed" }) }))).outlook).toBe("update-needed");
    expect((await loadTodayConsults(NOW, TZ, deps({ outlook: async () => ({ status: "unavailable" }) }))).outlook).toBe("unavailable");
    expect((await loadTodayConsults(NOW, TZ, deps({ outlookConnections: async () => ({ ok: false }) }))).outlook).toBe("unavailable");
  });

  it("one source failing while the other succeeds shows the successes AND names the failed source", async () => {
    const r = await loadTodayConsults(
      NOW,
      TZ,
      deps({
        zoomUpcoming: async () => ({ status: "needs-permission" }),
        outlook: async () => ({ status: "ok", consults: [{ ...storedConsult({ starts_at: "2026-10-28T18:00:00Z" }), lead_name: "Amara Nwosu" }] }),
      }),
    );
    expect(r.consults).toHaveLength(1);
    const html = renderCard(r);
    expect(html).toContain("Strategy Session: Amara Nwosu");
    expect(html).toContain("Zoom needs permission to read upcoming meetings");
    expect(html).toContain("Reconnect Zoom");
  });
});

function renderCard(result: TodayConsultsResult): string {
  return renderToStaticMarkup(<TodayConsultsView result={result} timeZone={TZ} />).replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");
}

describe("each state renders its own sentence, with a next step, and never null", () => {
  const base: TodayConsultsResult = { consults: [], outlook: "ok", zoom: "ok" };
  const cases: [string, TodayConsultsResult, string[]][] = [
    ["none today (every source read)", base, ["No consults in the next 7 days."]],
    ["Zoom scope missing", { ...base, zoom: "needs-permission" }, ["Zoom needs permission to read upcoming meetings", "Reconnect Zoom", "/dashboard/settings/integrations/meetings/"]],
    ["Zoom dead sign-in", { ...base, zoom: "reconnect" }, ["no longer accepts", "Reconnect Zoom"]],
    ["Zoom not connected", { ...base, zoom: "not-connected" }, ["Zoom isn't connected", "Connect Zoom"]],
    ["Outlook calendar scope missing", { ...base, outlook: "needs-calendar" }, ["Outlook calendar isn't connected", "Reconnect to read the calendar", "/dashboard/settings/integrations/"]],
    ["Outlook not connected", { ...base, outlook: "not-connected" }, ["Outlook calendar isn't connected", "Connect Outlook"]],
    ["no module", { ...base, outlook: "no-module", zoom: "not-connected" }, ["Outlook calendar isn't switched on for your firm.", "See Integrations", "Connect Zoom"]],
    ["read failed", { ...base, outlook: "unavailable", zoom: "unavailable" }, ["Outlook consults couldn't be read just now.", "Zoom meetings couldn't be read.", "Check Zoom", "/dashboard/settings/integrations/meetings/", "See Integrations"]],
  ];

  it.each(cases)("%s", (_name, result, needles) => {
    const html = renderCard(result);
    expect(html).toContain(">Consults<");
    for (const n of needles) expect(html).toContain(n);
    if (needles[0] !== "No consults in the next 7 days.") expect(html).not.toContain("No consults in the next");
  });

  it("only a source that was read is called empty", () => {
    const html = renderCard({ ...base, zoom: "needs-permission" });
    expect(html).toContain("No consults found in Outlook");
    expect(html).not.toContain("No consults found in Outlook and");
  });

  it("sourceNote is null only for an ok source", () => {
    expect(sourceNote("zoom", "ok")).toBeNull();
    expect(sourceNote("outlook", "ok")).toBeNull();
    for (const s of ["not-connected", "needs-calendar", "needs-permission", "reconnect", "no-module", "update-needed", "unavailable"] as const) {
      expect(sourceNote("zoom", s)).not.toBeNull();
      expect(sourceNote("outlook", s)).not.toBeNull();
      expect(sourceNote("zoom", s)?.link).not.toBeNull();
      expect(sourceNote("outlook", s)?.link).not.toBeNull();
    }
  });

  it("the self-loading card never returns null in source", () => {
    const src = fs.readFileSync("src/components/calendar/TodayConsults.tsx", "utf8");
    expect(src).not.toMatch(/return null;?\s*\n\s*(const|\})/);
    expect(src).not.toMatch(/orgHasModule/);
  });
});
