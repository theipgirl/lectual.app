import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft } from "@/lib/queue/api";

export type AgentId = "email-intel" | "intake-triage" | "post-consult";
export type Autonomy = "suggest" | "draft" | "act";
export type AgentTrigger = "cron" | "manual" | "webhook" | "event";

export const AGENT_IDS: readonly AgentId[] = ["email-intel", "intake-triage", "post-consult"];

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
      "Scores each new lead for readiness, value, urgency and practice fit, sets a lane, and writes the reason on the card. Hot leads get a briefing in the queue.",
    defaultAutonomy: "draft",
  },
  "post-consult": {
    name: "Post-consult drafter",
    reads: "Consult notes",
    description:
      "After a consult, drafts the follow-up email and an internal summary from the call notes, into the approval queue. An attorney edits and sends it.",
    defaultAutonomy: "draft",
  },
};

export const AUTONOMY_HINT: Record<Autonomy, string> = {
  suggest: "Notes what it would do on the record. You do the work.",
  draft: "Writes it and holds it for review. Client-facing work goes to the approval queue.",
  act: "Updates internal records itself, filling only empty fields, and logs every change. Client-facing work still waits for you.",
};

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
