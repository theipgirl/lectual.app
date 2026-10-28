/**
 * The copilot's wire format: Server-Sent Events from POST /api/matters-chat.
 * Pure and client-safe (the route encodes, the browser decodes).
 */

/** `proposal` is the draft `draft_proposal` created (the one write the copilot makes). */
export type CopilotCitation = { type: "matter" | "lead" | "proposal"; id: string; label: string; href: string };

export type CopilotFinal = {
  answer: string;
  citations: CopilotCitation[];
  declined: boolean;
  readFailed: boolean;
};

export type CopilotStreamEvent =
  | { event: "tool"; data: { name: string; label: string; status: "running" | "done" } }
  | { event: "delta"; data: { text: string } }
  | { event: "context"; data: { status: "found" | "not-found" | "unavailable" } }
  | { event: "final"; data: CopilotFinal }
  // After `final`, only when the chat is saved (lectual 0099): the id to continue it with, or the reason it was not.
  | { event: "saved"; data: { conversation_id: string } }
  | { event: "save_failed"; data: Record<string, never> }
  | { event: "error"; data: { message: string } };

export function encodeSse(ev: CopilotStreamEvent): string {
  return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

export type SseFrame = { event: string; data: string };

/**
 * Incremental frame parser. Network chunks split frames anywhere, so a frame is
 * only emitted once its blank-line terminator has arrived. Comment lines (": …")
 * are skipped, and a frame with neither an event nor data is dropped.
 */
export function createSseParser() {
  let buffer = "";
  return {
    push(chunk: string): SseFrame[] {
      // A "\r" at the very end of a chunk stays in the buffer until its "\n" arrives.
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      const frames: SseFrame[] = [];
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = "";
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!event && data.length === 0) continue;
        frames.push({ event: event || "message", data: data.join("\n") });
      }
      return frames;
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** A frame the browser understands, or null for anything unknown or malformed. */
export function decodeFrame(frame: SseFrame): CopilotStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  switch (frame.event) {
    case "tool":
      if (typeof data.name === "string" && typeof data.label === "string" && (data.status === "running" || data.status === "done")) {
        return { event: "tool", data: { name: data.name, label: data.label, status: data.status } };
      }
      return null;
    case "delta":
      return typeof data.text === "string" ? { event: "delta", data: { text: data.text } } : null;
    case "context":
      return data.status === "found" || data.status === "not-found" || data.status === "unavailable"
        ? { event: "context", data: { status: data.status } }
        : null;
    case "final":
      if (typeof data.answer === "string" && Array.isArray(data.citations)) {
        return {
          event: "final",
          data: {
            answer: data.answer,
            citations: data.citations as CopilotCitation[],
            declined: data.declined === true,
            readFailed: data.readFailed === true,
          },
        };
      }
      return null;
    case "saved":
      return typeof data.conversation_id === "string" && data.conversation_id
        ? { event: "saved", data: { conversation_id: data.conversation_id } }
        : null;
    case "save_failed":
      return { event: "save_failed", data: {} };
    case "error":
      return { event: "error", data: { message: typeof data.message === "string" ? data.message : "Something went wrong — try again." } };
    default:
      return null;
  }
}
