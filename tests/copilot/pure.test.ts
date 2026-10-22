import { describe, expect, it } from "vitest";
import { HISTORY_MAX_TOKENS, HISTORY_MAX_TURNS, TURN_MAX_CHARS, buildHistory, estimateTokens, type HistoryTurn } from "@/lib/copilot/history";
import { contextBodyFor, isCopilotPath, parseCopilotContext } from "@/lib/copilot/context";
import { createSseParser, decodeFrame, encodeSse } from "@/lib/copilot/sse";
import { copilotGreeting, partOfDay } from "@/lib/copilot/part-of-day";
import { buildStatCards } from "@/lib/copilot/stats";
import { LEAD_ID, MATTER_ID } from "./helpers";

const turn = (i: number, size = 10): HistoryTurn => ({ role: i % 2 === 0 ? "user" : "assistant", content: `${i}`.padEnd(size, "x") });
const conversation = (n: number, size?: number) => Array.from({ length: n }, (_, i) => turn(i, size));

describe("buildHistory", () => {
  it("keeps the last 10 turns when there are more, then the new question", () => {
    const out = buildHistory(conversation(14), "new?");
    // 14 turns: 4..13 are the last ten. 13 is an assistant turn and 4 a user turn.
    expect(out.slice(0, -1).map((t) => Number.parseInt(t.content, 10))).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(out.length).toBeLessThanOrEqual(HISTORY_MAX_TURNS + 1);
    expect(out.at(-1)).toEqual({ role: "user", content: "new?" });
  });

  it("drops the oldest turns of an over-budget history until it fits, keeping the newest", () => {
    // Ten turns of 3,200 characters (800 tokens each) plus a 500-token question is over the 8,000 cap.
    const turns = conversation(10, 3200);
    const out = buildHistory(turns, "q".repeat(2000));
    const history = out.slice(0, -1);
    const total = history.reduce((n, t) => n + estimateTokens(t.content), 0) + estimateTokens("q".repeat(2000));
    expect(total).toBeLessThanOrEqual(HISTORY_MAX_TOKENS);
    expect(history.length).toBeLessThan(10);
    expect(history.at(-1)?.content).toBe(turns[9].content);
  });

  it("always starts with a user turn and ends with the new question", () => {
    const out = buildHistory([{ role: "assistant", content: "orphan" }, ...conversation(3)], "next");
    expect(out[0].role).toBe("user");
    expect(out.at(-1)).toEqual({ role: "user", content: "next" });
    expect(buildHistory([], "only")).toEqual([{ role: "user", content: "only" }]);
    expect(buildHistory([{ role: "assistant", content: "a" }], "only")).toEqual([{ role: "user", content: "only" }]);
  });

  it("drops an unanswered trailing user turn so roles keep alternating", () => {
    const out = buildHistory([{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "never answered" }], "next");
    expect(out.map((t) => t.content)).toEqual(["u1", "a1", "next"]);
  });

  it("clips a single enormous turn so it cannot starve the rest", () => {
    const huge = "z".repeat(500_000);
    const out = buildHistory([{ role: "user", content: huge }, { role: "assistant", content: "short answer" }], "next");
    expect(out[0].content.length).toBeLessThanOrEqual(TURN_MAX_CHARS + 1);
    expect(out).toHaveLength(3);
    expect(out[1].content).toBe("short answer");
  });

  it("is text only: every entry is a role and a string", () => {
    const out = buildHistory(conversation(4), "q");
    for (const t of out) {
      expect(Object.keys(t).sort()).toEqual(["content", "role"]);
      expect(typeof t.content).toBe("string");
      expect(["user", "assistant"]).toContain(t.role);
    }
  });
});

describe("parseCopilotContext", () => {
  it.each([
    [`/dashboard/leads/${LEAD_ID}`, { kind: "lead", id: LEAD_ID }],
    [`/dashboard/leads/${LEAD_ID}/`, { kind: "lead", id: LEAD_ID }],
    [`/dashboard/matters/${MATTER_ID}`, { kind: "matter", id: MATTER_ID }],
    [`/dashboard/matters/${MATTER_ID}/`, { kind: "matter", id: MATTER_ID }],
    [`/dashboard/matters/${MATTER_ID}/deadlines`, { kind: "matter", id: MATTER_ID }],
    [`/dashboard/leads/${LEAD_ID}/notes/`, { kind: "lead", id: LEAD_ID }],
  ])("accepts %s", (path, expected) => {
    expect(parseCopilotContext(path)).toEqual(expected);
  });

  it.each([
    "/dashboard/leads/not-a-uuid",
    "/dashboard/leads/",
    "/dashboard/leads",
    "/dashboard/matters",
    "/dashboard/copilot",
    "/dashboard/copilot/",
    "/dashboard/queue/" + LEAD_ID,
    "/dashboard",
    `/dashboard/leads?id=${LEAD_ID}`,
    `/dashboard/leads?x=/${LEAD_ID}`,
    `/dashboard/leads/${LEAD_ID}?tab=x`,
    `/dashboard/leads/${LEAD_ID}x`,
    `/other/leads/${LEAD_ID}`,
    `//dashboard/leads/${LEAD_ID}`,
    "",
  ])("rejects %j", (path) => {
    expect(parseCopilotContext(path)).toBeNull();
  });

  it("builds the body the drawer sends: pathname plus the parsed id, and no id elsewhere", () => {
    expect(contextBodyFor(`/dashboard/leads/${LEAD_ID}`)).toEqual({ pathname: `/dashboard/leads/${LEAD_ID}`, leadId: LEAD_ID });
    expect(contextBodyFor(`/dashboard/matters/${MATTER_ID}/x`)).toEqual({ pathname: `/dashboard/matters/${MATTER_ID}/x`, matterId: MATTER_ID });
    expect(contextBodyFor("/dashboard/leads")).toEqual({ pathname: "/dashboard/leads" });
  });

  it("recognises the copilot page and its sub-paths only", () => {
    expect(isCopilotPath("/dashboard/copilot")).toBe(true);
    expect(isCopilotPath("/dashboard/copilot/")).toBe(true);
    expect(isCopilotPath("/dashboard/copilot/x")).toBe(true);
    expect(isCopilotPath("/dashboard/copilots")).toBe(false);
    expect(isCopilotPath("/dashboard")).toBe(false);
  });
});

