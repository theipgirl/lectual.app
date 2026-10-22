import { costFor, type Usage } from "@/lib/ai/claude";

/**
 * One line per copilot answer: how many tokens it used and what that cost, per
 * firm. It goes to the server log rather than to the agent-run table because that
 * table only accepts the four agents lectual's CHECK allows (`copilot` waits on
 * lectual migration 0098) and no signed-in role may write to it. When 0098
 * is applied, this is the one place to point at it.
 *
 * Never logs the question, the answer, a citation label or any record field —
 * only the firm id from the session, the model and the numbers. This is an
 * internal figure and is never shown to a firm as credits.
 */
export function logCopilotCost(input: { orgId: string; model: string; usage: Usage }): void {
  const { orgId, model, usage } = input;
  const cost = costFor(model, usage);
  console.info(
    `[copilot] org=${orgId} model=${model} in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} costUsd=${cost ?? "unknown"}`,
  );
}
