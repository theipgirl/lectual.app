import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * callClaude against a mocked SDK. The stop reason is read BEFORE the JSON is parsed: the SDK's `parse()`
 * helper parsed first, so an answer cut off at max_tokens surfaced as "Failed to parse structured output:
 * SyntaxError: Unterminated string in JSON at position 8155" (RPB intake triage, 2026-10-22) and never as
 * the cut-off error. Every call also carries a timeout, a retry cap and the caller's abort signal.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.AGENT_MODEL;
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

const Schema = z.object({ lane: z.enum(["hot", "warm", "cold"]), reason: z.string() });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function mockCreate(message: Record<string, unknown>) {
  const calls: Array<{ body: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const create = vi.fn(async (body: Record<string, unknown>, options: Record<string, unknown>) => {
    calls.push({ body, options });
    return { model: "claude-opus-5", usage, ...message };
  });
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class {
      beta = { messages: { create, parse: vi.fn(() => Promise.reject(new Error("parse() must not be used"))) } };
    },
  }));
  return { calls };
}

const req = { system: "S", user: "U", schema: Schema, effort: "low" as const, maxTokens: 16_000 };

describe("callClaude", () => {
  it("a good answer is parsed against the schema, with cost", async () => {
    mockCreate({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ lane: "warm", reason: "ok" }) }] });
    const { callClaude } = await import("@/lib/ai/claude");
    const res = await callClaude(req);
    expect(res.output).toEqual({ lane: "warm", reason: "ok" });
    expect(res.costUsd).not.toBeNull();
  });

  it("an answer cut off at max_tokens is the 'cut off' AiOutputError, not the SDK's JSON parse error", async () => {
    mockCreate({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: '{"lane":"warm","reason":"Unterminated' }] });
    const { callClaude, AiOutputError } = await import("@/lib/ai/claude");
    const err = await callClaude(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiOutputError);
    expect(err).toMatchObject({ kind: "truncated", name: "AiOutputError", message: expect.stringMatching(/cut off/) });
    expect((err as Error).message).not.toMatch(/Failed to parse structured output/);
  });

  it("a refusal and a wrong shape are AiOutputErrors of their own kind", async () => {
    mockCreate({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] });
    let mod = await import("@/lib/ai/claude");
    await expect(mod.callClaude(req)).rejects.toMatchObject({ kind: "refusal" });

    vi.resetModules();
    mockCreate({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ lane: "lukewarm" }) }] });
    mod = await import("@/lib/ai/claude");
    await expect(mod.callClaude(req)).rejects.toMatchObject({ kind: "shape", name: "AiOutputError" });

    vi.resetModules();
    mockCreate({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] });
    mod = await import("@/lib/ai/claude");
    await expect(mod.callClaude(req)).rejects.toMatchObject({ kind: "shape" });
  });

  it("sends the structured format, and a timeout, a retry cap and the caller's signal with every call", async () => {
    const { calls } = mockCreate({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ lane: "cold", reason: "r" }) }] });
    const { callClaude, AGENT_CALL_TIMEOUT_MS, AGENT_CALL_MAX_RETRIES } = await import("@/lib/ai/claude");
    const controller = new AbortController();
    await callClaude({ ...req, signal: controller.signal });
    expect(calls[0].body).toMatchObject({ max_tokens: 16_000, output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(calls[0].options).toEqual({ timeout: AGENT_CALL_TIMEOUT_MS, maxRetries: AGENT_CALL_MAX_RETRIES, signal: controller.signal });
    expect(AGENT_CALL_TIMEOUT_MS).toBeLessThan(300_000);
  });
});
