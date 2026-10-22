import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  saveMessage,
} from "@/lib/copilot/history-store";
import {
  clipContent,
  exchangesFromMessages,
  MESSAGE_MAX_CHARS,
  nextDeleteStep,
  relativeDate,
  storableCitations,
  titleFromQuestion,
} from "@/lib/copilot/history-pure";
import { fakeScoped, healthyDb, type StmtHandler } from "./fake-scoped";

const as = (c: unknown) => c as SupabaseClient;
const cite = (n: number) => ({ type: "matter" as const, id: `m-${n}`, label: `TM-${n}`, href: `/dashboard/matters/m-${n}` });

describe("C1: the store", () => {
  it("lists newest updated first, with title and date, and never names a user", async () => {
    const rows = [
      { id: "b", title: "Second", updated_at: "2026-10-22T10:00:00Z" },
      { id: "a", title: "First", updated_at: "2026-10-20T10:00:00Z" },
    ];
    const { client, log } = fakeScoped(() => ({ data: rows, error: null }));
    const res = await listConversations(as(client));
    expect(res).toEqual({
      status: "ok",
      conversations: [
        { id: "b", title: "Second", updatedAt: "2026-10-22T10:00:00Z" },
        { id: "a", title: "First", updatedAt: "2026-10-20T10:00:00Z" },
      ],
    });
    expect(log[0]).toMatchObject({ table: "copilot_conversation", order: [{ column: "updated_at", ascending: false }] });
    expect(log[0].filters).toEqual([]);
  });

  it("titles are the first question clipped to 80 characters (80 stays, 81 gets an ellipsis)", () => {
    const eighty = "x".repeat(80);
    expect(titleFromQuestion(eighty)).toBe(eighty);
    const cut = titleFromQuestion("x".repeat(81));
    expect(cut).toHaveLength(80);
    expect(cut.endsWith("…")).toBe(true);
    expect(titleFromQuestion("  what's\n due   soon? ")).toBe("what's due soon?");
    expect(titleFromQuestion("   ")).toBe("Untitled chat");
  });

  it("createConversation and message inserts never include user_id, and create the title from the question", async () => {
    const { client, log } = fakeScoped(healthyDb());
    const made = await createConversation(as(client), { orgId: "org-1", firstQuestion: "What is due this week?" });
    expect(made).toEqual({ status: "ok", id: "conv-new-1" });
    expect(await saveMessage(as(client), { orgId: "org-1", conversationId: "conv-new-1", id: "m1", role: "user", content: "What is due this week?" })).toEqual({ status: "ok" });
    const inserts = log.filter((s) => s.action === "insert");
    expect(inserts).toHaveLength(2);
    for (const i of inserts) expect(Object.keys(i.values ?? {})).not.toContain("user_id");
    expect(inserts[0].values).toEqual({ org_id: "org-1", title: "What is due this week?" });
    expect(readFileSync("src/lib/copilot/history-store.ts", "utf8")).not.toMatch(/user_id/);
  });

  it("one insert per message; citations are stored as an array; content over 40,000 characters is cut, not refused", async () => {
    const { client, log } = fakeScoped(healthyDb());
    await saveMessage(as(client), { orgId: "o", conversationId: "c", id: "m2", role: "assistant", content: "y".repeat(MESSAGE_MAX_CHARS + 500), citations: [cite(1), cite(2)] });
    const ins = log.filter((s) => s.table === "copilot_message");
    expect(ins).toHaveLength(1);
    expect(Array.isArray(ins[0].values?.citations)).toBe(true);
    expect(ins[0].values?.citations).toHaveLength(2);
    expect((ins[0].values?.content as string).length).toBe(MESSAGE_MAX_CHARS);
    expect(clipContent("short")).toBe("short");
    await saveMessage(as(client), { orgId: "o", conversationId: "c", id: "m3", role: "user", content: "q" });
    expect(log.filter((s) => s.table === "copilot_message").at(-1)?.values?.citations).toEqual([]);
  });

  it("citations stay under the column's size limit, whole citations only", () => {
    const many = Array.from({ length: 2_000 }, (_, i) => cite(i));
    const kept = storableCitations(many);
    expect(kept.length).toBeLessThan(many.length);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(60_000);
    expect(kept[0]).toEqual(many[0]);
  });

  it("deleteConversation deletes by id only", async () => {
    const { client, log } = fakeScoped(healthyDb());
    expect(await deleteConversation(as(client), "conv-1")).toEqual({ status: "ok", deleted: true });
    expect(log[0]).toMatchObject({ table: "copilot_conversation", action: "delete", filters: [{ op: "eq", column: "id", value: "conv-1" }] });
  });
});

