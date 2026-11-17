import { describe, expect, it, vi } from "vitest";
import type { StructuredCall } from "@/lib/ai/claude";
import { AiOutputError } from "@/lib/ai/claude";
import { runMeetingAssistant } from "@/lib/meeting-assistant";
import { goodRaw, input } from "./fixtures";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const fake = (output: unknown) => vi.fn(async () => ({ output, model: "m", usage, costUsd: 0 })) as unknown as StructuredCall & ReturnType<typeof vi.fn>;

describe("runMeetingAssistant", () => {
  it("ok: one call as staff (sonnet tier), validated, counts-only log", async () => {
    const call = fake(goodRaw);
    const log = vi.fn();
    const signal = new AbortController().signal;
    const r = await runMeetingAssistant(input, { call, aiConfigured: () => true, log, signal });
    expect(r.state).toBe("ok");
    if (r.state === "ok") expect(r.proposals).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(1);
    const req = (call as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.agent).toBe("staff");
    expect(req.signal).toBe(signal);
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("Maya");
    expect(logged).not.toContain("office action");
  });

  it("unavailable on a model error, with a fixed reason", async () => {
    const call = vi.fn(async () => { throw new Error("secret Maya Chen detail"); }) as unknown as StructuredCall;
    const r = await runMeetingAssistant(input, { call, aiConfigured: () => true, log: () => {} });
    expect(r).toMatchObject({ state: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("Maya");
  });

  it("unavailable on a truncated answer (never an empty list)", async () => {
    const call = vi.fn(async () => { throw new AiOutputError("cut", "truncated"); }) as unknown as StructuredCall;
    const r = await runMeetingAssistant(input, { call, aiConfigured: () => true, log: () => {} });
    expect(r.state).toBe("unavailable");
  });

  it("not-configured without an AI key, and makes no call", async () => {
    const call = fake(goodRaw);
    const r = await runMeetingAssistant(input, { call, aiConfigured: () => false });
    expect(r.state).toBe("not-configured");
    expect(call).not.toHaveBeenCalled();
  });

  it("a malformed answer is unavailable, never an empty ok", async () => {
    const r = await runMeetingAssistant(input, { call: fake({ proposals: "nope" }), aiConfigured: () => true, log: () => {} });
    expect(r.state).toBe("unavailable");
    const r2 = await runMeetingAssistant(input, { call: fake({ proposals: [null] }), aiConfigured: () => true, log: () => {} });
    expect(r2.state).toBe("unavailable");
  });

  it("exposes dropped counts and whether the rows were cut", async () => {
    const out = { proposals: [...goodRaw.proposals, { ...goodRaw.proposals[0], evidence: "never said this at all here" }] };
    const r = await runMeetingAssistant(input, { call: fake(out), aiConfigured: () => true, log: () => {} });
    expect(r).toMatchObject({ state: "ok", rowsTruncated: false });
    if (r.state === "ok") expect(r.dropped.no_evidence).toBe(1);
    const many = Array.from({ length: 301 }, (_, i) => ({ ...input.rows[0], id: `x${i}` }));
    const r2 = await runMeetingAssistant({ ...input, rows: many }, { call: fake({ proposals: [] }), aiConfigured: () => true, log: () => {} });
    expect(r2).toMatchObject({ state: "ok", rowsTruncated: true });
  });
});
