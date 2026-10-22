import { describeEvidence, formatDay } from "./propose";
import type { EvidenceItem, MailboxSearchState, NotesState, ReconcileRow } from "./types";

/** The sentences the screen prints about evidence. Pure, so the wording is tested. */

export function mailboxLine(state: MailboxSearchState | undefined): string | null {
  if (!state) return null;
  if (state.status === "unavailable") return `Mailbox search: not done. ${state.reason}`;
  const parts = [`${state.messages} ${state.messages === 1 ? "message" : "messages"} in the last 120 days`];
  if (state.truncated) parts.push("showing the newest 25");
  if (state.unread > 0) parts.push(`${state.unread} of ${state.mailboxes + state.unread} mailboxes couldn't be searched`);
  return `Mailbox search: ${parts.join(", ")}.`;
}

export function rowNotesLine(notes: ReconcileRow["notes"]): string | null {
  if (!notes) return null;
  if (notes.status === "ok") return `Lawmatics notes: ${notes.count} read.`;
  if (notes.status === "unavailable") return `Lawmatics notes: couldn't be read. ${notes.reason}`;
  return "Lawmatics notes: not read.";
}

export function notesSummaryLine(notes: NotesState | undefined): string | null {
  if (!notes) return null;
  if (notes.status === "ok") {
    return `Lawmatics notes: read ${notes.notes} notes for ${notes.records} people${notes.truncated ? ". Some people's notes were not read, so the list is incomplete" : ""}`;
  }
  if (notes.status === "unavailable") return `Lawmatics notes: unavailable. ${notes.reason}`;
  return `Lawmatics notes: not read. ${notes.reason}`;
}

export function lastTouchLine(lastTouch: string | null | undefined): string {
  // Always with the year: a last touch is the one date a person acts on.
  const day = formatDay(lastTouch ?? null, 0);
  return day ? `Proposed last touch: ${day}` : "No dated touch found.";
}

/** Items worth a line: a status or a classified note or mail; newest first. */
export function evidenceLines(items: readonly EvidenceItem[] | undefined): Array<{ text: string; snippet: string | null }> {
  const list = items ?? [];
  const years = list.map((i) => (i.date ? new Date(i.date).getUTCFullYear() : NaN)).filter(Number.isFinite);
  const refYear = years.length > 0 ? Math.max(...years) : undefined;
  return list.map((i) => ({ text: describeEvidence(i, refYear), snippet: i.snippet ?? null }));
}
