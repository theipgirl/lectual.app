import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { gate, mockFirm, mockSdk, parseBody, textMessage } from "./helpers";
import { fakeScoped, healthyDb, type Stmt, type StmtHandler } from "./fake-scoped";

/** C3: the route saves the question and the FINAL answer, after `final`, and never lets saving change the stream. */

function post(body: unknown) {
  return new NextRequest("http://localhost/api/matters-chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function setup(handler: StmtHandler, scopedThrows = false) {
  const db = fakeScoped(handler);
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => {
      if (scopedThrows) throw new Error("no request scope");
      return db.client;
    }),
  }));
  return db;
}
const load = async () => (await import("@/app/api/matters-chat/route")).POST;
const inserts = (log: Stmt[], table?: string) => log.filter((s) => s.action === "insert" && (!table || s.table === table));

beforeEach(() => {
  vi.resetModules();
  process.env.ANTHROPIC_API_KEY = "test-key";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("saving after final", () => {
  it("no message is inserted until `final` has been sent, and the saved events follow it", async () => {
    mockFirm();
    mockSdk([{ deltas: ["Hel", "lo"], message: textMessage("Hello there.") }]);
    const held = gate();
    const { log } = setup((s) => {
      if (s.table === "copilot_conversation" && s.action === "insert") return held.promise.then(() => ({ data: [{ id: "conv-1" }], error: null }));
      return healthyDb()(s);
    });
    const res = await (await load())(post({ question: "Say hello" }));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let seen = "";
    while (!seen.includes("event: final")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
    // `final` is already on the wire while the first save statement is still held open.
    expect(parseBody(seen).at(-1)).toMatchObject({ event: "final", data: { answer: "Hello there." } });
    expect(inserts(log, "copilot_message")).toHaveLength(0);

    held.release();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += dec.decode(value);
    }
    const events = parseBody(seen + rest, { keepSaveEvents: true });
    expect(events.at(-1)).toEqual({ event: "saved", data: { conversation_id: "conv-1" } });
    const msgs = inserts(log, "copilot_message");
    expect(msgs.map((m) => [m.values?.role, m.values?.content])).toEqual([
      ["user", "Say hello"],
      ["assistant", "Hello there."],
    ]);
    // Final text only: never the streamed deltas, never a user id, the firm from the session.
    for (const m of msgs) {
      expect(Object.keys(m.values ?? {})).not.toContain("user_id");
      expect(m.values?.org_id).toBeTruthy();
      expect(m.values?.conversation_id).toBe("conv-1");
    }
    expect(inserts(log, "copilot_conversation")[0].values).toMatchObject({ title: "Say hello" });
  });

  it("continues a chat the caller can see: no new conversation, the id comes back", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("Again.") }]);
    const existing = { "11111111-1111-4111-8111-111111111111": { id: "11111111-1111-4111-8111-111111111111", title: "T", updated_at: "2026-10-22T00:00:00Z" } };
    const { log } = setup(healthyDb({ existing }));
    const res = await (await load())(post({ question: "More", conversationId: "11111111-1111-4111-8111-111111111111" }));
    const events = parseBody(await res.text(), { keepSaveEvents: true });
    expect(events.at(-1)).toEqual({ event: "saved", data: { conversation_id: "11111111-1111-4111-8111-111111111111" } });
    expect(inserts(log, "copilot_conversation")).toHaveLength(0);
    expect(inserts(log, "copilot_message")).toHaveLength(2);
    expect(log.some((s) => s.action === "update" && s.table === "copilot_conversation" && Object.keys(s.values ?? {}).join() === "updated_at")).toBe(true);
  });

  it("a conversation id the caller cannot see starts a new saved chat and reveals nothing about the other", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("Fine.") }]);
    const { log } = setup(healthyDb());
    const res = await (await load())(post({ question: "Q", conversationId: "22222222-2222-4222-8222-222222222222" }));
    const text = await res.text();
    expect(parseBody(text, { keepSaveEvents: true }).at(-1)).toEqual({ event: "saved", data: { conversation_id: "conv-new-1" } });
    expect(inserts(log, "copilot_conversation")).toHaveLength(1);
    expect(inserts(log, "copilot_message").every((m) => m.values?.conversation_id === "conv-new-1")).toBe(true);
  });

  it("a failing insert still ends the stream with the same final, then save_failed; the question is taken back out", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("The answer.") }]);
    let messageInserts = 0;
    const { log } = setup((s) => {
      if (s.table === "copilot_message" && s.action === "insert" && (messageInserts += 1) === 2) return { data: null, error: { code: "XX000", message: "boom" } };
      return healthyDb()(s);
    });
    const res = await (await load())(post({ question: "Q" }));
    const events = parseBody(await res.text(), { keepSaveEvents: true });
    expect(events.map((e) => e.event)).toEqual(["final", "save_failed"]);
    expect(events[0]).toMatchObject({ data: { answer: "The answer." } });
    // No orphan: the new chat (and with it the question) was removed.
    expect(log.some((s) => s.action === "delete" && s.table === "copilot_conversation")).toBe(true);
  });

  it("with the tables missing the chat still answers; saving is skipped with save_failed", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("Ok.") }]);
    setup(() => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }));
    const res = await (await load())(post({ question: "Q" }));
    const events = parseBody(await res.text(), { keepSaveEvents: true });
    expect(events.map((e) => e.event)).toEqual(["final", "save_failed"]);
  });

  it("a scoped client that cannot be built is save_failed, not a broken stream", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("Ok.") }]);
    setup(() => undefined, true);
    const events = parseBody(await (await (await load())(post({ question: "Q" }))).text(), { keepSaveEvents: true });
    expect(events.map((e) => e.event)).toEqual(["final", "save_failed"]);
  });

  it("a stream that ends in an error saves nothing", async () => {
    mockFirm();
    mockSdk([{ deltas: ["Part"], fail: new Error("gateway exploded") }]);
    const { log } = setup(healthyDb());
    const events = parseBody(await (await (await load())(post({ question: "Q" }))).text(), { keepSaveEvents: true });
    expect(events.at(-1)?.event).toBe("error");
    expect(log).toHaveLength(0);
  });

  it("content over 40,000 characters is cut before the insert", async () => {
    mockFirm();
    mockSdk([{ message: textMessage("z".repeat(45_000)) }]);
    const { log } = setup(healthyDb());
    await (await (await load())(post({ question: "Q" }))).text();
    const assistant = inserts(log, "copilot_message").find((m) => m.values?.role === "assistant");
    expect((assistant?.values?.content as string).length).toBe(40_000);
  });

  it("the refusals before the stream are unchanged and write nothing", async () => {
    const { log } = setup(healthyDb());
    mockFirm({ session: { kind: "signed-out", redirectTo: "/sign-in/" } });
    mockSdk([{ message: textMessage("x") }]);
    const POST = await load();
    expect((await POST(post({ question: "Q" }))).status).toBe(401);
    expect((await POST(post({ question: "" }))).status).toBe(422);
    expect((await POST(post({ question: "Q", conversationId: "not-a-uuid" }))).status).toBe(422);
    expect(log).toHaveLength(0);
  });
});
