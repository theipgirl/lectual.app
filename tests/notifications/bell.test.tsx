import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const loadBell = vi.fn();
const listMemberDirectory = vi.fn();

vi.mock("@/lib/notifications", () => ({ loadBell: (...a: unknown[]) => loadBell(...a), markRead: vi.fn(), markAllRead: vi.fn() }));
vi.mock("@/lib/members/directory", () => ({ listMemberDirectory: (...a: unknown[]) => listMemberDirectory(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const LEAD = "11111111-1111-4111-8111-111111111111";
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
    created_at: new Date(NOW - i * 3600_000).toISOString(),
    ...overrides,
  };
}

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const unavailable = { status: "unavailable" as const };

async function render() {
  const { NotificationBell } = await import("@/components/notifications/NotificationBell");
  return renderToStaticMarkup(await NotificationBell());
}

beforeEach(() => {
  vi.resetModules();
  loadBell.mockReset();
  listMemberDirectory.mockReset();
  listMemberDirectory.mockResolvedValue([{ userId: "user-1", displayName: "Taylor McGhee", email: "t@firm.example", role: "owner", identified: true }]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const badge = (html: string) => html.match(/class="lx-bell-badge[^"]*"[^>]*>([^<]*)</)?.[1];

describe("NotificationBell states (F3)", () => {
  it("shows the unread count", async () => {
    loadBell.mockResolvedValue({ count: ok(3), list: ok([note(1), note(2), note(3)]) });
    const html = await render();
    expect(badge(html)).toBe("3");
    expect(html).toContain('aria-label="Notifications, 3 unread"');
  });

  it("caps the badge at 9+", async () => {
    loadBell.mockResolvedValue({ count: ok(12), list: ok([note(1)]) });
    expect(badge(await render())).toBe("9+");
  });

  it("shows nine as 9", async () => {
    loadBell.mockResolvedValue({ count: ok(9), list: ok([note(1)]) });
    expect(badge(await render())).toBe("9");
  });

  it("has no badge at zero, and says all caught up only because the read worked", async () => {
    loadBell.mockResolvedValue({ count: ok(0), list: ok([]) });
    const html = await render();
    expect(html).not.toContain("lx-bell-badge");
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).not.toContain("Mark all read");
  });

  it("shows ! with the title when the count cannot load, never a 0", async () => {
    loadBell.mockResolvedValue({ count: unavailable, list: ok([note(1)]) });
    const html = await render();
    expect(html).toContain('title="Couldn&#x27;t load notifications"');
    expect(badge(html)).toBe("!");
    expect(html).toContain("couldn&#x27;t load");
    expect(html).not.toMatch(/lx-bell-badge[^>]*>\s*0/);
  });

  it("renders the ! state when the loader throws, without throwing", async () => {
    loadBell.mockRejectedValue(new Error("boom"));
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load notifications");
    expect(badge(html)).toBe("!");
    expect(html).not.toContain("all caught up");
  });

  it("keeps the count when only the list is unavailable, and does not say all caught up", async () => {
    loadBell.mockResolvedValue({ count: ok(4), list: unavailable });
    const html = await render();
    expect(badge(html)).toBe("4");
    expect(html).toContain("load your notifications");
    expect(html).not.toContain("all caught up");
  });

  it("does not claim all caught up when the list is empty but the count failed", async () => {
    loadBell.mockResolvedValue({ count: unavailable, list: ok([]) });
    const html = await render();
    expect(html).not.toContain("all caught up");
  });

  it("falls back to Someone when the actor name cannot be read, and still lists the notifications", async () => {
    listMemberDirectory.mockRejectedValue(new Error("rpc down"));
    loadBell.mockResolvedValue({ count: ok(1), list: ok([note(1)]) });
    const html = await render();
    expect(html).toContain("Someone assigned you Lead 1");
  });
});

describe("NotificationBell panel (F3)", () => {
  it("names the actor, links the row and shows a relative time and an accessible unread dot", async () => {
    loadBell.mockResolvedValue({ count: ok(1), list: ok([note(1)]) });
    const html = await render();
    expect(html).toContain("Taylor assigned you Lead 1");
    expect(html).toMatch(new RegExp(`href="/dashboard/leads/${LEAD}/?"`));
    expect(html).toContain("1 h ago");
    expect(html).toContain('aria-label="Unread"');
    expect(html).toContain("Mark all read");
    expect(html).toMatch(/href="\/dashboard\/notifications\/?"/);
    expect(html).toContain("See all notifications");
  });

  it("renders a row with no link as a button that still opens", async () => {
    loadBell.mockResolvedValue({ count: ok(1), list: ok([note(1, { lead_id: null })]) });
    const html = await render();
    expect(html).toMatch(/<button type="button" class="lx-notif-row"/);
  });

  it("draws read rows without the dot and offers Mark all read only when something is unread", async () => {
    loadBell.mockResolvedValue({ count: ok(0), list: ok([note(1, { read_at: new Date(NOW).toISOString() })]) });
    const html = await render();
    expect(html).toContain("Lead 1");
    expect(html).not.toContain('aria-label="Unread"');
    expect(html).not.toContain("Mark all read");
  });
});

describe("loadBell (core)", () => {
  it("turns a failed read into unavailable, never 0 or []", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/notifications");
    const failing = () => {
      throw new Error("db down");
    };
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ from: failing }) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn() }));
    const { loadBell: real } = await vi.importActual<typeof import("@/lib/notifications/core")>("@/lib/notifications/core");
    const out = await real();
    expect(out).toEqual({ count: { status: "unavailable" }, list: { status: "unavailable" } });
  });
});

describe("the bell is wired into the layout with a minimal edit (D1)", () => {
  it("adds one import and one element", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(src).toContain('import { NotificationBell } from "@/components/notifications/NotificationBell";');
    expect(src.match(/<NotificationBell \/>/g)).toHaveLength(1);
    expect(src.indexOf("<NotificationBell />")).toBeLessThan(src.indexOf("<AccountMenu"));
  });
});
