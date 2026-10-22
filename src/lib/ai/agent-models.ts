import type { AgentId } from "@/lib/agents/types";

/**
 * Which model each job runs on. Pure: the env is passed in, so a test sets it explicitly.
 *
 * No path defaults to Opus. Classification and extraction (intake triage, email intel) run on Haiku;
 * everything that writes text a person reads runs on Sonnet. `stage-keeper` makes no model call and is
 * not in the table. "staff" is a model call that is not an agent run (a letter, a prep draft, a public
 * screening); it is Sonnet, stated at the call site rather than left to a default.
 */

export type ModelTier = "haiku" | "sonnet";
export type ModelSubject = Exclude<AgentId, "stage-keeper"> | "staff";

export const AGENT_MODEL_TIER: Record<ModelSubject, ModelTier> = {
  "intake-triage": "haiku",
  "email-intel": "haiku",
  "inbox-summary": "sonnet", // its one model call writes reply drafts; the triage is rule-based
  "post-consult": "sonnet",
  "morning-brief": "sonnet",
  "consult-prep": "sonnet",
  staff: "sonnet",
};

export const DEFAULT_SONNET_MODEL = "claude-sonnet-5";
export const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5";

/** The most output tokens either tier's default model can return in one answer. */
const MAX_OUTPUT_TOKENS = 64_000;

export type ModelEnv = {
  AGENT_MODEL?: string;
  AGENT_MODEL_SONNET?: string;
  AGENT_MODEL_HAIKU?: string;
};

function usable(value: string | undefined, name: string, log: (line: string) => void): string | null {
  const id = value?.trim();
  if (!id) return null;
  if (id.toLowerCase().startsWith("claude-opus")) {
    log(`[agent-models] ${name} names an Opus model and is ignored; the tier default is used.`);
    return null;
  }
  return id;
}

export function tierModel(tier: ModelTier, e: ModelEnv, log: (line: string) => void = console.warn): string {
  if (tier === "haiku") return usable(e.AGENT_MODEL_HAIKU, "AGENT_MODEL_HAIKU", log) ?? DEFAULT_HAIKU_MODEL;
  // AGENT_MODEL is only the Sonnet-tier override; AGENT_MODEL_SONNET wins over it.
  return (
    usable(e.AGENT_MODEL_SONNET, "AGENT_MODEL_SONNET", log) ??
    usable(e.AGENT_MODEL, "AGENT_MODEL", log) ??
    DEFAULT_SONNET_MODEL
  );
}

export function resolveAgentModel(subject: ModelSubject, e: ModelEnv, log?: (line: string) => void): string {
  return tierModel(AGENT_MODEL_TIER[subject], e, log);
}

/** The largest max_tokens a request to this model may carry. */
export function maxOutputFor(_model: string): number {
  return MAX_OUTPUT_TOKENS;
}

/**
 * Whether the `effort` setting may be sent. Haiku models do not take it (the API refuses the request),
 * so for them the request carries the structured format alone.
 */
export function supportsEffort(model: string): boolean {
  return !model.toLowerCase().includes("haiku");
}
