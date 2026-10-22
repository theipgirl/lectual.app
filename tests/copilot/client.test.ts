import { describe, expect, it, vi } from "vitest";
import { COPILOT_CUT_OFF, COPILOT_UNREACHABLE, askCopilot, buildRequestBody, historyFromExchanges, reduceEvent, type Exchange } from "@/lib/copilot/client";
import { createChatController } from "@/lib/copilot/controller";
import { encodeSse, type CopilotStreamEvent } from "@/lib/copilot/sse";
import { SUGGESTED_PROMPTS } from "@/components/copilot/CopilotChat";
import { LEAD_ID, MATTER_ID } from "./helpers";

const enc = new TextEncoder();

/** A fetch that answers with the given text, delivered in the given chunks. */
function sseFetch(chunks: string[], init: { status?: number } = {}) {
  return vi.fn<typeof fetch>(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    return new Response(body, { status: init.status ?? 200, headers: { "Content-Type": "text/event-stream" } });
  });
}

const frames = (...events: CopilotStreamEvent[]) => events.map(encodeSse).join("");
const FINAL: CopilotStreamEvent = {
  event: "final",
  data: {
    answer: "AURELIA is in Publication.",
    citations: [{ type: "matter", id: MATTER_ID, label: "TM-2026-0031 — AURELIA", href: `/dashboard/matters/${MATTER_ID}` }],
    declined: false,
    readFailed: false,
  },
};

function harness(fetchImpl: typeof fetch, pathname?: string) {
  let exchanges: Exchange[] = [];
  const controller = createChatController({
    fetchImpl,
    getExchanges: () => exchanges,
    setExchanges: (update) => {
      exchanges = update(exchanges);
    },
    getPathname: () => pathname,
    newId: (() => {
      let n = 0;
      return () => `ex-${++n}`;
    })(),
  });
  return { controller, get exchanges() { return exchanges; } };
}

describe("ask and stream", () => {
  it("ends with the streamed text replaced by the final answer, the cites kept, and the composer free again", async () => {
    const whole = frames(
      { event: "tool", data: { name: "search_matters", label: "Reading matters", status: "running" } },
      { event: "delta", data: { text: "Let me check. " } },
      { event: "tool", data: { name: "search_matters", label: "Reading matters", status: "done" } },
      { event: "delta", data: { text: "AURELIA is in " } },
      FINAL,
    );
    // Split mid-frame, so the parser has to stitch frames back together.
    const cut = 40;
    const fetchImpl = sseFetch([whole.slice(0, cut), whole.slice(cut, cut + 70), whole.slice(cut + 70)]);
    const h = harness(fetchImpl as never);

    expect(await h.controller.ask("status of AURELIA")).toBe(true);

    expect(h.exchanges).toHaveLength(1);
    expect(h.exchanges[0]).toMatchObject({
      id: "ex-1",
      question: "status of AURELIA",
      status: "done",
      answer: "AURELIA is in Publication.",
      streamed: undefined,
      tools: [],
      declined: false,
      readFailed: false,
    });
    expect(h.exchanges[0].citations?.[0].href).toBe(`/dashboard/matters/${MATTER_ID}`);
    // Free again: a second ask goes through.
    expect(await h.controller.ask("and now?")).toBe(true);
  });

  it("shows text and tool status while the stream is still open", () => {
    let ex: Exchange = { id: "1", question: "q", status: "pending" };
    ex = reduceEvent(ex, { event: "tool", data: { name: "x", label: "Reading matters", status: "running" } });
    ex = reduceEvent(ex, { event: "tool", data: { name: "y", label: "Checking deadlines", status: "running" } });
    ex = reduceEvent(ex, { event: "delta", data: { text: "Hel" } });
    ex = reduceEvent(ex, { event: "delta", data: { text: "lo" } });
    expect(ex).toMatchObject({ status: "pending", streamed: "Hello", tools: ["Reading matters", "Checking deadlines"] });
    ex = reduceEvent(ex, { event: "tool", data: { name: "x", label: "Reading matters", status: "done" } });
    expect(ex.tools).toEqual(["Checking deadlines"]);
  });

  it("sends the first exchange as history with the second question, and nothing as history with the first", async () => {
    const fetchImpl = sseFetch([frames(FINAL)]);
    const h = harness(fetchImpl as never);
    await h.controller.ask("first question");
    await h.controller.ask("second question");

    const sent = fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(sent[0]).toEqual({ question: "first question" });
    expect(sent[1]).toEqual({
      question: "second question",
      history: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "AURELIA is in Publication." },
      ],
    });
  });

  it("New thread clears the exchanges, and the next request carries no history", async () => {
    const fetchImpl = sseFetch([frames(FINAL)]);
    const h = harness(fetchImpl as never);
    await h.controller.ask("first question");
    h.controller.newThread();
    expect(h.exchanges).toEqual([]);
    await h.controller.ask("fresh start");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({ question: "fresh start" });
  });

  it("does not send an empty or whitespace question", async () => {
    const fetchImpl = sseFetch([frames(FINAL)]);
    const h = harness(fetchImpl as never);
    expect(await h.controller.ask("   ")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.exchanges).toEqual([]);
  });
});

