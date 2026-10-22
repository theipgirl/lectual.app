import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeScoped, healthyDb, type StmtHandler } from "./fake-scoped";

/**
 * C5/C6: /dashboard/copilot/ with the saved chats beside the chat. The title block (IP.OS label, AI copilot
 * heading) is gone; the history list has its three states; a past chat opens with its messages and citations.
 */

const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");
const C1 = "44444444-4444-4444-8444-444444444444";

beforeEach(() => vi.resetModules());
afterEach(() => vi.useRealTimers());

async function render(opts: { handler?: StmtHandler; configured?: boolean; scopedThrows?: boolean; c?: string } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => opts.configured ?? true }));
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
  vi.doMock("next/cache", () => ({ refresh: vi.fn() }));
  const db = fakeScoped(opts.handler ?? healthyDb());
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => {
      if (opts.scopedThrows) throw new Error("no request scope");
      return db.client;
    }),
  }));
  const { default: Page } = await import("@/app/dashboard/copilot/page");
  return text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve(opts.c ? { c: opts.c } : {}) })));
}

const existing = {
  [C1]: { id: C1, title: "What is due this week?", updated_at: "2026-10-22T10:00:00Z" },
  "55555555-5555-4555-8555-555555555555": { id: "55555555-5555-4555-8555-555555555555", title: "Stalled matters", updated_at: "2026-10-20T10:00:00Z" },
};

describe("C6: the page", () => {
  it("has no IP.OS label or AI copilot heading, and has the history, New chat, the approval line and the chat", async () => {
    const html = await render({ handler: healthyDb({ existing }) });
    expect(html).not.toContain("IP.OS");
    expect(html).not.toContain("AI copilot");
    expect(html).toContain("Past conversations");
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain("Nothing sends without your approval.");
    expect(html).toContain("Ask the copilot");
    expect(html).toContain("What is due this week?");
    expect(html).toContain("Stalled matters");
    expect(html).toContain(`aria-label="Delete chat: What is due this week?"`);
    expect(html).toMatch(/<nav[^>]*aria-label="Past conversations"/);
  });

  it("the sources no longer hold the strings or the removed header's markup", () => {
    for (const f of ["src/app/dashboard/copilot/page.tsx", "src/components/copilot/CopilotChat.tsx", "src/components/copilot/CopilotWorkspace.tsx", "src/components/copilot/ChatHistoryList.tsx", "src/components/copilot/copilot.css", "src/app/dashboard/copilot/copilot.css"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("IP.OS");
      expect(src, f).not.toContain("AI copilot");
    }
    expect(readFileSync("src/app/dashboard/copilot/page.tsx", "utf8")).not.toMatch(/lx-page-head|lx-sub|lx-h1/);
  });

  it("with AI not configured it draws the plain not-configured state and no chat", async () => {
    const html = await render({ configured: false });
    expect(html).toContain("isn't configured for this deployment yet");
    expect(html).not.toContain("cpl-composer");
    expect(html).not.toContain("Past conversations");
  });

  it("the new styles use the app's tokens, with no hard-coded colours", () => {
    const css = readFileSync("src/components/copilot/copilot.css", "utf8");
    const mine = css.slice(css.indexOf("saved chats (lectual 0099)"));
    expect(mine.length).toBeGreaterThan(200);
    expect(mine).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("the quiet save line is plain text and the error sentences keep role=alert", () => {
    const chat = readFileSync("src/components/copilot/CopilotChat.tsx", "utf8");
    expect(chat).toMatch(/<p className="cpl-status cpl-save-note">\{SAVE_FAILED_NOTE\}<\/p>/);
    expect(chat).toContain('role="alert"');
  });
});

describe("C5: the three states of the history list", () => {
  it("empty and ok says 'No saved chats yet.'", async () => {
    expect(await render()).toContain("No saved chats yet.");
  });

  it("table missing says saved chats are not available until the database update, and New chat still shows", async () => {
    const html = await render({ handler: () => ({ data: null, error: { code: "42P01", message: "x" } }) });
    expect(html).toContain("Saved chats aren't available until the database update.");
    expect(html).not.toContain("No saved chats yet.");
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain("Ask the copilot");
  });

  it("an unreadable list says it couldn't be loaded (never 'No saved chats yet.'), and New chat still works", async () => {
    for (const html of [
      await render({ handler: () => ({ data: null, error: { code: "XX000", message: "x" } }) }),
      await render({ scopedThrows: true }),
    ]) {
      expect(html).toContain("Saved chats couldn't be loaded.");
      expect(html).not.toContain("No saved chats yet.");
      expect(html).toContain('aria-label="New chat"');
      expect(html).toContain("Ask the copilot");
    }
  });
});

describe("opening a past chat", () => {
  const messages = {
    [C1]: [
      { id: "m1", role: "user", content: "What is due this week?", citations: [] },
      { id: "m2", role: "assistant", content: "Two deadlines are due.", citations: [{ type: "matter", id: "mm", label: "TM-1 — AURELIA", href: "/dashboard/matters/mm" }] },
    ],
  };

  it("draws the saved messages and their citations, and marks the chat open", async () => {
    const html = await render({ c: C1, handler: healthyDb({ existing, messages }) });
    expect(html).toContain("Two deadlines are due.");
    expect(html).toContain("TM-1 — AURELIA");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("New chat");
  });

  it("a chat id that is not there or is not an id gives a short note and a fresh chat", async () => {
    const html = await render({ c: "66666666-6666-4666-8666-666666666666", handler: healthyDb({ existing }) });
    expect(html).toContain("That saved chat couldn't be found.");
    expect(html).toContain("Ask the copilot");
    expect(html).not.toContain("Two deadlines are due.");
    expect(await render({ c: "not-an-id", handler: healthyDb({ existing }) })).not.toContain("Two deadlines");
  });
});
