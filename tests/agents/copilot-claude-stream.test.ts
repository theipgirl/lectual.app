import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gate, mockSdk, textMessage, toolMessage } from "../copilot/helpers";

/**
 * streamClaudeWithTools / copilotModel in @/lib/ai/claude, against a mocked
 * SDK: the model default and override, the cache breakpoints, text deltas, and
 * that callClaudeWithTools (the agents' primitive) is untouched.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.COPILOT_MODEL;
  delete process.env.AGENT_MODEL;
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.COPILOT_MODEL;
  delete process.env.AGENT_MODEL;
});

const tools = [
  { name: "a_tool", description: "first", input_schema: { type: "object" as const, properties: {} } },
  { name: "b_tool", description: "second", input_schema: { type: "object" as const, properties: {} } },
  { name: "c_tool", description: "third", input_schema: { type: "object" as const, properties: {} } },
];
const req = { system: "SYSTEM TEXT", messages: [{ role: "user" as const, content: "hi" }], tools };

describe("copilotModel", () => {
  it("defaults to claude-sonnet-5, and COPILOT_MODEL overrides it", async () => {
    const { copilotModel } = await import("@/lib/ai/claude");
    expect(copilotModel()).toBe("claude-sonnet-5");

    vi.resetModules();
    process.env.COPILOT_MODEL = "claude-haiku-4-5";
    const again = await import("@/lib/ai/claude");
    expect(again.copilotModel()).toBe("claude-haiku-4-5");
  });
});

describe("streamClaudeWithTools", () => {
  it("calls the SDK with claude-sonnet-5 when COPILOT_MODEL is unset", async () => {
    const sdk = mockSdk([{ message: textMessage("hello") }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    await streamClaudeWithTools(req);
    expect(sdk.requests[0].model).toBe("claude-sonnet-5");
  });

  it("calls the SDK with COPILOT_MODEL when it is set", async () => {
    process.env.COPILOT_MODEL = "some-other-model";
    const sdk = mockSdk([{ message: textMessage("hello") }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    await streamClaudeWithTools(req);
    expect(sdk.requests[0].model).toBe("some-other-model");
  });

  it("puts cache_control on the system block and on the last tool only", async () => {
    const sdk = mockSdk([{ message: textMessage("hello") }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    await streamClaudeWithTools(req);

    const body = sdk.requests[0] as { system: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>>; fallbacks: string; betas: string[] };
    expect(body.system).toEqual([{ type: "text", text: "SYSTEM TEXT", cache_control: { type: "ephemeral" } }]);
    expect(body.tools.map((t) => t.name)).toEqual(["a_tool", "b_tool", "c_tool"]);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toBeUndefined();
    expect(body.tools[2].cache_control).toEqual({ type: "ephemeral" });
    expect(body.fallbacks).toBe("default");
    expect(body.betas).toContain("server-side-fallback-2026-07-01");
    // The caller's own tool objects are not mutated.
    expect((tools[2] as Record<string, unknown>).cache_control).toBeUndefined();
  });

  it("passes text deltas to onText as they arrive and resolves to the turn's content, model, usage and cost", async () => {
    mockSdk([{ deltas: ["Hel", "lo"], message: textMessage("Hello", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500 }) }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    const seen: string[] = [];
    const result = await streamClaudeWithTools({ ...req, onText: (d) => seen.push(d) });

    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.content).toEqual([{ type: "text", text: "Hello", citations: null }]);
    expect(result.model).toBe("claude-sonnet-5");
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0 });
    // sonnet-5: $2/M in, $10/M out, cache reads at 0.1x input.
    expect(result.costUsd).toBe(0.0031);
  });

  it("hands back tool_use blocks to the caller", async () => {
    mockSdk([{ message: toolMessage([{ name: "a_tool", input: { x: 1 } }]) }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    const result = await streamClaudeWithTools(req);
    expect(result.content[0]).toMatchObject({ type: "tool_use", name: "a_tool", input: { x: 1 } });
  });

  it("returns a refusal as ordinary text, and throws on a transport failure", async () => {
    mockSdk([{ message: { ...textMessage("I can't help with that."), stop_reason: "refusal" } as never }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    await expect(streamClaudeWithTools(req)).resolves.toMatchObject({ content: [{ type: "text", text: "I can't help with that." }] });

    vi.resetModules();
    mockSdk([{ fail: new Error("socket hang up") }]);
    const again = await import("@/lib/ai/claude");
    await expect(again.streamClaudeWithTools(req)).rejects.toThrow("socket hang up");
  });

  it("throws AiNotConfiguredError with no key, before any request", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const sdk = mockSdk([{ message: textMessage("x") }]);
    const { streamClaudeWithTools, AiNotConfiguredError } = await import("@/lib/ai/claude");
    await expect(streamClaudeWithTools(req)).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(sdk.stream).not.toHaveBeenCalled();
  });

  it("resolves only after a held stream is released", async () => {
    const held = gate();
    mockSdk([{ deltas: ["x"], gate: held.promise, message: textMessage("x") }]);
    const { streamClaudeWithTools } = await import("@/lib/ai/claude");
    let done = false;
    const p = streamClaudeWithTools(req).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false);
    held.release();
    await p;
    expect(done).toBe(true);
  });
});

describe("callClaudeWithTools is unchanged", () => {
  it("still uses the agent model and the non-streaming create call, with no tool cache breakpoint", async () => {
    const sdk = mockSdk([]);
    sdk.create.mockResolvedValue(textMessage("done", { input_tokens: 10, output_tokens: 5 }));
    const { callClaudeWithTools } = await import("@/lib/ai/claude");
    await callClaudeWithTools(req);

    expect(sdk.stream).not.toHaveBeenCalled();
    const body = sdk.create.mock.calls[0][0] as { model: string; tools: Array<Record<string, unknown>> };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.tools.every((t) => t.cache_control === undefined)).toBe(true);
  });

  it("follows AGENT_MODEL, not COPILOT_MODEL", async () => {
    process.env.AGENT_MODEL = "agent-model-x";
    process.env.COPILOT_MODEL = "copilot-model-y";
    const sdk = mockSdk([]);
    sdk.create.mockResolvedValue(textMessage("done"));
    const { callClaudeWithTools } = await import("@/lib/ai/claude");
    await callClaudeWithTools(req);
    expect((sdk.create.mock.calls[0][0] as { model: string }).model).toBe("agent-model-x");
  });
});
