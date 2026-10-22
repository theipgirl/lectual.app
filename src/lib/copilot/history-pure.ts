import type { Exchange } from "./client";
import type { CopilotCitation } from "./sse";

/**
 * The pure rules of saved Copilot chats (lectual 0099): titles, limits, the shape of a re-opened chat,
 * dates and the delete confirmation. No database, no client; the store and the page both use these.
 */

export const TITLE_MAX_CHARS = 80;
/** lectual 0099: content <= 40000 characters. */
export const MESSAGE_MAX_CHARS = 40_000;
/** lectual 0099: citations <= 64 KB. Stay well under it. */
export const CITATIONS_MAX_BYTES = 60_000;

/** The first question as a title: whitespace collapsed, at most 80 characters, the last one an ellipsis when it was cut. */
export function titleFromQuestion(question: string): string {
  const text = question.replace(/\s+/g, " ").trim();
  if (text.length <= TITLE_MAX_CHARS) return text || "Untitled chat";
  return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
}

export const clipContent = (text: string): string => (text.length > MESSAGE_MAX_CHARS ? text.slice(0, MESSAGE_MAX_CHARS) : text);

/** Citations as the array that gets stored: whole citations only, never more than the column allows. */
export function storableCitations(citations: readonly CopilotCitation[]): CopilotCitation[] {
  const kept: CopilotCitation[] = [];
  let bytes = 2;
  for (const c of citations) {
    const size = JSON.stringify(c).length + 1;
    if (bytes + size > CITATIONS_MAX_BYTES) break;
    kept.push(c);
    bytes += size;
  }
  return kept;
}

export type SavedMessage = { id: string; role: "user" | "assistant"; content: string; citations: CopilotCitation[] };

const isCitation = (v: unknown): v is CopilotCitation =>
  typeof v === "object" &&
  v !== null &&
  ((v as CopilotCitation).type === "matter" || (v as CopilotCitation).type === "lead") &&
  typeof (v as CopilotCitation).id === "string" &&
  typeof (v as CopilotCitation).label === "string" &&
  typeof (v as CopilotCitation).href === "string";

export const readCitations = (value: unknown): CopilotCitation[] => (Array.isArray(value) ? value.filter(isCitation) : []);

/** Saved messages (oldest first) as the thread's exchanges: each question with the answer saved after it. */
export function exchangesFromMessages(messages: readonly SavedMessage[]): Exchange[] {
  const out: Exchange[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const next = messages[i + 1];
    if (next?.role !== "assistant") continue; // an unanswered question is never drawn
    out.push({ id: m.id, question: m.content, status: "done", answer: next.content, citations: next.citations, declined: false, readFailed: false });
    i += 1;
  }
  return out;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", then a date. */
export function relativeDate(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return "Yesterday";
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  const sameYear = new Date(then).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** Delete asks first: "idle" shows Delete; "confirming" shows Yes, delete / Cancel. Only "confirm" from "confirming" deletes. */
export type DeleteStep = "idle" | "confirming";
export function nextDeleteStep(step: DeleteStep, event: "ask" | "cancel" | "confirm"): { step: DeleteStep; run: boolean } {
  if (event === "ask") return { step: "confirming", run: false };
  if (event === "cancel") return { step: "idle", run: false };
  return step === "confirming" ? { step: "idle", run: true } : { step, run: false };
}

export const SAVED_CHATS_NOT_SET_UP = "Saved chats aren't available until the database update.";
export const SAVED_CHATS_UNAVAILABLE = "Saved chats couldn't be loaded.";
export const SAVED_CHATS_EMPTY = "No saved chats yet.";
export const SAVE_FAILED_NOTE = "This chat isn't being saved right now.";

/** New chat: when a past chat is open (`?c=`), the path to push so the server renders a fresh chat; null when already on a new one. */
export const newChatNavigation = (openId: string | null, path: string): string | null => (openId ? path : null);
