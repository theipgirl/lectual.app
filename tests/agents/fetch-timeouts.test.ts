import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, PROVIDER_FETCH_TIMEOUT_MS, QUEUE_API_TIMEOUT_MS, withTimeout } from "@/lib/http/timeout";
import { listDraftSummaries, createMailboxDraft } from "@/lib/mailbox/drafts";

/** Every outbound call an agent makes has a deadline (src/lib/http/timeout.ts). */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("adds a signal that aborts after the deadline", async () => {
    // AbortSignal.timeout runs on Node's own timer, which fake timers don't reach: a short real wait.
    const init = withTimeout({ method: "GET" }, 20);
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(init.signal!.aborted).toBe(true);
  });

  it("keeps the caller's own signal: whichever fires first aborts the call", () => {
    const caller = new AbortController();
    const init = withTimeout({ signal: caller.signal }, 60_000);
    expect(init.signal!.aborted).toBe(false);
    caller.abort();
    expect(init.signal!.aborted).toBe(true);
  });

  it("fetchWithTimeout passes a signal on every call", async () => {
    const seen: RequestInit[] = [];
    const f = fetchWithTimeout((async (_u: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response("{}");
    }) as typeof fetch, 5_000);
    await f("https://example.test/");
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the Graph calls the inbox summary makes", () => {
  it("reading the Drafts folder and creating a draft both carry a deadline", async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response(JSON.stringify({ value: [], id: "d1" }), { status: 200 });
    }) as typeof fetch;
    await listDraftSummaries({ accessToken: "t", fetchImpl });
    await createMailboxDraft("microsoft", { accessToken: "t", draft: { to: "a@b.example", subject: "Re: x", body: "hi" }, fetchImpl });
    expect(seen).toHaveLength(2);
    for (const init of seen) expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(PROVIDER_FETCH_TIMEOUT_MS).toBeLessThan(120_000);
  });
});

describe("the approval-queue API", () => {
  it("listQueue (the morning brief's pending read) carries a deadline", async () => {
    vi.resetModules();
    process.env.QUEUE_API_URL = "https://queue.example.test";
    process.env.DASHBOARD_API_TOKEN = "tok";
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        seen.push(init ?? {});
        return new Response(JSON.stringify({ rows: [] }), { status: 200 });
      }),
    );
    const { listQueue } = await import("@/lib/queue/api");
    expect(await listQueue("firm-key", "pending")).toEqual([]);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(QUEUE_API_TIMEOUT_MS).toBeLessThan(60_000);
    delete process.env.QUEUE_API_URL;
    delete process.env.DASHBOARD_API_TOKEN;
  });
});