describe("C2: three-state reads", () => {
  it("an empty list is ok only when the read succeeded", async () => {
    expect(await listConversations(as(fakeScoped(() => ({ data: [], error: null })).client))).toEqual({ status: "ok", conversations: [] });
  });

  it.each([["42P01"], ["PGRST205"]])("a missing table (%s) is not-set-up, never an empty list", async (code) => {
    const handler: StmtHandler = () => ({ data: null, error: { code, message: "relation does not exist" } });
    expect(await listConversations(as(fakeScoped(handler).client))).toEqual({ status: "not-set-up" });
    expect(await loadConversation(as(fakeScoped(handler).client), "x")).toEqual({ status: "not-set-up" });
    expect(await createConversation(as(fakeScoped(handler).client), { orgId: "o", firstQuestion: "q" })).toEqual({ status: "not-set-up" });
  });

  it("any other error or a thrown client is unavailable", async () => {
    expect(await listConversations(as(fakeScoped(() => ({ data: null, error: { code: "XX000", message: "boom" } })).client))).toEqual({ status: "unavailable" });
    expect(await listConversations(as({ from: () => { throw new Error("down"); } }))).toEqual({ status: "unavailable" });
    expect(await loadConversation(as({ from: () => { throw new Error("down"); } }), "x")).toEqual({ status: "unavailable" });
  });

  it("the store, the save step and the actions import no service-role client", () => {
    for (const f of ["src/lib/copilot/history-store.ts", "src/lib/copilot/save-turn.ts", "src/app/dashboard/copilot/actions.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/db\/admin|getAdminClient|SERVICE_ROLE/);
    }
  });
});

describe("C4: re-opening a chat", () => {
  it("loadConversation returns messages oldest first with citations, and none for a chat that is not there", async () => {
    const existing = { c1: { id: "c1", title: "T", updated_at: "2026-10-22T10:00:00Z" } };
    const messages = {
      c1: [
        { id: "m1", role: "user", content: "Q1", citations: [] },
        { id: "m2", role: "assistant", content: "A1", citations: [cite(1), { bogus: true }] },
      ],
    };
    const { client, log } = fakeScoped(healthyDb({ existing, messages }));
    const res = await loadConversation(as(client), "c1");
    expect(res).toMatchObject({ status: "ok", conversation: { id: "c1", title: "T" } });
    if (res.status !== "ok") throw new Error("unreachable");
    expect(res.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.messages[1].citations).toEqual([cite(1)]);
    expect(log.find((s) => s.table === "copilot_message")?.order[0]).toEqual({ column: "created_at", ascending: true });
    expect(await loadConversation(as(fakeScoped(healthyDb()).client), "nope")).toEqual({ status: "none" });
  });

  it("messages become done exchanges; an unanswered question is not drawn", () => {
    const ex = exchangesFromMessages([
      { id: "m1", role: "user", content: "Q1", citations: [] },
      { id: "m2", role: "assistant", content: "A1", citations: [cite(1)] },
      { id: "m3", role: "user", content: "Q2 never answered", citations: [] },
    ]);
    expect(ex).toEqual([{ id: "m1", question: "Q1", status: "done", answer: "A1", citations: [cite(1)], declined: false, readFailed: false }]);
  });
});

describe("dates and the delete confirmation", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  it("relative dates", () => {
    expect(relativeDate("2026-10-22T11:59:40Z", now)).toBe("Just now");
    expect(relativeDate("2026-10-22T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeDate("2026-10-22T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeDate("2026-10-21T09:00:00Z", now)).toBe("Yesterday");
    expect(relativeDate("2026-10-18T12:00:00Z", now)).toBe("4 days ago");
    expect(relativeDate("2026-09-03T12:00:00Z", now)).toBe("Sep 3");
    expect(relativeDate("2025-09-03T12:00:00Z", now)).toBe("Sep 3, 2025");
    expect(relativeDate("not a date", now)).toBe("");
  });

  it("C7: delete asks first; only confirming from the asking step runs it", () => {
    expect(nextDeleteStep("idle", "ask")).toEqual({ step: "confirming", run: false });
    expect(nextDeleteStep("confirming", "cancel")).toEqual({ step: "idle", run: false });
    expect(nextDeleteStep("idle", "confirm")).toEqual({ step: "idle", run: false });
    expect(nextDeleteStep("confirming", "confirm")).toEqual({ step: "idle", run: true });
  });
});
