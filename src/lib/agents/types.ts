import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft } from "@/lib/queue/api";

export type AgentId = "email-intel" | "intake-triage" | "post-consult" | "stage-keeper";
export type Autonomy = "suggest" | "draft" | "act";
export type AgentTrigger = "cron" | "manual" | "webhook" | "event";

export const AGENT_IDS: readonly AgentId[] = ["email-intel", "intake-triage", "post-consult", "stage-keeper"];

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
};

export type AgentResult = {
  itemsIn: number;
  draftsOut: number;
  summary: string;
  /** Nothing to do for a reason worth showing (e.g. no approval queue). */
  skipped?: boolean;
};
