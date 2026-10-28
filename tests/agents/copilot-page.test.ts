import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /dashboard/copilot/ — the AI copilot page. Guards the two properties that
 * matter most on the highest-liability surface in the product: the page
 * tells the truth about whether the copilot is configured (never shows a
 * chat box that can only fail on the first question), and nothing on it is
 * fabricated — every answer the chat panel can show comes from a real
 * POST /api/matters-chat call, never from data baked into the page.
 */

/**
 * The page is an async server component now (it reads the session, the firm
 * time zone and the landing numbers), so the harness awaits it and mocks those
 * reads. The assertions below are the original ones, unchanged.
 */
async function render() {
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({ kind: "ok", user: { id: "u-1", email: "t@example.com", user_metadata: {} }, org: { id: "o-1" } })),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
  vi.doMock("@/lib/matters", () => ({
    listMatters: vi.fn(async () => []),
    listUpcomingDeadlines: vi.fn(async () => []),
    summarizeDocket: () => ({ open: 0, stalled: [] }),
  }));
  vi.doMock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items: [] })) }));
  const { default: CopilotPage } = await import("@/app/dashboard/copilot/page");
  return renderToStaticMarkup(await CopilotPage());
}

describe("CopilotPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("says plainly when no AI provider is configured, and renders no chat box", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => false }));
    vi.doMock("next/navigation", () => ({ usePathname: () => "/dashboard/copilot/", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
    const html = await render();

    expect(html).toContain("isn&#x27;t switched on for your firm yet");
    expect(html).not.toContain("cpl-composer");
  });

  it("renders the chat panel with suggested prompts when configured", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    vi.doMock("next/navigation", () => ({ usePathname: () => "/dashboard/copilot/", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
    const html = await render();

    expect(html).toContain("Ask Copilot");
    expect(html).toContain("What&#x27;s due in the next two weeks?");
  });

  it("renders no fabricated matter, statistic, or sample conversation", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    vi.doMock("next/navigation", () => ({ usePathname: () => "/dashboard/copilot/", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
    const html = await render();

    // Invented matter references or model statistics baked into the page.
    expect(html).not.toMatch(/TM-\d{4}-\d{4}/);
    expect(html).not.toMatch(/\b\d{1,3}%\s*(confidence|success)/i);
    // Mock conversation furniture — this page has no canned thread.
    expect(html).not.toMatch(/Design preview|Illustrative|sample thread/i);
  });

  it("states the UPL boundary plainly", async () => {
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
    vi.doMock("next/navigation", () => ({ usePathname: () => "/dashboard/copilot/", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
    const html = await render();

    expect(html).toMatch(/never gives legal analysis/i);
    expect(html).toMatch(/attorney of record/i);
  });
});