describe("chips", () => {
  it("there are exactly three, including the two-weeks one", () => {
    expect(SUGGESTED_PROMPTS).toHaveLength(3);
    expect(SUGGESTED_PROMPTS).toContain("What's due in the next two weeks?");
  });

  it.each(SUGGESTED_PROMPTS)("asking with the chip %j sends exactly that text as the question", async (chip) => {
    const fetchImpl = sseFetch([frames(FINAL)]);
    const h = harness(fetchImpl as never);
    await h.controller.ask(chip);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).question).toBe(chip);
  });
});

describe("what the request carries", () => {
  it("the drawer on a lead page sends the pathname and the lead id", async () => {
    const fetchImpl = sseFetch([frames(FINAL)]);
    const h = harness(fetchImpl as never, `/dashboard/leads/${LEAD_ID}`);
    await h.controller.ask("what is this lead?");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).context).toEqual({ pathname: `/dashboard/leads/${LEAD_ID}`, leadId: LEAD_ID });
  });

  it("the drawer on a matter page sends the matter id; on the lead list, no id", () => {
    expect(buildRequestBody({ question: "q", exchanges: [], pathname: `/dashboard/matters/${MATTER_ID}` }).context).toEqual({
      pathname: `/dashboard/matters/${MATTER_ID}`,
      matterId: MATTER_ID,
    });
    expect(buildRequestBody({ question: "q", exchanges: [], pathname: "/dashboard/leads" }).context).toEqual({ pathname: "/dashboard/leads" });
  });

  it("the full page sends no context", () => {
    expect(buildRequestBody({ question: "q", exchanges: [] })).toEqual({ question: "q" });
  });

  it("history holds only finished exchanges, at most the last 10 turns", () => {
    const done = (n: number): Exchange => ({ id: `${n}`, question: `q${n}`, status: "done", answer: `a${n}` });
    const exchanges: Exchange[] = [
      ...Array.from({ length: 8 }, (_, i) => done(i)),
      { id: "p", question: "pending", status: "pending" },
      { id: "e", question: "failed", status: "error", error: "x" },
    ];
    const history = historyFromExchanges(exchanges);
    expect(history).toHaveLength(10);
    expect(history.at(-1)).toEqual({ role: "assistant", content: "a7" });
    expect(history.map((t) => t.content)).not.toContain("pending");
    expect(history.map((t) => t.content)).not.toContain("failed");
  });
});

describe("failures are shown, never an empty answer", () => {
  async function run(fetchImpl: typeof fetch) {
    const h = harness(fetchImpl);
    await h.controller.ask("q");
    return h.exchanges[0];
  }

  it("a stream that ends with no final is an error", async () => {
    const ex = await run(sseFetch([frames({ event: "delta", data: { text: "partial" } })]) as never);
    expect(ex).toMatchObject({ status: "error", error: COPILOT_CUT_OFF });
    expect(ex.answer).toBeUndefined();
  });

  it("a network failure is an error", async () => {
    const ex = await run(vi.fn(async () => { throw new TypeError("fetch failed"); }) as never);
    expect(ex).toMatchObject({ status: "error", error: COPILOT_UNREACHABLE });
  });

  it("a gated JSON response shows its sentence", async () => {
    const ex = await run(vi.fn(async () => Response.json({ error: "Sign in to use the copilot." }, { status: 401 })) as never);
    expect(ex).toMatchObject({ status: "error", error: "Sign in to use the copilot." });
  });

  it("a server `error` event shows its sentence, and a connection that drops mid-stream is an error", async () => {
    expect(await run(sseFetch([frames({ event: "error", data: { message: "Something went wrong answering that — try again." } })]) as never)).toMatchObject({
      status: "error",
      error: "Something went wrong answering that — try again.",
    });

    const dropping = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(frames({ event: "delta", data: { text: "x" } })));
          c.error(new Error("reset"));
        },
      });
      return new Response(body);
    });
    expect(await run(dropping as never)).toMatchObject({ status: "error", error: COPILOT_CUT_OFF });
  });

  it("askCopilot reports through onUpdate and returns", async () => {
    const updates: Array<(e: Exchange) => Exchange> = [];
    await askCopilot({ fetchImpl: sseFetch([frames(FINAL)]) as never, body: { question: "q" }, onUpdate: (u) => updates.push(u) });
    expect(updates.length).toBeGreaterThan(0);
  });
});
