import { askCopilot, buildRequestBody, type Exchange } from "./client";

/**
 * The chat's behaviour without its markup: ask a question, stream the answer
 * into the thread, start a new thread. The component supplies the state and
 * `fetch`; a test supplies a plain array and a canned stream.
 */
export type ChatDeps = {
  fetchImpl: typeof fetch;
  getExchanges: () => Exchange[];
  setExchanges: (update: (prev: Exchange[]) => Exchange[]) => void;
  /** The drawer's current page; the full-page copilot has none and sends no context. */
  getPathname?: () => string | undefined;
  newId?: () => string;
};

export function createChatController(deps: ChatDeps) {
  let busy = false;
  return {
    /** Resolves true once the answer has finished streaming; false if nothing was sent. */
    async ask(raw: string): Promise<boolean> {
      const question = raw.trim();
      if (!question || busy) return false;
      busy = true;
      try {
        const id = deps.newId ? deps.newId() : crypto.randomUUID();
        const body = buildRequestBody({ question, exchanges: deps.getExchanges(), pathname: deps.getPathname?.() });
        deps.setExchanges((prev) => [...prev, { id, question, status: "pending" }]);
        await askCopilot({
          fetchImpl: deps.fetchImpl,
          body,
          onUpdate: (update) => deps.setExchanges((prev) => prev.map((e) => (e.id === id ? update(e) : e))),
        });
        return true;
      } finally {
        busy = false;
      }
    },
    /** Clears what is shown. There is no server-side conversation to reset. */
    newThread(): void {
      if (!busy) deps.setExchanges(() => []);
    },
  };
}
