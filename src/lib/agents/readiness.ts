import { agentNeedsAi, type AgentId } from "./types";

/**
 * Whether an agent that is switched on can actually do anything. Pure: the
 * caller reads the mailboxes, the queue and the AI key, and hands the answers
 * in. "On" must never mean "silently doing nothing", and a failed read must
 * never pass for "nothing connected", so mailboxes and the queue each take
 * three states.
 *
 *   ok          — reached it, and there is something to work with
 *   none        — reached it, and there is nothing (no active mailbox / no queue wired up)
 *   unavailable — could not reach it, so it is not known either way
 */
export type ReadinessSource = "ok" | "none" | "unavailable";

export type AgentReadinessInput = {
  agent: AgentId;
  enabled: boolean;
  /** Does the firm hold the Mailboxes module? The agents that read mailboxes or the Outlook calendar depend on it. */
  hasMailboxModule: boolean;
  /** Active mailbox connections the page can see. Email intel, the Stage Keeper and the Inbox summary read this. */
  mailbox: ReadinessSource;
  aiConfigured: boolean;
  /** The approval queue. The agents that write a queue draft (post-consult, morning brief, consult prep, inbox summary) read this. */
  queue: ReadinessSource;
  /**
   * Outlook consults the page can read. Only the Stage Keeper uses it: it is ready with an
   * active mailbox OR readable consults. Optional so every other caller is unchanged.
   */
  calendar?: ReadinessSource;
  /**
   * Whether lectual migration 0098 is applied, as far as the page can tell (the Outlook calendar columns
   * are probed; the same migration adds the new agents to the settings CHECK). Only the three newest agents
   * read it. `pending` shows "Not available until the database update" whether or not the agent is on.
   */
  databaseUpdate?: DatabaseUpdate;
};

export type DatabaseUpdate = "applied" | "pending" | "unknown";

/** The agents that exist only once lectual 0098 is applied. The Stage Keeper predates this and keeps its own wording. */
const NEEDS_DATABASE_UPDATE: ReadonlySet<AgentId> = new Set<AgentId>(["morning-brief", "consult-prep", "inbox-summary"]);
/** The agents that read connected mailboxes or the Outlook calendar, and so need the Mailboxes module. */
const NEEDS_MAILBOX_MODULE: ReadonlySet<AgentId> = new Set<AgentId>(["email-intel", "stage-keeper", "consult-prep", "inbox-summary"]);

export type ReadinessTone = "ok" | "warn" | "mute";

export type AgentReadiness = {
  label: string;
  /** `ok` means "switched on and able to run". The header counts derive from it. */
  tone: ReadinessTone;
  /** One plain sentence. Never empty. */
  reason: string;
};

/**
 * Precedence for a switched-on agent: a pending database update (the three newest agents), a missing
 * module, then the AI key, then the agent's own requirement (a mailbox, calendar events), then the
 * queue, then ready. Intake triage depends only on the AI key: the queue only decides whether it can
 * write the hot-lead briefing.
 */
export function agentReadiness(input: AgentReadinessInput): AgentReadiness {
  const { agent, enabled, hasMailboxModule, mailbox, queue } = input;

  if (NEEDS_DATABASE_UPDATE.has(agent) && input.databaseUpdate === "pending") {
    return {
      label: "Not available until the database update",
      tone: enabled ? "warn" : "mute",
      reason: "This agent needs a database update (lectual 0098) that hasn't been applied yet. Ask Lectual to apply the database update, then switch it on.",
    };
  }

  if (NEEDS_MAILBOX_MODULE.has(agent) && !hasMailboxModule) {
    return {
      label: "Needs the Mailboxes module",
      tone: enabled ? "warn" : "mute",
      reason: "This agent reads connected mailboxes or the Outlook calendar, and this firm doesn't have the Mailboxes module. Contact Lectual to add it.",
    };
  }
  if (!enabled) return { label: "Off", tone: "mute", reason: "Switched off." };

  // The Stage Keeper is rule-based: it calls no model, so a missing AI key never blocks it.
  if (agentNeedsAi(agent) && !input.aiConfigured) {
    return {
      label: "On · needs the AI key",
      tone: "warn",
      reason: "The AI key isn't set on this deployment, so this agent can't run until an administrator adds it.",
    };
  }

  if (agent === "email-intel" || agent === "inbox-summary") {
    if (mailbox === "none") {
      return {
        label: "On · waiting for a mailbox",
        tone: "warn",
        reason: "No active mailbox is connected that this page can see (the firm's mailboxes and your own), so there is no mail to read.",
      };
    }
    if (mailbox === "unavailable") {
      return {
        label: "On · couldn't check mailboxes",
        tone: "warn",
        reason: "The mailbox connections couldn't be read just now, so it isn't known whether this agent has any mail to read.",
      };
    }
  }

  if (agent === "stage-keeper" && mailbox !== "ok") {
    const calendar = input.calendar ?? "none";
    // Ready with an active mailbox OR consults it can read. Only when neither is there, say which is missing.
    if (calendar !== "ok") {
      if (mailbox === "unavailable" || calendar === "unavailable") {
        return {
          label: "On · couldn't check its sources",
          tone: "warn",
          reason: "The mailbox connections or the calendar couldn't be read just now, so it isn't known whether this agent has anything to read.",
        };
      }
      return {
        label: "On · waiting for a mailbox",
        tone: "warn",
        reason: "No active mailbox is connected that this page can see, and no Outlook consults are readable, so there is no mail or consult to place a lead from.",
      };
    }
  }

  if (agent === "consult-prep") {
    const calendar = input.calendar ?? "none";
    if (calendar === "none") {
      return {
        label: "On · waiting for calendar events",
        tone: "warn",
        reason: "No Outlook consults are readable yet, so there is nothing to prepare. Connect a Microsoft mailbox and let the calendar sync.",
      };
    }
    if (calendar === "unavailable") {
      return {
        label: "On · couldn't check the calendar",
        tone: "warn",
        reason: "The Outlook calendar couldn't be read just now, so it isn't known whether this agent has any consults to prepare.",
      };
    }
  }

  // Every agent that writes a queue draft needs the queue. The Morning brief's only requirement IS the queue.
  if (agent === "post-consult" || agent === "morning-brief" || agent === "consult-prep" || agent === "inbox-summary") {
    if (queue === "none") {
      return {
        label: "On · needs an approval queue",
        tone: "warn",
        reason: "This firm has no approval queue connected, and this agent never writes a draft anywhere else.",
      };
    }
    if (queue === "unavailable") {
      return {
        label: "On · couldn't reach the queue",
        tone: "warn",
        reason: "The approval queue couldn't be reached just now, so it isn't known whether this agent can queue its drafts.",
      };
    }
  }

  return { label: "On", tone: "ok", reason: "Switched on and able to run." };
}