describe("SSE frames", () => {
  const frame = (event: string, data: unknown) => encodeSse({ event, data } as never);

  it("parses two frames in one chunk", () => {
    const frames = createSseParser().push(frame("delta", { text: "a" }) + frame("delta", { text: "b" }));
    expect(frames.map((f) => JSON.parse(f.data).text)).toEqual(["a", "b"]);
  });

  it("parses a frame split across two chunks, even mid-line and mid-terminator", () => {
    const whole = frame("delta", { text: "hello world" });
    for (const cut of [5, 12, whole.length - 1, whole.length - 2]) {
      const p = createSseParser();
      const first = p.push(whole.slice(0, cut));
      expect(first).toEqual([]);
      const second = p.push(whole.slice(cut));
      expect(second).toHaveLength(1);
      expect(decodeFrame(second[0])).toEqual({ event: "delta", data: { text: "hello world" } });
    }
  });

  it("handles CRLF terminators split across chunks", () => {
    const p = createSseParser();
    expect(p.push('event: delta\r\ndata: {"text":"x"}\r')).toEqual([]);
    const out = p.push("\n\r\n");
    expect(out).toHaveLength(1);
    expect(decodeFrame(out[0])).toEqual({ event: "delta", data: { text: "x" } });
  });

  it("skips comment lines and comment-only frames", () => {
    const frames = createSseParser().push(`: keep-alive\n\n${frame("delta", { text: "a" })}: trailing comment\nevent: delta\ndata: {"text":"b"}\n\n`);
    expect(frames.map((f) => JSON.parse(f.data).text)).toEqual(["a", "b"]);
  });

  it("decodes every event kind and ignores unknown or malformed ones", () => {
    expect(decodeFrame({ event: "tool", data: JSON.stringify({ name: "n", label: "Reading matters", status: "running" }) })).toMatchObject({ event: "tool" });
    expect(decodeFrame({ event: "context", data: JSON.stringify({ status: "not-found" }) })).toEqual({ event: "context", data: { status: "not-found" } });
    expect(decodeFrame({ event: "final", data: JSON.stringify({ answer: "a", citations: [], declined: false, readFailed: true }) })).toEqual({
      event: "final",
      data: { answer: "a", citations: [], declined: false, readFailed: true },
    });
    expect(decodeFrame({ event: "error", data: JSON.stringify({ message: "m" }) })).toEqual({ event: "error", data: { message: "m" } });
    expect(decodeFrame({ event: "delta", data: "not json" })).toBeNull();
    expect(decodeFrame({ event: "mystery", data: "{}" })).toBeNull();
    expect(decodeFrame({ event: "tool", data: JSON.stringify({ name: 1 }) })).toBeNull();
  });
});

describe("greeting", () => {
  it("uses the same 12 and 18 o'clock thresholds as Today", () => {
    expect([0, 11, 12, 17, 18, 23].map(partOfDay)).toEqual(["morning", "morning", "afternoon", "afternoon", "evening", "evening"]);
  });

  it("is 'Good morning, Taylor.' with a name and 'Good morning.' without, never a stray comma", () => {
    expect(copilotGreeting(9, "Taylor")).toBe("Good morning, Taylor.");
    expect(copilotGreeting(14, "Taylor")).toBe("Good afternoon, Taylor.");
    expect(copilotGreeting(20, "Taylor")).toBe("Good evening, Taylor.");
    expect(copilotGreeting(9, null)).toBe("Good morning.");
  });
});

describe("buildStatCards", () => {
  const ok = (value: number) => ({ status: "ok" as const, value });
  const labels = ["Open matters", "Stalled matters", "Deadlines, next 14 days", "Approvals waiting"];

  it("builds four labelled cards in order with their numbers, a real zero staying 0", () => {
    const cards = buildStatCards({ open: ok(12), stalled: ok(0), deadlines: ok(3), approvals: ok(0) });
    expect(cards.map((c) => c.label)).toEqual(labels);
    expect(cards.map((c) => c.value)).toEqual([12, 0, 3, 0]);
    expect(cards.every((c) => c.state === "ok")).toBe(true);
  });

  it("a failed read is a null value and 'Couldn't load', never 0", () => {
    const cards = buildStatCards({ open: { status: "unavailable" }, stalled: { status: "unavailable" }, deadlines: ok(3), approvals: { status: "unavailable" } });
    expect(cards[0]).toMatchObject({ value: null, note: "Couldn't load", state: "unavailable" });
    expect(cards[2].value).toBe(3);
    expect(cards[3]).toMatchObject({ value: null, note: "Couldn't load" });
  });

  it("an unconfigured queue says it isn't connected", () => {
    const cards = buildStatCards({ open: ok(1), stalled: ok(1), deadlines: ok(1), approvals: { status: "unconfigured" } });
    expect(cards[3]).toMatchObject({ value: null, note: "Queue isn't connected", state: "unconfigured" });
  });
});
