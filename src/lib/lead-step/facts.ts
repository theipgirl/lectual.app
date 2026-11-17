import type { Role } from "@/lib/auth/roles";
import type { AgentId, Autonomy } from "@/lib/agents/types";
import type { CloserReason } from "@/lib/queue/deck";
import type { ApprovalRouting, QueueKind, RoutingMember } from "@/lib/queue/routing";
import type { ReviewerItem } from "@/lib/queue/reviewer-summary";
import type { ActivityRow } from "@/lib/stage-keeper/moves";

/**
 * The facts the lead page's top card ("where Lectual does the step") is decided from. Pure types: no database,
 * no server-only import, so the rules in `decide.ts`, `did.ts` and `view-model.ts` are tested without one.
 *
 * EVERY source is three-state (AGENTS.md):
 *   ok          the read worked; `value` is the truth (an empty list means none)
 *   not-set-up  there is nothing to read here: a feature is off, the approval queue isn't connected, a table isn't
 *               there yet. `why` says which, so the card can say what a person should do instead
 *   unavailable the read failed. Never drawn as empty, zero, "none" or "nothing needs you"
 */
export type Read<T> = { status: "ok"; value: T } | { status: "not-set-up"; why: NotSetUpWhy } | { status: "unavailable" };

export type NotSetUpWhy =
  /** The firm has no approval queue (no queue key, or the queue service isn't configured). */
  | "queue-off"
  /** The Mailboxes feature is off, so Outlook consults and mail are not read. */
  | "mailbox-off"
  /** The Proposals feature is off. */
  | "proposals-off"
  /** The Outlook calendar columns (lectual 0098) are not on this database yet. */
  | "calendar-not-ready";

export const ok = <T>(value: T): Read<T> => ({ status: "ok", value });
export const notSetUp = <T>(why: NotSetUpWhy): Read<T> => ({ status: "not-set-up", why });
export const unavailable = <T>(): Read<T> => ({ status: "unavailable" });

/** The lead the page is about: always the KEEPER (a merged lead's page redirects to its keeper first). */
export type LeadFacts = {
  id: string;
  /** The keeper and every lead merged into it (keeper first). History is read across these, as the lead page does. */
  mergedIds: string[];
  /** The merged set could not be read: history is the keeper's own only. */
  mergedPartial: boolean;
  name: string;
  email: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  stageId: string | null;
  stageName: string | null;
  assignedTo: string | null;
};

/** Who is looking. Re-resolved from the session by the loader; never from the browser. */
export type ViewerFacts = {
  userId: string;
  role: Role;
  actingAsStaff: boolean;
  /** The role may move stages (`CAN_MOVE_STAGE`, the list `moveLeadStage` and the Undo action enforce). */
  canMoveStage: boolean;
};

/** A pending approval-queue item linked to this lead through the queue's own resolver (`resolveBatch`). */
export type PendingDraft = {
  id: string;
  type: string;
  agent: string;
  headline: string;
  summary: string | null;
  recipient: string | null;
  subject: string | null;
  /** What would go out: the saved edit, else the draft. */
  body: string;
  draftBody: string;
  finalBody: string | null;
  createdAt: string | null;
  clientName: string | null;
  /** `payload.kind` the drafter stamped on its timeline row (`heads_up`, `client_prep`, ...), when the resolver found one. */
  payloadKind: string | null;
  /** From `routing.ts`, recomputed from the stored text on every read (an edit can make it attorney-only). */
  kind: QueueKind;
  attorneyOnly: boolean;
  reviewer: ReviewerItem[];
  /**
   * Why this card needs the full approval page instead of a Yes here (the deck's rule, `needsCloserLook`): a CHECK FIRST
   * line, a draft issue, a stale draft, a linked-proposal gate that refused. `null` = couldn't be checked, which also
   * keeps Yes off this page.
   */
  closerLook: CloserReason[] | null;
  /** The proposal the email carries a link to (the consult drafter's marker). */
  linked: LinkedProposalFact;
};

export type LinkedProposalFact =
  | { status: "none" }
  | { status: "unavailable" }
  | {
      status: "ok";
      id: string;
      version: number;
      /** draft / approved / sent / accepted / superseded / withdrawn */
      proposalStatus: string;
      clientName: string;
      legalCents: number;
      govCents: number;
      errorCount: number;
      /** The linked-proposal gate's own sentence when it refuses (e.g. "Create the proposal's link first..."), else null. */
      gateRefusal: string | null;
    };

/** An open next step (`crm_task`, status open) on the lead. */
export type OpenTask = { id: string; title: string; type: string; dueAt: string | null; assigneeId: string | null; createdAt: string };

/** The next consult on the Outlook calendar linked to this lead (Mailboxes feature). */
export type BookedConsult = { eventId: string; title: string | null; startsAt: string; endsAt: string | null; joinUrl: string | null };

/** A recorded call (Fathom / Zoom) linked to this lead. */
export type MeetingFact = {
  id: string;
  provider: string;
  title: string;
  startedAt: string | null;
  durationSeconds: number | null;
  hasMaterial: boolean;
};

/** The newest proposal version of the newest family on the lead. */
export type ProposalFact = {
  id: string;
  familyId: string;
  version: number;
  status: string;
  expiresOn: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  signed: boolean;
  legalCents: number;
  /** Client opens of this version. `unavailable` is never "not opened". */
  opens: { status: "ok"; count: number; lastAt: string | null } | { status: "unavailable" };
  /** Paid state of the current round, only for an accepted version. `unavailable` is never "not paid". */
  paid: { status: "ok"; paid: boolean; at: string | null } | { status: "unavailable" } | { status: "n/a" };
};

/** The in-app assistants' switches, read for this firm. */
export type JobsFacts = {
  /** The firm holds the Assistants feature (`agents`). */
  agentsOn: boolean;
  /** AI is configured on this server. */
  aiOn: boolean;
  /** Autopilot: `paused` (or unknown) means no assistant runs. 0082 missing = not paused. */
  autopilot: "running" | "paused" | "unknown";
  /** Per assistant: on with this autonomy, or off. No row = off (the runner's rule). */
  settings: Partial<Record<AgentId, { enabled: boolean; autonomy: Autonomy }>>;
  /** The firm's features, for the jobs that need one. */
  modules: { mailbox: boolean; proposals: boolean; agentToolkit: boolean };
  /** The firm named at least one proposal approver (the post-consult drafter drafts proposals only then). `null` = couldn't read. */
  proposalApprovers: boolean | null;
  /** A Fathom or Zoom connection is active, so recordings are imported. `null` = couldn't read. */
  meetingSourceActive: boolean | null;
};

export type RoutingFacts = { status: "ok"; routing: ApprovalRouting; members: RoutingMember[] } | { status: "failed" };

export type LeadStepFacts = {
  /** The instant the page was drawn (ISO), and the firm's zone. Every date in the card is in that zone. */
  now: string;
  timeZone: string;
  lead: LeadFacts;
  viewer: ViewerFacts;
  routing: RoutingFacts;
  approvals: Read<PendingDraft[]>;
  tasks: Read<OpenTask[]>;
  consult: Read<BookedConsult | null>;
  meetings: Read<MeetingFact[]>;
  proposal: Read<ProposalFact | null>;
  /** The lead's timeline rows across the merged set, newest first (capped). */
  activity: Read<ActivityRow[]>;
  jobs: Read<JobsFacts>;
};
