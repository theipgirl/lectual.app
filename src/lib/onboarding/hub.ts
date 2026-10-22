import { ROLES, type Role } from "@/lib/auth/roles";
import { visibleNav } from "@/lib/nav";
import { canApproveQueue } from "@/lib/queue/roles";
import { canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import type { TourSide } from "./tour";

/**
 * The Getting started hub: guided flows over the real screens. This file is the
 * catalog and its rules, kept pure so they are tested without a browser. A flow
 * only ever points at things and explains them; the one thing the hub writes is
 * the person's own progress flag (`user_metadata.lectual_hub`), which decides
 * whether a check is drawn and never what anyone may see or do.
 */
export const HUB_VERSION = 1;

/** The target for a step that is a centered card rather than a spotlight. */
export const HUB_CENTERED = "centered";

export type HubTrackId = "intake" | "consults" | "matters" | "approvals" | "admin";
export type HubRecordKind = "lead" | "matter";

export type HubStep = {
  id: string;
  /** A dashboard route. A record step uses `[id]`, filled with the chosen record's id. */
  path: string;
  /** A `data-tour` token, or HUB_CENTERED. */
  target: string;
  title: string;
  body: string;
  side?: TourSide;
  /** This step is on a lead's or matter's page and needs one to look at. */
  record?: HubRecordKind;
  /** What the person would see, shown as a centered card when there is no record to open. */
  unseen?: string;
};

type CatalogStep = HubStep & { bodyReadOnly?: string };

/** What a flow needs. Every named rail section must be visible to the person (the rail's own data). */
export type HubRequires = { nav: readonly string[]; admin?: boolean; ai?: boolean };

export type HubFlow = {
  id: string;
  track: HubTrackId;
  title: string;
  summary: string;
  requires: HubRequires;
  steps: HubStep[];
};

type CatalogFlow = Omit<HubFlow, "steps"> & { steps: CatalogStep[] };

export type HubTrack = { id: HubTrackId; title: string; summary: string; flows: HubFlow[] };

export const HUB_TRACKS: readonly { id: HubTrackId; title: string; summary: string }[] = [
  { id: "intake", title: "Intake", summary: "Leads, the board, forms and stages." },
  { id: "consults", title: "Consults to proposals", summary: "From a booked call to an accepted proposal." },
  { id: "matters", title: "Matters", summary: "Open matters, their pages, files and client updates." },
  { id: "approvals", title: "Approvals and agents", summary: "What waits for a person, and what drafts for you." },
  { id: "admin", title: "Admin", summary: "Setting up the firm, its people and its connections." },
];

const UNSEEN_LEAD = "There are no leads to open yet, so this guide cannot show one.";
const UNSEEN_MATTER = "There are no matters to open yet, so this guide cannot show one.";

const FLOWS: readonly CatalogFlow[] = [
  // ── Intake ──
  {
    id: "intake-leads",
    track: "intake",
    title: "Your leads and last touch",
    summary: "Where leads live and how to read the list.",
    requires: { nav: ["intake"] },
    steps: [
      {
        id: "rail",
        path: "/dashboard/intake/",
        target: "nav-intake",
        side: "right",
        title: "Intake lives here",
        body: "Every lead the firm is working starts in Intake. Open it from the rail whenever you want the list.",
      },
      {
        id: "list",
        path: "/dashboard/intake/",
        target: "intake-board",
        side: "top",
        title: "Sorted by last touch",
        body: "Each lead shows when the firm last touched it, so the ones going quiet are easy to spot. Open a lead to see its own page.",
      },
    ],
  },
  {
    id: "intake-board",
    track: "intake",
    title: "The board and moving a stage",
    summary: "Seeing leads by stage, and how a stage is changed.",
    requires: { nav: ["intake"] },
    steps: [
      {
        id: "board",
        path: "/dashboard/intake/",
        target: "intake-board",
        side: "top",
        title: "Leads by stage",
        body: "The same leads can be shown as a board, with one column for each stage. Use the view controls at the top of the page to switch.",
      },
      {
        id: "move",
        path: "/dashboard/intake/",
        target: "intake-board",
        side: "top",
        title: "Changing a stage",
        body: "Drag a lead's card to another column, or open the card's Move to stage menu, if your role allows changes. This guide does not move anything itself.",
      },
    ],
  },
  {
    id: "intake-lead",
    track: "intake",
    title: "A lead's page",
    summary: "Answers, files, consult details and the timeline.",
    requires: { nav: ["intake"] },
    steps: [
      {
        id: "head",
        path: "/dashboard/leads/[id]/",
        target: "lead-head",
        side: "bottom",
        record: "lead",
        unseen: `${UNSEEN_LEAD} A lead's page shows the answers the person gave, their files, any consult details and a timeline.`,
        title: "One page per lead",
        body: "The answers the person gave, their files and any consult details are on this page. Open any lead from Intake to see its own.",
      },
      {
        id: "timeline",
        path: "/dashboard/leads/[id]/",
        target: "lead-timeline",
        side: "top",
        record: "lead",
        unseen: `${UNSEEN_LEAD} The timeline lists notes, stage changes and mail the firm has on file for that lead.`,
        title: "The timeline",
        body: "Notes, stage changes and mail the firm has on file are added here, so you can see what happened and when.",
      },
    ],
  },
  {
    id: "intake-forms",
    track: "intake",
    title: "Intake forms and results",
    summary: "One form per event, campaign or page.",
    requires: { nav: ["forms"] },
    steps: [
      {
        id: "forms",
        path: "/dashboard/forms/",
        target: "forms-head",
        side: "bottom",
        title: "Intake forms",
        body: "Each event, campaign or page can have its own form and link. Open a form and use its Results tab to read what people answered.",
      },
    ],
  },
  {
    id: "intake-reconcile",
    track: "intake",
    title: "Reconcile stages",
    summary: "Compare leads' stages with your sheet, Lawmatics and mail.",
    requires: { nav: ["intake"], admin: true },
    steps: [
      {
        id: "reconcile",
        path: "/dashboard/intake/reconcile/",
        target: "reconcile-head",
        side: "bottom",
        title: "Reconcile stages",
        body: "Upload your sheet and Lectual compares each lead's stage with it, with Lawmatics and with the mail on file. You choose which leads to move; nothing moves until you do.",
      },
    ],
  },

  // ── Consults to proposals ──
  {
    id: "consults-calendar",
    track: "consults",
    title: "Calendar and consults",
    summary: "Where booked consults show up.",
    requires: { nav: ["calendar"] },
    steps: [
      {
        id: "calendar",
        path: "/dashboard/calendar/",
        target: "calendar-head",
        side: "bottom",
        title: "Calendar",
        body: "Consults from a connected calendar appear here, tied to the lead when an attendee's email matches.",
      },
    ],
  },
  {
    id: "consults-prep",
    track: "consults",
    title: "Prep a consult",
    summary: "The prep panel on a lead's page.",
    requires: { nav: ["intake", "skills"] },
    steps: [
      {
        id: "prep",
        path: "/dashboard/leads/[id]/",
        target: "lead-prep",
        side: "top",
        record: "lead",
        unseen: `${UNSEEN_LEAD} A lead's page has a Prep this consult panel for roles that can edit leads.`,
        title: "Prep this consult",
        body: "Open this panel on a lead to prepare for the call. What it produces is for you to review. If the panel is not on your lead pages, it is not switched on for your role or firm.",
      },
    ],
  },
  {
    id: "consults-proposal",
    track: "consults",
    title: "A proposal from a lead",
    summary: "Pick a lead and the client fills in.",
    requires: { nav: ["proposals"] },
    steps: [
      {
        id: "picker",
        path: "/dashboard/proposals/new/",
        target: "proposal-new-head",
        side: "bottom",
        title: "Who is this for?",
        body: "Pick a lead or a matter and the client and brand names fill in. You choose the package, and the prices come from that package, never from the record.",
      },
    ],
  },
  {
    id: "consults-accepted",
    track: "consults",
    title: "After a client accepts",
    summary: "Marking paid and the engagement letter draft.",
    requires: { nav: ["proposals"] },
    steps: [
      {
        id: "list",
        path: "/dashboard/proposals/",
        target: "proposals-head",
        side: "bottom",
        title: "Proposals and their status",
        body: "Open an accepted proposal to mark it paid. Marking it paid can queue the engagement letter draft in the approval queue. Nothing is sent to the client from here.",
      },
    ],
  },
  {
    id: "consults-meetings",
    track: "consults",
    title: "Meetings and follow-ups",
    summary: "Recorded calls and drafting a follow-up.",
    requires: { nav: ["meetings"] },
    steps: [
      {
        id: "meetings",
        path: "/dashboard/meetings/",
        target: "meetings-head",
        side: "bottom",
        title: "Recorded meetings",
        body: "Calls recorded in Fathom or Zoom are listed here. Link one to a lead or matter and, where the Agents module is on, draft a follow-up for the approval queue.",
      },
    ],
  },

  // ── Matters ──
  {
    id: "matters-list",
    track: "matters",
    title: "Matters list and board",
    summary: "Every open matter in one place.",
    requires: { nav: ["matters"] },
    steps: [
      {
        id: "rail",
        path: "/dashboard/matters/",
        target: "nav-matters",
        side: "right",
        title: "Matters",
        body: "Open matters are reached from the rail, with their stage, deadlines and activity.",
      },
      {
        id: "list",
        path: "/dashboard/matters/",
        target: "matters-head",
        side: "bottom",
        title: "The matters list",
        body: "Search and filter here, then open a matter to see everything about it.",
      },
    ],
  },
  {
    id: "matters-page",
    track: "matters",
    title: "A matter's page",
    summary: "Deadlines, tasks, the client and notes.",
    requires: { nav: ["matters"] },
    steps: [
      {
        id: "head",
        path: "/dashboard/matters/[id]/",
        target: "matter-head",
        side: "bottom",
        record: "matter",
        unseen: `${UNSEEN_MATTER} A matter's page holds its deadlines, tasks, the client's contact details and notes.`,
        title: "One page per matter",
        body: "The matter's stage, client contact, tasks and notes are all on this page.",
      },
      {
        id: "deadlines",
        path: "/dashboard/matters/[id]/",
        target: "matter-deadlines",
        side: "top",
        record: "matter",
        unseen: `${UNSEEN_MATTER} Deadlines are listed on the matter's page.`,
        title: "Deadlines",
        body: "Deadlines for this matter are listed here. A deadline that needs a person to confirm it is marked for review.",
      },
    ],
  },
  {
    id: "matters-files",
    track: "matters",
    title: "Documents and files",
    summary: "Stored files and generated letters.",
    requires: { nav: ["matters"] },
    steps: [
      {
        id: "files",
        path: "/dashboard/matters/[id]/",
        target: "matter-aside",
        side: "left",
        record: "matter",
        unseen: `${UNSEEN_MATTER} A matter's page lists its stored files and generated letters.`,
        title: "Documents and files",
        body: "Stored files and generated letters are listed in the side column. Files stay inside the firm; nothing here is shared with a client.",
      },
    ],
  },
  {
    id: "matters-updates",
    track: "matters",
    title: "Client updates",
    summary: "Drafting a welcome or filing follow-up.",
    requires: { nav: ["matters", "skills"] },
    steps: [
      {
        id: "updates",
        path: "/dashboard/matters/[id]/",
        target: "matter-updates",
        side: "top",
        record: "matter",
        unseen: `${UNSEEN_MATTER} A trademark matter's page has a Client updates section for welcome and filing follow-up drafts.`,
        title: "Client updates",
        body: "On a trademark matter this section is where a welcome or filing follow-up is prepared for review. If it is not on your matter pages, it is not switched on for your role or this matter.",
      },
    ],
  },

  // ── Approvals and agents ──
  {
    id: "approvals-queue",
    track: "approvals",
    title: "The approval queue",
    summary: "Where drafts wait for a person.",
    requires: { nav: ["queue"] },
    steps: [
      {
        id: "rail",
        path: "/dashboard/queue/",
        target: "nav-queue",
        side: "right",
        title: "Queue",
        body: "The number on the Queue entry is how many drafts are waiting.",
      },
      {
        id: "queue",
        path: "/dashboard/queue/",
        target: "queue-head",
        side: "bottom",
        title: "Approval queue",
        body: "Review each draft, edit it if it needs it, then approve or reject it. Nothing goes to a client until someone approves it.",
        bodyReadOnly: "You can look at the drafts waiting here, but approving them is for others. Nothing goes to a client until someone approves it.",
      },
    ],
  },
  {
    id: "approvals-agents",
    track: "approvals",
    title: "Agents",
    summary: "What each agent drafts, Run now and Autopilot.",
    requires: { nav: ["agents"] },
    steps: [
      {
        id: "agents",
        path: "/dashboard/agents/",
        target: "agents-head",
        side: "bottom",
        title: "Agents draft, people decide",
        body: "Each agent drafts into the approval queue or writes an internal note. Run now runs one agent when your role allows it, and Autopilot can be paused to stop them all.",
      },
    ],
  },
  {
    id: "approvals-copilot",
    track: "approvals",
    title: "AI copilot",
    summary: "Ask a question about your matters and leads.",
    requires: { nav: ["copilot"], ai: true },
    steps: [
      {
        id: "copilot",
        path: "/dashboard/",
        target: "copilot",
        side: "left",
        title: "Ask the copilot",
        body: "Ask about your matters, leads or deadlines. It reads your records and changes nothing. Press Command-J (Ctrl-J elsewhere) to open it from any page.",
      },
    ],
  },
  {
    id: "approvals-bell",
    track: "approvals",
    title: "Notifications",
    summary: "How you hear that something needs you.",
    requires: { nav: [""] },
    steps: [
      {
        id: "bell",
        path: "/dashboard/",
        target: "bell",
        side: "bottom",
        title: "The bell",
        body: "Updates for you, such as a proposal being accepted or a draft needing review, show up here and stay inside Lectual. A client never sees them.",
      },
    ],
  },

  // ── Admin ──
  {
    id: "admin-setup",
    track: "admin",
    title: "The setup checklist",
    summary: "What is left to switch on.",
    requires: { nav: ["settings"], admin: true },
    steps: [
      {
        id: "setup",
        path: SETUP_PATH,
        target: "setup-head",
        side: "bottom",
        title: "Get your firm set up",
        body: "The checklist is worked out from your firm's real settings. Each item links to the page where it is done.",
      },
    ],
  },
  {
    id: "admin-integrations",
    track: "admin",
    title: "Integrations",
    summary: "Connecting mail, Lawmatics, LawPay and meetings.",
    requires: { nav: ["settings"], admin: true },
    steps: [
      {
        id: "integrations",
        path: "/dashboard/settings/integrations/",
        target: "integrations-head",
        side: "bottom",
        title: "Integrations",
        body: "Each connection belongs to your firm's own account. A card tells you whether it is connected and what to do next.",
      },
    ],
  },
  {
    id: "admin-team",
    track: "admin",
    title: "Team and roles",
    summary: "Inviting people and choosing roles.",
    requires: { nav: ["settings"], admin: true },
    steps: [
      {
        id: "team",
        path: "/dashboard/settings/team/",
        target: "team-head",
        side: "bottom",
        title: "Team and roles",
        body: "Invite people and choose a role for each. A role decides what a person can see and do; a viewer can look but not change anything.",
      },
    ],
  },
  {
    id: "admin-modules",
    track: "admin",
    title: "Modules",
    summary: "Which features the firm has switched on.",
    requires: { nav: ["settings"], admin: true },
    steps: [
      {
        id: "modules",
        path: "/dashboard/settings/modules/",
        target: "modules-head",
        side: "bottom",
        title: "Modules",
        body: "Some sections only exist for a firm that has their module on. A section whose module is off does not appear in the rail.",
      },
    ],
  },
  {
    id: "admin-firm",
    track: "admin",
    title: "Firm profile and sign-off",
    summary: "The name, time zone and sign-off drafts use.",
    requires: { nav: ["settings"], admin: true },
    steps: [
      {
        id: "firm",
        path: "/dashboard/settings/firm/",
        target: "firm-head",
        side: "bottom",
        title: "Firm profile",
        body: "Your display name, time zone and the sign-off that drafts put at the end of an email.",
      },
    ],
  },
];

const FLOW_IDS = new Set(FLOWS.map((f) => f.id));

export function isHubFlowId(value: unknown): value is string {
  return typeof value === "string" && FLOW_IDS.has(value);
}

export function allHubFlowIds(): string[] {
  return FLOWS.map((f) => f.id);
}

// ── who sees what ──────────────────────────────────────────────────────

export type HubContext = {
  role: string;
  /** `null` = the module list could not be read: treated as none, and the page says so. */
  modules: readonly string[] | null;
  aiConfigured: boolean;
};

function isKnownRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

/** Read-only wording: a viewer, a social-media role and any role this app does not know. */
export function hubReadOnly(role: string): boolean {
  return !isKnownRole(role) || role === "viewer" || role === "social_media";
}

export function hubApproves(role: string): boolean {
  return isKnownRole(role) && canApproveQueue(role);
}

/** The rail sections this person sees. An unknown role sees none, so no gated flow can leak to it. */
function visibleSlugs(ctx: HubContext): Set<string> {
  if (!isKnownRole(ctx.role)) return new Set();
  return new Set(visibleNav(ctx.modules ?? [], ctx.role).map((i) => i.slug));
}

function flowVisible(flow: CatalogFlow, ctx: HubContext, slugs: Set<string>): boolean {
  if (flow.requires.admin && !canSeeSetup(ctx.role)) return false;
  if (flow.requires.ai && !ctx.aiConfigured) return false;
  return flow.requires.nav.every((slug) => slugs.has(slug));
}

function resolveFlow(flow: CatalogFlow, ctx: HubContext): HubFlow {
  const readOnly = hubReadOnly(ctx.role);
  const steps = flow.steps.map(({ bodyReadOnly, ...step }) => ({ ...step, body: readOnly && bodyReadOnly ? bodyReadOnly : step.body }));
  return { ...flow, steps };
}

/**
 * The tracks this person sees: flows dropped when their section, module or
 * role does not apply (module gates fail closed), and a track with no flow left
 * is dropped, never shown as "0 of 0".
 */
export function hubTracks(ctx: HubContext): HubTrack[] {
  const slugs = visibleSlugs(ctx);
  const flows = FLOWS.filter((f) => flowVisible(f, ctx, slugs)).map((f) => resolveFlow(f, ctx));
  return HUB_TRACKS.map((t) => ({ ...t, flows: flows.filter((f) => f.track === t.id) })).filter((t) => t.flows.length > 0);
}

export function visibleFlows(ctx: HubContext): HubFlow[] {
  return hubTracks(ctx).flatMap((t) => t.flows);
}

export function findVisibleFlow(ctx: HubContext, flowId: string): HubFlow | null {
  return visibleFlows(ctx).find((f) => f.id === flowId) ?? null;
}

/** Every catalog step, as written, for tests that check paths, targets and copy. */
export function allHubSteps(): HubStep[] {
  return FLOWS.flatMap((f) => f.steps.flatMap(({ bodyReadOnly, ...s }) => [s, ...(bodyReadOnly ? [{ ...s, body: bodyReadOnly }] : [])]));
}

// ── progress ───────────────────────────────────────────────────────────

export type HubProgress = { done: string[]; hiddenCard: boolean };
export type HubMeta = { version: number; done: string[]; hidden_card?: boolean };

export const EMPTY_PROGRESS: HubProgress = { done: [], hiddenCard: false };

/** Reads `user_metadata.lectual_hub`. Anything missing, malformed or from another version reads as empty; unknown or repeated ids are dropped. */
export function parseHubProgress(userMetadata: unknown): HubProgress {
  if (typeof userMetadata !== "object" || userMetadata === null) return EMPTY_PROGRESS;
  const stored = (userMetadata as Record<string, unknown>).lectual_hub;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY_PROGRESS;
  const record = stored as Record<string, unknown>;
  if (record.version !== HUB_VERSION) return EMPTY_PROGRESS;
  const done = Array.isArray(record.done) ? [...new Set(record.done.filter(isHubFlowId))] : [];
  return { done, hiddenCard: record.hidden_card === true };
}

export function buildHubMeta(progress: HubProgress): HubMeta {
  return { version: HUB_VERSION, done: [...progress.done], ...(progress.hiddenCard ? { hidden_card: true } : {}) };
}

/** Adds a flow id once. */
export function markFlowDone(progress: HubProgress, flowId: string): HubProgress {
  if (!isHubFlowId(flowId) || progress.done.includes(flowId)) return progress;
  return { ...progress, done: [...progress.done, flowId] };
}

/** Reset empties `done` and also clears the hidden card, so the card comes back. */
export function resetProgress(): HubProgress {
  return { done: [], hiddenCard: false };
}

export function hideCard(progress: HubProgress): HubProgress {
  return { ...progress, hiddenCard: true };
}

/**
 * Local progress kept for the session when a save fails: the union of what the
 * server has and what this browser finished, so a failed write shows nothing
 * alarming and loses nothing until the next sign-in.
 */
export function mergeLocalDone(serverDone: readonly string[], localDone: readonly string[]): string[] {
  return [...new Set([...serverDone, ...localDone].filter(isHubFlowId))];
}

export type TrackCount = { id: HubTrackId; done: number; total: number };

/** "N of M" per track, counting only flows the person can see. */
export function trackCounts(tracks: readonly HubTrack[], done: readonly string[]): TrackCount[] {
  const set = new Set(done);
  return tracks.map((t) => ({ id: t.id, total: t.flows.length, done: t.flows.filter((f) => set.has(f.id)).length }));
}

export function overallCount(tracks: readonly HubTrack[], done: readonly string[]): { done: number; total: number } {
  const counts = trackCounts(tracks, done);
  return { done: counts.reduce((n, c) => n + c.done, 0), total: counts.reduce((n, c) => n + c.total, 0) };
}

/** The Today card shows while something visible is left, and until the person hides it. */
export function shouldShowHubCard(tracks: readonly HubTrack[], progress: HubProgress): boolean {
  if (progress.hiddenCard) return false;
  const { done, total } = overallCount(tracks, progress.done);
  return total > 0 && done < total;
}

// ── reset confirmation ─────────────────────────────────────────────────

export type ResetState = "idle" | "confirming";
export type ResetEvent = "ask" | "confirm" | "cancel";

/** Reset asks first: only `confirm` from the confirming state runs the action. */
export function stepReset(state: ResetState, event: ResetEvent): { state: ResetState; run: boolean } {
  if (event === "ask") return { state: "confirming", run: false };
  if (event === "confirm" && state === "confirming") return { state: "idle", run: true };
  return { state: "idle", run: false };
}

// ── record steps ───────────────────────────────────────────────────────

export type RecordPick = { status: "ok"; id: string } | { status: "none" } | { status: "unavailable" };

/** The first row of an already-ordered list, as a three-state pick. */
export function pickFirstRecord(read: { ok: true; rows: readonly { id: string }[] } | { ok: false }): RecordPick {
  if (!read.ok) return { status: "unavailable" };
  const first = read.rows[0];
  return first && typeof first.id === "string" && first.id ? { status: "ok", id: first.id } : { status: "none" };
}

export const HUB_PATH = "/dashboard/getting-started/";
