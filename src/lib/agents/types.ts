import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft, QueueItem } from "@/lib/queue/api";

export type AgentId = "email-intel" | "intake-triage" | "post-consult" | "stage-keeper" | "morning-brief" | "consult-prep" | "inbox-summary";
export type Autonomy = "suggest" | "draft" | "act";
export type AgentTrigger = "cron" | "manual" | "webhook" | "event";

export const AGENT_IDS: readonly AgentId[] = [
  "email-intel",
  "intake-triage",
  "post-consult",
  "stage-keeper",
  "morning-brief",
  "consult-prep",
  "inbox-summary",
];

export const AGENT_DEFS: Record<AgentId, { name: string; reads: string; description: string; defaultAutonomy: Autonomy }> = {
  "email-intel": {
    name: "Email → client intel",
    reads: "Connected mailboxes",
    description:
      "Reads mail already matched to a lead and pulls out what the record is missing: business name, phone, website, mark, practice area. It proposes those as changes, and flags any legal question for the attorney.",
    defaultAutonomy: "draft",
  },
  "intake-triage": {
    name: "Intake triage",
    reads: "New leads",
    description:
      "Scores each new lead for readiness, value, urgency and practice fit, suggests a lane with the reason on the card (a person sets the lane). Hot leads get a briefing in the queue.",
    defaultAutonomy: "draft",
  },
  "post-consult": {
    name: "Post-consult drafter",
    reads: "Consult notes",
    description:
      "After a consult, drafts the follow-up email and an internal summary from the call notes, into the approval queue. An attorney edits and sends it.",
    defaultAutonomy: "draft",
  },
  "stage-keeper": {
    name: "Stage Keeper",
    reads: "Matched mail and calendar consults",
    description:
      "Reads the mail already matched to each lead and the consults on the Outlook calendar, and moves the lead forward on the board when the record shows it has moved on: a consult booked, a questionnaire, post-consult or LOE email sent. Every move is logged and can be undone. It never moves a lead into a client, lost or nurture stage, never sets the lane, and never sends anything.",
    defaultAutonomy: "act",
  },
  "morning-brief": {
    name: "Morning brief",
    reads: "Leads, matters, consults and the queue",
    description:
      "Writes the attorney a daily briefing into the approval queue: today's consults, leads waiting on a reply, stage suggestions, stalled leads, deadlines in the next 14 days and the queue count. For up to five stalled leads a day it also drafts a follow-up email. It only drafts: an attorney reviews and sends everything.",
    defaultAutonomy: "draft",
  },
  "consult-prep": {
    name: "Consult prep",
    reads: "Outlook consults and the lead record",
    description:
      "For each consult in the next 24 hours that is linked to a lead, drafts an internal heads-up with the facts on file and, for firms with the Agent toolkit, a short client email about what to have ready. It never picks classes, a package or a price: that stays with the attorney. It only drafts: an attorney reviews and sends everything.",
    defaultAutonomy: "draft",
  },
  "inbox-summary": {
    name: "Inbox summary",
    reads: "Connected mailboxes",
    description:
      "Reads the last 24 hours of mail in the connected mailboxes, sorts it into what needs the attorney, what to route and what can wait, and writes one digest into the approval queue. For mail that needs the attorney in a personal Outlook mailbox it also leaves a reply in that mailbox's Drafts folder. It only drafts: an attorney reviews and sends everything, and disputes and suspected scams get no reply.",
    defaultAutonomy: "draft",
  },
};

/** Agents that call a model. The rest are rule-based and need no AI key to run. */
const NO_AI_AGENTS: ReadonlySet<AgentId> = new Set<AgentId>(["stage-keeper"]);
export const agentNeedsAi = (agent: AgentId): boolean => !NO_AI_AGENTS.has(agent);

export const AUTONOMY_HINT: Record<Autonomy, string> = {
  suggest: "Notes what it would do on the record. You do the work.",
  draft: "Writes it and holds it for review. Client-facing work goes to the approval queue.",
  act: "Updates internal records itself, filling only empty fields, and logs every change. Client-facing work still waits for you.",
};

/**
 * The autonomy hint for one agent. Most agents share the generic wording; the Stage Keeper
 * moves leads rather than filling fields, so it says what each level does to the board.
 */
