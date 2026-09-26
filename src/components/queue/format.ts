import type { QueueItem } from "@/lib/queue/api";

/** Presentation helpers for the queue (ported from lectual's queue/_components/format). */

export type QueueStatus = QueueItem["status"];
export const QUEUE_STATUSES: readonly QueueStatus[] = ["pending", "approved", "rejected"];

export function parseQueueStatus(value: string | string[] | undefined): QueueStatus {
  const v = Array.isArray(value) ? value[0] : value;
  return (QUEUE_STATUSES as readonly string[]).includes(v ?? "") ? (v as QueueStatus) : "pending";
}

export function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export function preview(item: QueueItem, max = 160): string {
  const flat = (item.final_body ?? item.draft_body ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** A lawmatics-mcp error that means "not wired up" rather than a transient failure. */
export function isUnconfiguredError(err: unknown): boolean {
  return err instanceof Error && /not configured/i.test(err.message);
}

const AGENT_LABEL: Record<string, string> = {
  "email-intel": "Email intel",
  "intake-triage": "Intake triage",
  "post-consult": "Post-consult",
  "prep-consult": "Prep consult",
  "document-center": "Document Center",
  "welcome-client": "Welcome",
  "filing-followup": "Filing follow-up",
};
export const agentLabel = (agent: string) => AGENT_LABEL[agent] ?? agent;
export const typeLabel = (type: string) =>
  type === "CLIENT_EMAIL" ? "Client email" : type === "BRIEFING" ? "Briefing" : type.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const STATUS_PILL: Record<QueueStatus, { label: string; tone: string }> = {
  pending: { label: "Waiting on you", tone: "lx-pill-warn" },
  approved: { label: "Approved", tone: "lx-pill-ok" },
  rejected: { label: "Rejected", tone: "lx-pill-risk" },
};

/**
 * What actually happened after approval. "Approved" alone made an unsent
 * message look handled, so every outcome says where the message is now.
 */
export function outcomeText(resolved: string | undefined, send: string | undefined): { tone: "ok" | "warn" | "risk"; text: string } | null {
  if (resolved === "reject") return { tone: "risk", text: "Rejected. The note goes back to the drafting agent — nothing was sent." };
  if (resolved !== "approve") return null;
  switch (send) {
    case "drafted":
      return { tone: "ok", text: "Approved and drafted in the firm's Outlook. Open Drafts there and press Send — nothing has reached the client yet." };
    case "mailbox-google":
    case "mailbox-microsoft":
      return {
        tone: "ok",
        text: `Approved and drafted in your ${send === "mailbox-google" ? "Gmail" : "Outlook"}. Open Drafts there and press Send — nothing has reached the client yet.`,
      };
    case "sent":
      return { tone: "ok", text: "Approved and sent from the firm's mailbox." };
    case "manual":
      return { tone: "warn", text: "Approved. This type isn't emailed — file or deliver it the usual way." };
    case "failed":
    case "mailbox-failed":
      return { tone: "risk", text: "Approved, but the draft couldn't be created — nothing reached a mailbox. Send this one yourself and check the mailbox connection." };
    default:
      return { tone: "warn", text: "Approved. No mailbox is connected for drafting, so nothing has gone out — send it yourself." };
  }
}
