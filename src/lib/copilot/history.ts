/**
 * The conversation sent along with a copilot question.
 *
 * The browser supplies the earlier turns; the server decides how much of them
 * the model sees. A forged turn can only put words in front of the model — it
 * grants no data and no tool the caller doesn't already have (every read is
 * RLS-scoped and read-only) — so the checks here are about size and shape.
 */

export type HistoryTurn = { role: "user" | "assistant"; content: string };

export const HISTORY_MAX_TURNS = 10;
/** Estimated, at four characters a token: a tokenizer would be a new dependency. */
export const HISTORY_MAX_TOKENS = 8000;
/** One huge turn must not starve the rest of the history. */
export const TURN_MAX_CHARS = 4000;

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

function clip(text: string): string {
  const t = text.trim();
  return t.length > TURN_MAX_CHARS ? `${t.slice(0, TURN_MAX_CHARS)}…` : t;
}

/**
 * Last ten turns, oldest dropped first until the estimate (history plus the new
 * question) fits. Always starts with a user turn and always ends with the new
 * question. Text only: tool blocks are never part of history.
 */
export function buildHistory(turns: readonly HistoryTurn[], question: string): HistoryTurn[] {
  let kept = turns
    .map((t): HistoryTurn => ({ role: t.role, content: clip(t.content) }))
    .filter((t) => t.content.length > 0)
    .slice(-HISTORY_MAX_TURNS);

  // A trailing user turn is a question that never got an answer; the new
  // question follows it directly, so keep the roles alternating.
  while (kept.length > 0 && kept[kept.length - 1].role === "user") kept = kept.slice(0, -1);

  const budget = HISTORY_MAX_TOKENS - estimateTokens(question);
  const cost = (list: readonly HistoryTurn[]) => list.reduce((sum, t) => sum + estimateTokens(t.content), 0);
  while (kept.length > 0 && cost(kept) > budget) kept = kept.slice(1);

  while (kept.length > 0 && kept[0].role !== "user") kept = kept.slice(1);

  return [...kept, { role: "user", content: question }];
}
