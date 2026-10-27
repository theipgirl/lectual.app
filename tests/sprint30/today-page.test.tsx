import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import type { NeedsYouItem } from "@/lib/today/needs-you";

process.env.__NEXT_TRAILING_SLASH = "true";

/** Sprint 30 A, B (greeting), C, D, E (card order): Today rendered with every read faked. */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'").replaceAll("<!-- -->", "");

function item(n: number, over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return { key: `k${n}`, kind: "deadline-soon", action: `Action ${n}`, subject: `Subject ${n}`, detail: null, forYou: n % 2 === 1, href: `/dashboard/x${n}/`, cta: "Open", tone: "warn", score: 100 - n, ...over };
}

async function renderToday(opts: { items?: NeedsYouItem[]; unavailable?: string[]; metadata?: Record<string, unknown>; memberName?: string | null; now?: Date }) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(opts.now ?? new Date("2026-10-27T18:00:00Z")); // 2pm in New York
  const items = opts.items ?? [];
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({
      kind: "ok",
      role: "owner",
      org: { id: "org-1", name: "Pearl Law Firm", slug: "pearl", modules: [] },
      user: { id: "u1", email: "rebecca@pearl.example", user_metadata: opts.metadata ?? {} },
    })),
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn() }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/pipeline", () => ({ listLeads: vi.fn(async () => []) }));
  vi.doMock("@/lib/matters", async (orig) => ({
    ...(await orig<typeof import("@/lib/matters")>()),
    listMatters: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    listUpcomingDeadlines: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/today/load-needs-you", () => ({
    loadOpenQuotes: vi.fn(async () => ({ quotes: [], payments: [] })),
    loadConnectionsNeedingReauth: vi.fn(async () => []),
    loadUnreviewedSubmissions: vi.fn(async () => []),
    loadDeadlinesClosedSince: vi.fn(async () => []),
  }));
  vi.doMock("@/lib/members/directory", () => ({
    listMemberDirectory: vi.fn(async () => (opts.memberName === undefined ? [] : [{ userId: "u1", email: "rebecca@pearl.example", displayName: opts.memberName, role: "owner", identified: true }])),
  }));
  vi.doMock("@/lib/today/needs-you", async (orig) => ({
    ...(await orig<typeof import("@/lib/today/needs-you")>()),
    buildNeedsYou: vi.fn(() => ({ items, unavailable: opts.unavailable ?? [] })),
  }));
  vi.doMock("@/components/setup/FinishSetupCard", () => ({ FinishSetupCard: () => null }));
  vi.doMock("@/components/onboarding/GettingStartedCard", () => ({ GettingStartedCard: () => null }));
  vi.doMock("@/components/calendar/TodayConsults", () => ({ TodayConsults: () => <section aria-label="consults-stub">Consults card</section> }));
  const { default: TodayPage } = await import("@/app/dashboard/page");
  const html = text(renderToStaticMarkup(await TodayPage()));
  vi.useRealTimers();
  return html;
}

beforeEach(() => vi.resetModules());

describe("Today header (A)", () => {
  it("starts with the h1, and repeats neither the firm name nor the date", async () => {
    const html = await renderToday({ metadata: { full_name: "Rebecca Pearl" } });
    expect(html.indexOf("<h1")).toBe(html.indexOf("<div class=\"lx-page-head\"><div style=\"flex:1;min-width:260px\">") + "<div class=\"lx-page-head\"><div style=\"flex:1;min-width:260px\">".length);
    expect(html).toContain("Good afternoon, Rebecca.");
    expect(html).not.toContain("Pearl Law Firm");
    expect(html).not.toMatch(/Tuesday|October 27/);
  });

  it("the source no longer builds a date line", () => {
    const page = fs.readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(page).not.toMatch(/dateLine|toLocaleDateString/);
    expect(page).not.toContain("session.org.name");
  });
});

describe("Today greeting and names (B)", () => {
  it("no usable name: 'Good afternoon.' plus an Add your name control", async () => {
    const html = await renderToday({});
    expect(html).toContain("Good afternoon.");
    expect(html).toContain("Add your name");
  });

  it("a name: 'Good afternoon, <First>.' and no Add your name", async () => {
    const html = await renderToday({ metadata: { full_name: "Rebecca Pearl" } });
    expect(html).toContain("Good afternoon, Rebecca.");
    expect(html).not.toContain("Add your name");
  });

  it("an email-shaped name is not a name", async () => {
    const html = await renderToday({ metadata: { full_name: "rebecca@pearl.example" } });
    expect(html).toContain("Add your name");
  });
});

describe("Needs you: top three (C)", () => {
  it("seven items: three rows outside the details, 'See all 7' holding the other four in order", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map((n) => item(n));
    const html = await renderToday({ items });
    const [before, inside] = html.split('<details class="lx-needs-more">');
    expect(before).toContain("Action 1");
    expect(before).toContain("Action 3");
    expect(before).not.toContain("Action 4");
    expect(inside).toContain("See all 7");
    const rest = [4, 5, 6, 7].map((n) => inside.indexOf(`Action ${n}`));
    expect(rest.every((i) => i > 0)).toBe(true);
    expect([...rest].sort((a, b) => a - b)).toEqual(rest);
    expect(inside).not.toContain("Action 3<");
  });

  it("three or fewer items: no details at all", async () => {
    expect(await renderToday({ items: [item(1), item(2), item(3)] })).not.toContain("<details");
  });

  it("zero items keeps the empty note; the unavailable warning still shows with items", async () => {
    const empty = await renderToday({ items: [] });
    expect(empty).toContain("Needs you");
    expect(empty).not.toContain("<details");
    const warned = await renderToday({ items: [item(1), item(2), item(3), item(4)], unavailable: ["Deadlines"] });
    expect(warned).toContain("Deadlines couldn't be read, so this list may be missing items.");
    expect(warned).toContain("See all 4");
  });

  it("NEEDS_YOU_SHOWN is 3", async () => {
    const { NEEDS_YOU_SHOWN } = await import("@/lib/today/needs-you");
    expect(NEEDS_YOU_SHOWN).toBe(3);
  });
});

describe("Next two weeks is gone (D) and consults sit above Needs you (E)", () => {
  it("is in neither the markup nor the source, and its computation is deleted", async () => {
    const html = await renderToday({ items: [item(1)] });
    expect(html).not.toContain("Next two weeks");
    const page = fs.readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(page).not.toMatch(/Next two weeks|next14|formatCivilDate|calendarNote/);
  });

  it("the Consults card comes before Needs you", async () => {
    const html = await renderToday({ items: [item(1)] });
    expect(html.indexOf("Consults card")).toBeGreaterThan(-1);
    expect(html.indexOf("Consults card")).toBeLessThan(html.indexOf('id="needs-you-h"'));
  });
});
