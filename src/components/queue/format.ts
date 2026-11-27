import type { QueueItem } from "@/lib/queue/api";
import {
  APPROVED_CLIENT_EMAIL_NO_DRAFT,
  APPROVED_DRAFT_CHECK_OUTLOOK,
  APPROVED_DRAFT_FAILED_OUTLOOK,
  APPROVED_QUEUE_DRAFTED_FIRM,
  BLANK,
  DECK_CHIP_DONE,
  DECK_DRAFT_IN_OUTLOOK,
  DONE_OUTCOME_TEXT,
  FROM_THEIR_EMAILS,
  PASS_FAILED,
  passedToDrafter,
} from "@/lib/ui/words";
import { formatDayTime } from "@/lib/ui/dates";
import type { PillTone } from "@/lib/ui/tones";
import { isDoneItem } from "@/lib/queue/done";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { markdownToPlainText } from "@/lib/markdown";

/** Presentation helpers for the queue (ported from lectual's queue/_components/format). */

export type QueueStatus = QueueItem["status"];
export const QUEUE_STATUSES: readonly QueueStatus[] = ["pending", "approved", "rejected"];

export function parseQueueStatus(value: string | string[] | undefined): QueueStatus {
  const v = Array.isArray(value) ? value[0] : value;
  return (QUEUE_STATUSES as readonly string[]).includes(v ?? "") ? (v as QueueStatus) : "pending";
}

/** An instant on the FIRM's clock (`getFirmTimeZone()`); the default zone only
 * when the caller has none to give. */
export function fmtWhen(iso: string | null, tz: string = DEFAULT_TIME_ZONE): string {
  if (!iso) return BLANK;
  return formatDayTime(iso, { tz }) ?? iso;
}

/** One line of the body for the list: Markdown marks removed, so it reads as sentences. */
export function preview(item: QueueItem, max = 160): string {
  const flat = markdownToPlainText(item.final_body ?? item.draft_body ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** A lawmatics-mcp error that means "not wired up" rather than a transient failure. */
export function isUnconfiguredError(err: unknown): boolean {
  return err instanceof Error && /not configured/i.test(err.message);
}

const AGENT_LABEL: Record<string, string> = {
  "email-intel": FROM_THEIR_EMAILS,
  "intake-triage": "Intake triage",
  "post-consult": "Post-consult",
  "prep-consult": "Prep consult",
  "morning-brief": "Morning brief",
  "consult-prep": "Consult prep",
  "inbox-summary": "Inbox summary",
  "document-center": "Document Center",
  "welcome-client": "Welcome",
  welcome: "Welcome",
  "filing-followup": "Filing follow-up",
};
export const agentLabel = (agent: string) => AGENT_LABEL[agent] ?? agent;
export const typeLabel = (type: string) =>
  type === "CLIENT_EMAIL" ? "Client email" : type === "BRIEFING" ? "Briefing" : type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** The status pill of a queue item: Done (a reject carrying the Done marker) reads Done, never Rejected. */
export function statusPill(item: Pick<QueueItem, "status" | "resolution_note">): { label: string; tone: PillTone } {
  return isDoneItem(item) ? { label: DECK_CHIP_DONE, tone: "ok" } : STATUS_PILL[item.status];
}

export const STATUS_PILL: Record<QueueStatus, { label: string; tone: PillTone }> = {
  pending: { label: "Waiting on you", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Rejected", tone: "risk" },
};

/**
 * What actually happened after approval. "Approved" alone made an unsent
 * message look handled, so every outcome says where the message is now.
 */
export function outcomeText(
  resolved: string | undefined,
  send: string | undefined,
  done?: boolean,
  /** Sprint 4: the drafter's name, for "passed to <name>". */
  drafterName?: string | null,
  /** The item's type: a client email is never "not emailed". */
  itemType?: string,
): { tone: "ok" | "warn" | "risk"; text: string } | null {
  if (resolved === "reject" && done) return { tone: "ok", text: DONE_OUTCOME_TEXT };
  if (resolved === "reject") return { tone: "risk", text: "Rejected. The note goes back to the drafting assistant — nothing was sent." };
  if (resolved !== "approve") return null;
  switch (send) {
    case "drafted":
      // The queue drafted it in the firm's mailbox (it should not, for a client email): say whose mailbox it is.
      return { tone: "warn", text: APPROVED_QUEUE_DRAFTED_FIRM };
    case "mailbox-microsoft":
      return { tone: "ok", text: `Approved. ${DECK_DRAFT_IN_OUTLOOK} Open Drafts there and press Send — nothing has reached the client yet.` };
    case "mailbox-google":
      return { tone: "ok", text: "Approved and drafted in your Gmail. Open Drafts there and press Send — nothing has reached the client yet." };
    case "mailbox-uncertain":
      return { tone: "warn", text: `${APPROVED_DRAFT_CHECK_OUTLOOK} The approved text is below.` };
    case "sent":
      return { tone: "ok", text: "Approved and sent from the firm's mailbox." };
    case "passed":
      return { tone: "ok", text: passedToDrafter(drafterName?.trim() || "the drafter") };
    case "pass-failed":
      return { tone: "risk", text: PASS_FAILED };
    case "manual":
      if (itemType === "CLIENT_EMAIL") return { tone: "warn", text: APPROVED_CLIENT_EMAIL_NO_DRAFT };
      return { tone: "warn", text: "Approved. This type isn't emailed — file or deliver it the usual way." };
    case "mailbox-failed":
      return { tone: "risk", text: `${APPROVED_DRAFT_FAILED_OUTLOOK} The approved text is below.` };
    case "failed":
      return { tone: "risk", text: "Approved, but the draft couldn't be created — nothing reached a mailbox. Send this one yourself and check the mailbox connection." };
    default:
      return { tone: "warn", text: "Approved. No mailbox is connected for drafting, so nothing has gone out — send it yourself." };
  }
}
