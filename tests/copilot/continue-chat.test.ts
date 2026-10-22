import { describe, expect, it, vi } from "vitest";
import { buildRequestBody, historyFromExchanges, type Exchange } from "@/lib/copilot/client";
import { createChatController } from "@/lib/copilot/controller";
import { exchangesFromMessages } from "@/lib/copilot/history-pure";
import { HISTORY_MAX_TURNS } from "@/lib/copilot/history";
import { encodeSse } from "@/lib/copilot/sse";

/** C4: a re-opened chat sends its last turns as `history`, and the next question continues the same conversation. */

const saved = Array.from({ length: 8 }, (_, i) => [
  { id: `q${i}`, role: "user" as const, content: `Question ${i}`, citations: [] },
  { id: `a${i}`, role: "assistant" as const, content: `Answer ${i}`, citations: [] },
]).flat();

function sseResponse(events: Parameters<typeof encodeSse>[0][]) {
  return new Response(events.map(encodeSse).join(""), { status: 200 });
}

describe("continuing a saved chat", () => {
  it("the request carries the last turns of the re-opened chat, within the existing limit, and the conversation id", () => {
    const body = buildRequestBody({ question: "Next?", exchanges: exchangesFromMessages(saved), conversationId: "conv-9" });
    expect(body.conversationId).toBe("conv-9");
    expect(body.history).toHaveLength(HISTORY_MAX_TURNS);
    expect(body.history?.at(-1)).toEqual({ role: "assistant", content: "Answer 7" });
    expect(body.history?.[0]).toEqual({ role: "user", content: "Question 3" });
    expect(historyFromExchanges(exchangesFromMessages(saved))).toEqual(body.history);
  });

  it("a new chat sends no conversation id", () => {
    expect(buildRequestBody({ question: "Hi", exchanges: [] })).toEqual({ question: "Hi" });
  });

  it("the controller sends the id, learns the saved id from the stream, and the next question uses it", async () => {
    let exchanges: Exchange[] = [];
    let conversationId: string | null = null;
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sseResponse([
        { event: "final", data: { answer: "An answer.", citations: [], declined: false, readFailed: false } },
        { event: "saved", data: { conversation_id: "conv-1" } },
      ]);
    }) as unknown as typeof fetch;
    const save = vi.fn();
    const controller = createChatController({
      fetchImpl,
      getExchanges: () => exchanges,
      setExchanges: (u) => {
        exchanges = u(exchanges);
      },
      getConversationId: () => conversationId,
      onSaved: (id) => {
        conversationId = id;
        save(id);
      },
      newId: (() => {
        let n = 0;
        return () => `ex-${(n += 1)}`;
      })(),
    });
    await controller.ask("First question");
    await controller.ask("Second question");
    expect(bodies[0].conversationId).toBeUndefined();
    expect(bodies[1].conversationId).toBe("conv-1");
    expect(bodies[1].history).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "An answer." },
    ]);
    expect(save).toHaveBeenCalledWith("conv-1");
    expect(exchanges.map((e) => e.status)).toEqual(["done", "done"]);
  });

  it("save_failed reaches the caller and does not touch the answer", async () => {
    let exchanges: Exchange[] = [];
    const onSaveFailed = vi.fn();
    const fetchImpl = vi.fn(async () =>
      sseResponse([{ event: "final", data: { answer: "Still here.", citations: [], declined: false, readFailed: false } }, { event: "save_failed", data: {} }]),
    ) as unknown as typeof fetch;
    await createChatController({ fetchImpl, getExchanges: () => exchanges, setExchanges: (u) => (exchanges = u(exchanges)), onSaveFailed, newId: () => "x" }).ask("Q");
    expect(onSaveFailed).toHaveBeenCalledTimes(1);
    expect(exchanges[0]).toMatchObject({ status: "done", answer: "Still here." });
  });
});
