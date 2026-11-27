import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * View as, private places (spec "Private places", tests 9 and 13). While previewing, the owner's OWN private items (their
 * notifications, their personal mailbox, their personal Outlook, their Copilot chats) are never read for display, and the
 * teammate's are not readable: each place shows its fixed sentence. Shared-mailbox mail and firm connections still show.
 * No live provider read runs (Zoom, the live Inbox, the reading pane): a refresh would rotate a token.
 */
const previewing = vi.fn(async () => ({ userId: "22222222-2222-4222-8222-222222222222", name: "Dana Lee" }) as { userId: string; name: string } | null);
const flagOn = vi.fn(async () => true);
vi.mock("@/lib/views/view-as", () => ({
  previewingAs: () => previewing(),
  inPreview: () => flagOn(),
  resolveViewSession: async () => ({
    kind: "ok",
    user: { id: "22222222-2222-4222-8222-222222222222", user_metadata: {} },
    member: { role: "paralegal", org_id: "o1" },
    org: { id: "o1", name: "Example Firm", slug: "ex", modules: ["mailbox"] },
    role: "paralegal",
    actingAsStaff: false,
    displayName: "Dana Lee",
  }),
}));

// Notifications
const listMinePage = vi.fn(async () => ({ rows: [{ id: "n1", body: "OWNER-PRIVATE-NOTE" }], total: 1 }));
vi.mock("@/lib/notifications", () => ({ listMinePage: () => listMinePage(), PAGE_SIZE: 25 }));
vi.mock("@/components/notifications/NotificationBell", () => ({ loadActorNames: async () => ({}) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));

// Copilot
const listConversations = vi.fn(async () => ({ status: "ok", conversations: [{ id: "c1", title: "OWNER-PRIVATE-CHAT" }] }));
vi.mock("@/lib/copilot/history-store", () => ({ listConversations: () => listConversations(), loadConversation: async () => null }));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));

