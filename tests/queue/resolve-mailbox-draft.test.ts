import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Pins the wire format of the resolve call's `mailbox_draft` flag (lawmatics-mcp honours it from its commit e738c24, not
 * yet deployed): snake_case, boolean `false`, sent ONLY when the caller asks to skip the queue's draft (the `pass` and
 * `self` plans, see draft-handoff-flow.test.ts) and absent otherwise.
 */
describe("resolveQueueItem: mailbox_draft", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({ env: { QUEUE_API_URL: "https://lawmatics-mcp.example.com", DASHBOARD_API_TOKEN: "t" } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  async function bodyFor(extra: { skipMailboxDraft?: boolean }) {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ status: "approved", send: "manual" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { resolveQueueItem } = await import("@/lib/queue/api");
    await resolveQueueItem({ orgKey: "k", id: "q1", action: "approve", resolvedBy: "a@example.com", ...extra });
    return JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<string, unknown>;
  }

  it("sends mailbox_draft: false (boolean, snake_case) when asked to skip the queue's draft", async () => {
    const body = await bodyFor({ skipMailboxDraft: true });
    expect(body.mailbox_draft).toBe(false);
    expect(Object.keys(body).filter((k) => /mailbox/i.test(k))).toEqual(["mailbox_draft"]);
  });

  it("omits it otherwise", async () => {
    expect("mailbox_draft" in (await bodyFor({}))).toBe(false);
    expect("mailbox_draft" in (await bodyFor({ skipMailboxDraft: false }))).toBe(false);
  });

  it("the review path sets skipMailboxDraft only for the pass and self plans", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/queue/review-core.ts", "utf8");
    expect(src).toContain('...(plan === "pass" || plan === "self" ? { skipMailboxDraft: true } : {})');
    expect(src.match(/skipMailboxDraft/g)).toHaveLength(1);
  });
});
