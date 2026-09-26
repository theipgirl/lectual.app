import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";

/**
 * The one way the agents call Claude.
 *
 *  · Official SDK, beta Messages endpoint — needed for `fallbacks`.
 *  · Structured output validated against a Zod schema (`parse`), so an agent
 *    never hand-parses JSON and never acts on a malformed answer.
 *  · The system prompt is static per agent and marked for prompt caching;
 *    everything that varies (the lead, the email, the consult) goes in the
 *    user turn, after the cache breakpoint.
 *  · Server-side refusal fallback (`fallbacks: "default"`): if the model's
 *    safety classifiers decline, the API re-runs the same request on the
 *    model Anthropic recommends for that category instead of failing.
 *  · A refusal that survives the fallback, or a truncated answer, is an
 *    error — the agent records the run as failed and writes nothing.
 *
 * Agents take a `StructuredCall` rather than importing this directly, so
 * tests can hand them a fake and never reach the network.
 */

export const DEFAULT_AGENT_MODEL = "claude-opus-5";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set, so the agents cannot run.");
  }
}
export class AiOutputError extends Error {}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type StructuredResult<T> = {
  output: T;
  /** The model that actually answered (differs from the request after a fallback). */
  model: string;
  usage: Usage;
  costUsd: number | null;
};

export type StructuredRequest<S extends z.ZodType> = {
  system: string;
  user: string;
  schema: S;
  /** low for scoring, medium for extraction, high for writing to clients. */
  effort: "low" | "medium" | "high";
  maxTokens?: number;
};

export type StructuredCall = <S extends z.ZodType>(req: StructuredRequest<S>) => Promise<StructuredResult<z.infer<S>>>;

/** USD per million tokens: [input, output]. Cache reads 0.1x input, writes 1.25x. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

export function costFor(model: string, u: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const [inp, out] = price;
  const usd =
    (u.inputTokens * inp + u.cacheReadTokens * inp * 0.1 + u.cacheWriteTokens * inp * 1.25 + u.outputTokens * out) / 1e6;
  return Math.round(usd * 10_000) / 10_000;
}

export function agentModel(): string {
  return env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function aiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export const callClaude: StructuredCall = async (req) => {
  const model = agentModel();
  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: req.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: req.user }],
  });

  if (response.stop_reason === "refusal") {
    throw new AiOutputError(
      `The model declined this request (${response.stop_details?.category ?? "unspecified"}). Nothing was written.`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiOutputError("The answer was cut off before it finished. Nothing was written.");
  }
  if (response.parsed_output == null) {
    throw new AiOutputError("The answer didn't match the expected shape. Nothing was written.");
  }

  const usage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  return { output: response.parsed_output, model: response.model, usage, costUsd: costFor(response.model, usage) };
};

export type AskClaudeInput = { system: string; prompt: string; maxTokens?: number };
export type AskClaudeResult = { skipped: true } | { text: string; model: string; costUsd: number | null };

/**
 * Plain-text call, same contract as lectual's enrichment `askClaude`: advisory,
 * so a missing key, a refusal or any provider failure comes back as
 * `{ skipped: true }` and the caller decides what that means. Used by the
 * prep-consult drafts, which then pass through the approval queue.
 */
export async function askClaude(input: AskClaudeInput): Promise<AskClaudeResult> {
  if (!aiConfigured()) return { skipped: true };
  try {
    const response = await getClient().beta.messages.create({
      model: agentModel(),
      max_tokens: input.maxTokens ?? 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input.prompt }],
    });
    if (response.stop_reason === "refusal") return { skipped: true };
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    if (!text) return { skipped: true };
    const usage: Usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    return { text, model: response.model, costUsd: costFor(response.model, usage) };
  } catch {
    return { skipped: true };
  }
}
