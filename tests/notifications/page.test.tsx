import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const listMinePage = vi.fn();
const listMemberDirectory = vi.fn();

vi.mock("@/lib/notifications", () => ({
  PAGE_SIZE: 50,
  listMinePage: (...a: unknown[]) => listMinePage(...a),
  loadBell: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: (...a: unknown[]) => listMemberDirectory(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.now();

function note(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    kind: "assigned",
    lead_id: LEAD,
    matter_id: null,
    actor_id: "user-1",
    payload: { lead_name: `Lead ${i}` },
    read_at: null as string | null,
    created_at: new Date(NOW - i * 60_000).toISOString(),
    ...overrides,
  };
}

async function render(searchParams: { tab?: string; page?: string } = {}) {
  const { default: Page } = await import("@/app/dashboard/notifications/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.resetModules();
  listMinePage.mockReset();
  listMemberDirectory.mockReset();
  listMemberDirectory.mockResolvedValue([{ userId: "user-1", displayName: "Taylor McGhee", email: null, role: "owner", identified: true }]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("/dashboard/notifications page (F4)", () => {
  it("says all caught up only when the read worked and found nothing", async () => {
    listMinePage.mockResolvedValue({ rows: [], hasMore: false });
    const html = await render();
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).not.toContain("couldn&#x27;t be loaded");
  });

  it("says No unread notifications on an empty Unread tab", async () => {
    listMinePage.mockResolvedValue({ rows: [], hasMore: false });
    const html = await render({ tab: "unread" });
    expect(html).toContain("No unread notifications");
    expect(html).not.toContain("all caught up");
  });

  it("says it couldn't load, and never all caught up, when the read fails", async () => {
    listMinePage.mockRejectedValue(new Error("db down"));
    const html = await render();
    expect(html).toContain("couldn&#x27;t be loaded");
    expect(html).toContain("lx-banner-risk");
    expect(html).not.toContain("all caught up");
    expect(html).not.toContain("No unread");
  });

  it("asks for 50 per page and filters the Unread tab on read_at", async () => {
    listMinePage.mockResolvedValue({ rows: [note(1)], hasMore: false });
    await render({ tab: "unread" });
    expect(listMinePage).toHaveBeenCalledWith({ unreadOnly: true, offset: 0, limit: 50 });
    await render({ tab: "all", page: "3" });
    expect(listMinePage).toHaveBeenLastCalledWith({ unreadOnly: false, offset: 100, limit: 50 });
  });

  it("treats a junk tab or page as the first page of All", async () => {
    listMinePage.mockResolvedValue({ rows: [note(1)], hasMore: false });
    await render({ tab: "evil", page: "-4" });
    expect(listMinePage).toHaveBeenLastCalledWith({ unreadOnly: false, offset: 0, limit: 50 });
    await render({ page: "abc" });
    expect(listMinePage).toHaveBeenLastCalledWith({ unreadOnly: false, offset: 0, limit: 50 });
  });

  it("shows the unread dot only on unread rows, and Mark all read while any is unread", async () => {
    listMinePage.mockResolvedValue({
      rows: [note(1), note(2, { read_at: new Date(NOW).toISOString() })],
      hasMore: false,
    });
    const html = await render();
    expect(html.match(/aria-label="Unread"/g)).toHaveLength(1);
    expect(html).toContain("Lead 1");
    expect(html).toContain("Lead 2");
    expect(html).toContain("Mark all read");
  });

  it("omits Mark all read when everything is read", async () => {
    listMinePage.mockResolvedValue({ rows: [note(1, { read_at: new Date(NOW).toISOString() })], hasMore: false });
    expect(await render()).not.toContain("Mark all read");
  });

  it("shows Older only when a further page exists, and Newer only past page 1, carrying the tab", async () => {
    listMinePage.mockResolvedValue({ rows: [note(1)], hasMore: false });
    let html = await render();
    expect(html).not.toContain(">Older<");
    expect(html).not.toContain(">Newer<");

    listMinePage.mockResolvedValue({ rows: [note(1)], hasMore: true });
    html = await render({ tab: "unread" });
    expect(html).toContain('href="/dashboard/notifications?tab=unread&amp;page=2"');
    expect(html).toContain(">Older<");
    expect(html).not.toContain(">Newer<");

    html = await render({ tab: "unread", page: "2" });
    expect(html).toContain('href="/dashboard/notifications?tab=unread"');
    expect(html).toContain(">Newer<");
    expect(html).toContain('href="/dashboard/notifications?tab=unread&amp;page=3"');
  });

  it("links per entity: lead, matter and queue item", async () => {
    listMinePage.mockResolvedValue({
      rows: [
        note(1),
        note(2, { kind: "time_running", lead_id: null, matter_id: MATTER, payload: { hours: 9 } }),
        note(3, { kind: "mentioned", payload: { source: "approval_needed", queue_id: "q-77", headline: "Follow-up draft" } }),
      ],
      hasMore: false,
    });
    const html = await render();
    expect(html).toMatch(new RegExp(`href="/dashboard/leads/${LEAD}/?"`));
    expect(html).toMatch(new RegExp(`href="/dashboard/matters/${MATTER}/?"`));
    expect(html).toMatch(/href="\/dashboard\/queue\/q-77\/?"/);
    expect(html).toContain("A draft is waiting for your approval: Follow-up draft");
  });

  it("still lists notifications, with Someone as the name, when the actor lookup fails", async () => {
    listMemberDirectory.mockRejectedValue(new Error("rpc down"));
    listMinePage.mockResolvedValue({ rows: [note(1)], hasMore: false });
    const html = await render();
    expect(html).toContain("Someone assigned you Lead 1");
  });

  it("marks the current tab and states that notifications are internal", async () => {
    listMinePage.mockResolvedValue({ rows: [], hasMore: false });
    const html = await render({ tab: "unread" });
    expect(html).toMatch(/aria-current="page"[^>]*>Unread</);
    expect(html).toContain("Nothing here is emailed, texted or sent to a client");
  });
});
