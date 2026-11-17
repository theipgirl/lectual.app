import type { Role } from "@/lib/auth/roles";
import type { AgentId, Autonomy } from "@/lib/agents/types";
import type { LeadCloserLook } from "./closer-look";
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

/** A pending approval-queue item linked to this lead through the lead page's own grouping (`groupPendingByLead`, over the queue's resolver). */
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
  /** sha256 hex of `body`, computed on the server; Yes posts it back so only the text shown is approved. */
  bodySha256?: string;
  draftBody: string;
  finalBody: string | null;
  createdAt: string | null;
  clientName: string | null;
  /** What the lead page's grouping calls it (`rebecca_brief`, `client_draft`, `other`), from the drafter's own marker. */
  payloadKind: string | null;
  /** From `routing.ts`, recomputed from the stored text on every read (an edit can make it attorney-only). */
  kind: QueueKind;
  attorneyOnly: boolean;
  reviewer: ReviewerItem[];
  /**
   * Why this card needs the full approval page instead of a Yes here (the deck's rule, `needsCloserLook`): a CHECK FIRST
   * line, a draft issue, a stale draft, a linked-proposal gate that refused) plus this page's own rule: a linked
   * proposal that isn't live yet (`leadCloserLook`). `null` = couldn't be checked, which also keeps Yes off this page.
   */
  closerLook: LeadCloserLook | null;
  /** The proposal the email carries a link to (the consult drafter's marker). */
  linked: LinkedProposalFact;
  /** Who holds the card now (the deck's hand-offs, folded with the deck's own trust rule). */
  handoff: HandoffFact;
};

/**
 * The card's hand-off state (lectual 0103 `queue_card_event`), folded with `trustedCardState` and `currentHolder`
 * exactly as the deck does. `unknown` (not set up, or the read failed) shows the card as it is today: no hand-off.
 */
/** A pending queue item named only by what a list needs: its id, headline and age. */
export type QueueRef = { id: string; headline: string; createdAt: string | null };

export type HandoffFact =
  | { status: "ok"; holder: { userId: string; by: string; note: string | null; at: string } | null }
  | { status: "unknown" };

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
  /**
   * Per assistant: on with this autonomy, or off. No row = off (the runner's rule). `null` = unknown: the read failed,
   * or it came back empty for a role that row-level security may not let read the settings (owner, admin and senior
   * admin manage them); an empty answer is then not proof that everything is off.
   */
  settings: Partial<Record<AgentId, { enabled: boolean; autonomy: Autonomy }>> | null;
  /** The firm's features, for the jobs that need one. */
  modules: { mailbox: boolean; proposals: boolean; agentToolkit: boolean };
  /**
   * The firm named at least one proposal approver (the post-consult drafter drafts proposals only then). `null` =
   * couldn't read, or no row came back for a role that may not be able to read it.
   */
  proposalApprovers: boolean | null;
  /** A Fathom or Zoom connection is active, so recordings are imported. `null` = couldn't read. */
  meetingSourceActive: boolean | null;
};

export type MarkersFact = { preppedEventIds: string[]; handledMeetingIds: string[]; outcomeLogged: boolean };

export type RoutingFacts = { status: "ok"; routing: ApprovalRouting; members: RoutingMember[] } | { status: "failed" };

export type LeadStepFacts = {
  /** The instant the page was drawn (ISO), and the firm's zone. Every date in the card is in that zone. */
  now: string;
  timeZone: string;
  lead: LeadFacts;
  viewer: ViewerFacts;
  routing: RoutingFacts;
  /**
   * The pending drafts for a yes: internal briefings left out, oldest first, the first ENRICH_CAP enriched. `total`
   * counts every one of them, so "N more waiting" is never cut short by the cap.
   */
  approvals: Read<{
    items: PendingDraft[];
    total: number;
    /** Every client-facing item for this lead, oldest first, uncapped (the "also waiting" list). Absent = derive from `items`. */
    refs?: QueueRef[];
    /** The internal briefings for this lead (never the card), oldest first. */
    briefings?: QueueRef[];
  }>;
  tasks: Read<OpenTask[]>;
  consult: Read<BookedConsult | null>;
  meetings: Read<MeetingFact[]>;
  proposal: Read<ProposalFact | null>;
  /** The lead's timeline rows across the merged set, newest first. `truncated`: the read hit its row cap. */
  activity: Read<{ rows: ActivityRow[]; truncated: boolean }>;
  /**
   * The assistants' own markers, read with targeted queries (never inferred from the capped timeline): which calendar
   * events consult prep handled, which recorded calls the consult drafter handled, and whether a person logged a
   * consult outcome.
   */
  markers: Read<MarkersFact>;
  jobs: Read<JobsFacts>;
};
