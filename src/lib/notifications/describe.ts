import { QUEUE_ID, UUID } from "@/lib/queue/link-rules";
import { CONSULT_OUTCOME_LABEL, isConsultOutcome } from "@/lib/pipeline/consult-outcome-labels";

/**
 * One notification row in plain words: an icon, a label, one sentence and a
 * link. Pure and client-safe (no server imports), because the bell popover and
 * the full page render the same thing.
 *
 * It reads names and a headline and nothing else. A `lead_replied` row is built
 * from the lead's name only: `subject`, `preview`, `body` and `from` are never
 * read, even if a payload carries them, because what a client wrote stays in the
 * mailbox. It never throws: an unknown kind, a missing name or a payload that is
 * not an object gives a neutral sentence.
 */

export type NotificationIcon = "assigned" | "mention" | "reply" | "timer" | "outcome" | "approval" | "generic";

export type DescribableNotification = {
  /** A string, not the enum: the dedicated kinds a later migration adds already render. */
  kind: string;
  lead_id?: string | null;
  matter_id?: string | null;
  payload?: unknown;
};

export type NotificationDescription = {
  icon: NotificationIcon;
  label: string;
  sentence: string;
  href: string | null;
};

const HEADLINE_MAX = 120;

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function hrefFor(row: DescribableNotification, payload: Record<string, unknown>, isApproval: boolean): string | null {
  if (isApproval) {
    const queueId = typeof payload.queue_id === "string" ? payload.queue_id : null;
    return queueId && QUEUE_ID.test(queueId) ? `/dashboard/queue/${queueId}/` : null;
  }
  if (row.lead_id && UUID.test(row.lead_id)) return `/dashboard/leads/${row.lead_id}/`;
  if (row.matter_id && UUID.test(row.matter_id)) return `/dashboard/matters/${row.matter_id}/`;
  return null;
}

function outcomeSentence(outcome: unknown, lead: string | null): string {
  const on = lead ?? "a lead";
  if (!isConsultOutcome(outcome)) return `Consult outcome logged on ${on}`;
  if (outcome === "rebooked_after_no_show") return `${CONSULT_OUTCOME_LABEL[outcome]}: ${on}`;
  if (outcome === "no_show") return `No-show logged on ${on}`;
  return `Reschedule requested on ${on}`;
}

export function describeNotification(
  row: DescribableNotification,
  opts: { actorName?: string | null } = {},
): NotificationDescription {
  const payload = asRecord(row.payload);
  const lead = text(payload.lead_name);
  const actor = text(opts.actorName) ?? "Someone";

  // A `mentioned` row can carry a different event in `payload.source`; the
  // dedicated kinds a later migration adds mean the same thing as their source.
  const source = text(payload.source);
  const event =
    row.kind === "consult_outcome" || (row.kind === "mentioned" && source === "consult_outcome")
      ? "consult_outcome"
      : row.kind === "approval_needed" || (row.kind === "mentioned" && source === "approval_needed")
        ? "approval_needed"
        : row.kind === "mentioned" && source
          ? "unknown_source"
          : row.kind;

  switch (event) {
    case "assigned":
      return {
        icon: "assigned",
        label: "Assigned",
        sentence: `${actor} assigned you ${lead ?? "a lead"}`,
        href: hrefFor(row, payload, false),
      };
    case "mentioned":
      return {
        icon: "mention",
        label: "Mention",
        sentence: `${actor} mentioned you on ${lead ?? "a lead"}`,
        href: hrefFor(row, payload, false),
      };
    case "lead_replied":
      return {
        icon: "reply",
        label: "Reply",
        sentence: `${lead ?? "A lead"} replied`,
        href: hrefFor(row, payload, false),
      };
    case "time_running": {
      const hours = typeof payload.hours === "number" && Number.isFinite(payload.hours) ? Math.max(0, Math.floor(payload.hours)) : null;
      return {
        icon: "timer",
        label: "Timer",
        sentence: hours === null ? "Your timer has been running a long time" : `Your timer has been running ${hours}h`,
        href: hrefFor(row, payload, false),
      };
    }
    case "consult_outcome":
      return {
        icon: "outcome",
        label: "Consult outcome",
        sentence: outcomeSentence(payload.outcome, lead),
        href: hrefFor(row, payload, false),
      };
    case "approval_needed": {
      const headline = text(payload.headline);
      return {
        icon: "approval",
        label: "Needs approval",
        sentence: headline
          ? `A draft is waiting for your approval: ${truncate(headline, HEADLINE_MAX)}`
          : "A draft is waiting for your approval",
        href: hrefFor(row, payload, true),
      };
    }
    default:
      return {
        icon: "generic",
        label: "Update",
        sentence: lead ? `Something changed on ${lead}` : "Something changed",
        href: hrefFor(row, payload, false),
      };
  }
}
