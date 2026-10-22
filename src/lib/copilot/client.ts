import { contextBodyFor, type CopilotContextBody } from "./context";
import { HISTORY_MAX_TURNS, type HistoryTurn } from "./history";
import { createSseParser, decodeFrame, type CopilotCitation, type CopilotStreamEvent } from "./sse";

/**
 * The browser half of the copilot chat: what a question looks like on the wire,
 * how an answer builds up from the stream, and what a failed stream shows.
 * Pure apart from `askCopilot`, which takes its `fetch` as an argument so a
 * test can hand it a canned (and split) SSE body.
 */

export type Exchange = {
  id: string;
  question: string;
  status: "pending" | "done" | "error";
  /** Text as it streams in; replaced by `answer` when the stream finishes. */
  streamed?: string;
  /** Labels of the tools running right now ("Reading matters"). */
  tools?: string[];
  answer?: string;
  citations?: CopilotCitation[];
  declined?: boolean;
  readFailed?: boolean;
  error?: string;
  /** Whether the lead or matter page the drawer sent was found. */
  contextStatus?: "found" | "not-found" | "unavailable";
};

export type CopilotRequestBody = { question: string; history?: HistoryTurn[]; context?: CopilotContextBody; conversationId?: string };

/** The last turns of the visible thread, as the server's `history`. Unanswered or failed exchanges are left out. */
export function historyFromExchanges(exchanges: readonly Exchange[]): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  for (const ex of exchanges) {
    if (ex.status !== "done" || !ex.answer) continue;
    turns.push({ role: "user", content: ex.question }, { role: "assistant", content: ex.answer });
  }
  return turns.slice(-HISTORY_MAX_TURNS);
}

/** `pathname` is given only by the drawer; the full-page copilot sends no context. */
export function buildRequestBody(input: {
  question: string;
  exchanges: readonly Exchange[];
  pathname?: string;
  /** The saved chat this continues, if it has one. */
  conversationId?: string | null;
}): CopilotRequestBody {
  const history = historyFromExchanges(input.exchanges);
  return {
    question: input.question,
    ...(history.length > 0 ? { history } : {}),
    ...(input.pathname ? { context: contextBodyFor(input.pathname) } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
  };
}

export function reduceEvent(ex: Exchange, ev: CopilotStreamEvent): Exchange {
  switch (ev.event) {
    case "delta":
      return { ...ex, streamed: (ex.streamed ?? "") + ev.data.text };
    case "tool": {
      const running = [...(ex.tools ?? [])];
      if (ev.data.status === "running") running.push(ev.data.label);
      else {
        const at = running.indexOf(ev.data.label);
        if (at !== -1) running.splice(at, 1);
      }
      return { ...ex, tools: running };
    }
    case "context":
      return { ...ex, contextStatus: ev.data.status };
    case "final":
      return {
        ...ex,
        status: "done",
        streamed: undefined,
        tools: [],
        answer: ev.data.answer,
        citations: ev.data.citations,
        declined: ev.data.declined,
        readFailed: ev.data.readFailed,
      };
    case "error":
      return { ...ex, status: "error", streamed: undefined, tools: [], error: ev.data.message };
    case "saved":
    case "save_failed":
      return ex; // chat-level, handled by askCopilot's callbacks
  }
}

const failed = (message: string) => (ex: Exchange): Exchange => ({ ...ex, status: "error", streamed: undefined, tools: [], error: message });

export const COPILOT_UNREACHABLE = "Couldn't reach the copilot — try again.";
export const COPILOT_CUT_OFF = "The answer was cut off before it finished — try again.";
const COPILOT_GENERIC = "Something went wrong — try again.";

/**
 * Asks one question and feeds each stream event to `onUpdate` as it arrives.
 * A stream that ends without a `final` or an `error` is an error, never an
 * empty answer.
 */
export async function askCopilot(opts: {
  fetchImpl: typeof fetch;
  body: CopilotRequestBody;
  onUpdate: (update: (ex: Exchange) => Exchange) => void;
  /** The chat was saved (or this exchange was added to it): the id to continue it with. */
  onSaved?: (conversationId: string) => void;
  /** The answer arrived but could not be saved. */
  onSaveFailed?: () => void;
}): Promise<void> {
  const { fetchImpl, body, onUpdate } = opts;
  let res: Response;
  try {
    res = await fetchImpl("/api/matters-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    onUpdate(failed(COPILOT_UNREACHABLE));
    return;
  }

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    onUpdate(failed(typeof data?.error === "string" && data.error ? data.error : COPILOT_GENERIC));
    return;
  }

  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        const ev = decodeFrame(frame);
        if (!ev) continue;
        if (ev.event === "final" || ev.event === "error") finished = true;
        if (ev.event === "saved") {
          opts.onSaved?.(ev.data.conversation_id);
          continue;
        }
        if (ev.event === "save_failed") {
          opts.onSaveFailed?.();
          continue;
        }
        onUpdate((ex) => reduceEvent(ex, ev));
      }
    }
  } catch {
    if (!finished) onUpdate(failed(COPILOT_CUT_OFF));
    return;
  }
  if (!finished) onUpdate(failed(COPILOT_CUT_OFF));
}