// My Mail
const OWNER_PERSONAL = { id: "c-personal", user_id: "11111111-1111-4111-8111-111111111111", scope: "personal", provider: "microsoft", email: "owner-own@example.com", status: "active", scopes: ["Calendars.Read"], last_synced_at: null };
const FIRM_SHARED = { id: "c-firm", user_id: null, scope: "firm", provider: "microsoft", email: "intake@example.com", status: "active", scopes: [], last_synced_at: null };
const connections = vi.fn(async () => ({ ok: true, connections: [OWNER_PERSONAL, FIRM_SHARED] }));
vi.mock("@/lib/mailbox/connections", () => ({ listConnections: () => connections() }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async () => true }));
const crmActivityIn = vi.fn();
vi.mock("@/lib/db/scoped-client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) chain[k] = () => chain;
  chain.in = (col: string, ids: string[]) => {
    crmActivityIn(col, ids);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { getScopedClient: async () => ({ from: () => chain }) };
});
const loadLiveInbox = vi.fn();
const loadLiveMessage = vi.fn();
const loadStoredMessage = vi.fn();
vi.mock("@/lib/mailbox/read-message", () => ({ loadLiveInbox: (...a: unknown[]) => loadLiveInbox(...a), loadLiveMessage: (...a: unknown[]) => loadLiveMessage(...a), loadStoredMessage: (...a: unknown[]) => loadStoredMessage(...a) }));
vi.mock("@/lib/mailbox/read-message-live", () => ({ liveMailReadDeps: {} }));
vi.mock("@/components/mailbox/MailFolderSelect", () => ({ MailFolderSelect: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/dashboard/mail/", useSearchParams: () => new URLSearchParams() }));

// Consults (Today)
const zoomAccess = vi.fn(async () => ({ state: "ok", accessToken: "t" }));
const zoomUpcoming = vi.fn(async () => ({ status: "ok", meetings: [] }));
const outlookRead = vi.fn(async () => ({ status: "ok", consults: [] }));
vi.mock("@/lib/calendar/consult-sources-live", () => ({
  liveConsultDeps: {
    hasMailboxModule: async () => true,
    outlookConnections: async () => ({ ok: true, active: 1, withCalendar: 1 }),
    outlook: () => outlookRead(),
    zoomAccess: () => zoomAccess(),
    zoomUpcoming: () => zoomUpcoming(),
    zoomLeads: async () => new Map(),
  },
}));
vi.mock("@/lib/mailbox/providers", async (orig) => ({ ...(await orig<object>()), hasCalendarScope: (_p: string, scopes: unknown) => Array.isArray(scopes) && scopes.includes("Calendars.Read") }));

import NotificationsPage from "@/app/dashboard/notifications/page";
import CopilotPage from "@/app/dashboard/copilot/page";
import MyMailPage from "@/app/dashboard/mail/page";
import { consultDepsForViewer } from "@/lib/calendar/consult-deps-view";
import { loadTodayConsults, sourceNote } from "@/lib/calendar/consult-sources";
import { PreviewBell } from "@/components/views/PreviewBell";
import { VIEW_AS_OUTLOOK_UNCHECKED, VIEW_AS_LIVE_MAIL, VIEW_AS_PRIVATE_BELL, VIEW_AS_PRIVATE_COPILOT, VIEW_AS_PRIVATE_MAIL, VIEW_AS_PRIVATE_OUTLOOK, VIEW_AS_ZOOM } from "@/lib/ui/words";

const html = (el: unknown) => renderToStaticMarkup(createElement("div", null, el as never));
const NAME = "Dana Lee";

beforeEach(() => {
  for (const f of [listMinePage, listConversations, loadLiveInbox, loadLiveMessage, loadStoredMessage, zoomAccess, zoomUpcoming, outlookRead, crmActivityIn]) f.mockClear();
});

describe("in a preview", () => {
  it("the bell is muted with the sentence", () => {
    const out = html(createElement(PreviewBell, { name: NAME }));
    expect(out).toContain("notifications are private to them and aren");
    expect(out).toContain(NAME);
    expect(VIEW_AS_PRIVATE_BELL(NAME)).toBe("Dana Lee's notifications are private to them and aren't shown in a preview.");
  });

  it("the notifications page reads nothing and shows the sentence", async () => {
    const out = html(await NotificationsPage({ searchParams: Promise.resolve({}) }));
    expect(listMinePage).not.toHaveBeenCalled();
    expect(out).not.toContain("OWNER-PRIVATE-NOTE");
    expect(out).toContain("notifications are private to them");
  });

  it("the Copilot page reads no chat and shows the sentence", async () => {
    const out = html(await CopilotPage({ searchParams: Promise.resolve({}) }));
    expect(listConversations).not.toHaveBeenCalled();
    expect(out).not.toContain("OWNER-PRIVATE-CHAT");
    expect(out).toContain("Copilot chats are private to them");
    expect(VIEW_AS_PRIVATE_COPILOT(NAME)).toContain(NAME);
  });

  it("My Mail: the shared mailbox only, from stored rows; never the owner's personal one; no live Inbox or reading pane", async () => {
    const out = html(await MyMailPage({ searchParams: Promise.resolve({ tab: "inbox", m: "88888888-8888-4888-8888-888888888888", live: "abc" }) }));
    expect(out).not.toContain("owner-own@example.com");
    expect(out).toContain("intake@example.com");
    expect(out).toContain("own mailbox is private to them");
    expect(out).toContain("Live mail isn");
    expect(VIEW_AS_LIVE_MAIL).toBe("Live mail isn't read in a preview. Stored messages are shown.");
    expect(loadLiveInbox).not.toHaveBeenCalled();
    expect(loadLiveMessage).not.toHaveBeenCalled();
    expect(loadStoredMessage).not.toHaveBeenCalled();
    // The stored-row read names only the shared connection.
    expect(crmActivityIn).toHaveBeenCalledWith("payload->>connection_id", ["c-firm"]);
    expect(VIEW_AS_PRIVATE_MAIL(NAME)).toContain(NAME);
  });

  it("My Mail with only the owner's personal mailbox: the sentence, never 'Connect your mailbox'", async () => {
    connections.mockResolvedValueOnce({ ok: true, connections: [OWNER_PERSONAL] });
    const out = html(await MyMailPage({ searchParams: Promise.resolve({}) }));
    expect(out).not.toContain("owner-own@example.com");
    expect(out).not.toContain("Connect your mailbox");
    expect(out).toContain("own mailbox is private to them");
  });

  it("Today's Consults: firm (shared) Outlook connections only, the teammate's own Outlook unchecked, Zoom not read", async () => {
    const deps = await consultDepsForViewer({ name: NAME, sharedOnly: true });
    // Only the owner's PERSONAL Outlook is connected: never counted for the teammate.
    connections.mockResolvedValueOnce({ ok: true, connections: [OWNER_PERSONAL] });
    const result = await loadTodayConsults(new Date("2026-11-23T15:00:00Z"), "America/New_York", deps);
    expect(result.outlook).toBe("preview");
    expect(result.zoom).toBe("preview");
    expect(zoomAccess).not.toHaveBeenCalled();
    expect(zoomUpcoming).not.toHaveBeenCalled();
    expect(outlookRead).not.toHaveBeenCalled();
    expect(sourceNote("outlook", result.outlook, result.previewName)?.text).toBe(VIEW_AS_PRIVATE_OUTLOOK(NAME));
    expect(sourceNote("zoom", result.zoom, result.previewName)?.text).toBe(VIEW_AS_ZOOM);
  });

  it("a firm (shared) Outlook calendar still shows its stored consults", async () => {
    const deps = await consultDepsForViewer({ name: NAME, sharedOnly: true });
    connections.mockResolvedValueOnce({ ok: true, connections: [OWNER_PERSONAL, { ...FIRM_SHARED, scopes: ["Calendars.Read"] }] });
    const result = await loadTodayConsults(new Date("2026-11-23T15:00:00Z"), "America/New_York", deps);
    expect(result.outlook).toBe("ok");
    expect(outlookRead).toHaveBeenCalledTimes(1);
  });
});

describe("the provider skips key on the FLAG (on or couldn't be checked), not on a named teammate", () => {
  it("state unknown (no teammate named): My Mail still reads no live mail and no reading pane", async () => {
    previewing.mockResolvedValueOnce(null);
    const out = html(await MyMailPage({ searchParams: Promise.resolve({ tab: "inbox", m: "88888888-8888-4888-8888-888888888888", live: "abc" }) }));
    expect(loadLiveInbox).not.toHaveBeenCalled();
    expect(loadLiveMessage).not.toHaveBeenCalled();
    expect(loadStoredMessage).not.toHaveBeenCalled();
    expect(out).toContain("Live mail isn");
  });

  it("state unknown: Zoom is not read, and the Outlook note reads without a name", async () => {
    const deps = await consultDepsForViewer({ name: null, sharedOnly: true });
    connections.mockResolvedValueOnce({ ok: true, connections: [OWNER_PERSONAL] });
    const result = await loadTodayConsults(new Date("2026-11-23T15:00:00Z"), "America/New_York", deps);
    expect(zoomAccess).not.toHaveBeenCalled();
    expect(sourceNote("outlook", result.outlook, result.previewName)?.text).toBe(VIEW_AS_OUTLOOK_UNCHECKED);
    expect(VIEW_AS_OUTLOOK_UNCHECKED).not.toMatch(/Their/);
  });

  it("the consults card and Today ask consultPreview (the flag), never previewingAs", () => {
    for (const f of ["src/components/calendar/TodayConsults.tsx", "src/components/today/OwnerToday.tsx"]) {
      const src = readFileSync(path.resolve(__dirname, "../..", f), "utf8");
      expect(src, f).toMatch(/consultDepsForViewer\(await consultPreview\(\)\)/);
    }
    const mail = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/mail/page.tsx"), "utf8");
    expect(mail).toMatch(/const skipLive = await inPreview\(\);/);
  });
});

describe("not previewing", () => {
  it("the live deps are used unchanged", async () => {
    const deps = await consultDepsForViewer(null);
    const result = await loadTodayConsults(new Date("2026-11-23T15:00:00Z"), "America/New_York", deps);
    expect(result.previewName).toBeUndefined();
    expect(zoomAccess).toHaveBeenCalledTimes(1);
  });
});