const AGENT_AUTONOMY_HINT: Partial<Record<AgentId, Record<Autonomy, string>>> = {
  "stage-keeper": {
    suggest: "Writes a suggestion card on the lead instead of moving it. A person accepts or dismisses it.",
    draft: "Writes a suggestion card on the lead instead of moving it. A person accepts or dismisses it.",
    act: "Moves the lead forward itself and logs it, so you can undo it. Never into a client, lost or nurture stage, and it never sends anything.",
  },
  "morning-brief": {
    suggest: "Writes only the internal briefing. No follow-up emails are drafted.",
    draft: "Writes the internal briefing and a follow-up email draft for each stalled lead. Everything waits in the approval queue; nothing is sent.",
    act: "Writes the internal briefing and a follow-up email draft for each stalled lead. Everything waits in the approval queue; nothing is sent.",
  },
  "consult-prep": {
    suggest: "Writes only the internal heads-up. No client email is drafted.",
    draft: "Writes the internal heads-up and, if the Agent toolkit is on for this firm, a client email about what to have ready. Both wait in the approval queue; nothing is sent.",
    act: "Writes the internal heads-up and, if the Agent toolkit is on for this firm, a client email about what to have ready. Both wait in the approval queue; nothing is sent.",
  },
  "inbox-summary": {
    suggest: "Writes only the digest. No reply is left in Outlook.",
    draft: "Writes the digest and leaves a reply in the Drafts folder of a personal Outlook mailbox for mail that needs the attorney. Nothing is sent.",
    act: "Writes the digest and leaves a reply in the Drafts folder of a personal Outlook mailbox for mail that needs the attorney. Nothing is sent.",
  },
};

export function autonomyHint(agent: AgentId, autonomy: Autonomy): string {
  return AGENT_AUTONOMY_HINT[agent]?.[autonomy] ?? AUTONOMY_HINT[autonomy];
}

/** What every agent run is handed. The service-role client is fenced by orgId. */
export type AgentContext = {
  admin: SupabaseClient;
  orgId: string;
  autonomy: Autonomy;
  llm: StructuredCall;
  /** Null when the firm has no approval queue; agents must then not queue anything. */
  queueOrgKey: string | null;
  createDraft: (input: NewQueueDraft) => Promise<{ id: string }>;
  /**
   * The firm's pending queue items, for the agents that must know what is already waiting
   * (the morning brief). Rejects when the queue cannot be read; absent when no reader was wired.
   * Either way the agent treats it as "unknown", never as an empty queue.
   */
  listPending?: () => Promise<QueueItem[]>;
  /**
   * The firm's APPROVED queue items, for the Stage Keeper (an approved post-consult email places the lead).
   * Rejects when the queue cannot be read; absent when no reader was wired or the firm has no queue.
   * The agent treats a rejection as "unknown" and says so, never as "none approved".
   */
  listApproved?: () => Promise<QueueItem[]>;
  /**
   * The firm's module list, read with the `queue_org_key` the runner already fetches. `null` means
   * the read failed or found no row; `undefined` means the context was built without one. Both are
   * "could not be read": see `mailboxModuleState`.
   */
  orgModules?: readonly string[] | null;
  now: () => number;
  /**
   * The site's public origin ("https://app.example.com"), for the links the
   * post-consult agent puts in client email. Null/absent = unknown: the agent
   * then drafts no proposal (it never guesses a host for a client-facing link).
   */
  siteOrigin?: () => Promise<string | null>;
  /** For email-intel's body fetch; injected so tests stay offline. */
  fetchImpl?: typeof fetch;
  /** Mailbox deps for email-intel (root key + provider credentials). */
  mailbox?: import("@/lib/mailbox/sync").SyncDeps;
  /**
   * Milliseconds left in this run's time budget, on the real clock (not `now`, which tests fix).
   * Set by the runner; absent means no budget was given (a test calling an agent directly). An
   * agent working through a list checks it between items and stops early, saying so in its
   * summary, rather than being cut off mid-item by the runner. See `budgetNearlySpent`.
   */
  timeLeftMs?: () => number;
  /** Aborted when the run reaches its time limit. The runner also hands it to every model call. */
  signal?: AbortSignal;
};

export type AgentResult = {
  itemsIn: number;
  draftsOut: number;
  summary: string;
  /** Nothing to do for a reason worth showing (e.g. no approval queue). */
  skipped?: boolean;
};
