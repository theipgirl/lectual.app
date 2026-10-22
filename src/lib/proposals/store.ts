import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { changedColumns, contentChanges, type EditableColumn } from "./diff";
import { friendlyProposalError, ProposalError } from "./errors";
import { defaultSelection, quoteProposal } from "./pricing";
import { PROPOSAL_STEPS, paidStateFromEvents, readStep, type PaidState, type StepEventInput, type StepPayload } from "./paid";
import { offeredPackages, type OfferedPackage } from "./segments";
import {
  PROPOSAL_ADMIN_ROLES,
  PROPOSAL_STAFF_WRITE_ROLES,
  isProposalEditable,
  type AcceptedSnapshot,
  type ProposalChange,
  type ProposalContent,
  type ProposalEditedPayload,
  type ProposalEventActor,
  type ProposalEventRow,
  type ProposalEventType,
  type ProposalPackageBasis,
  type ProposalRow,
  type ProposalSettingRow,
  type ProposalSource,
  type ProposalStatus,
} from "./types";
import { MAX_CONTENT_BYTES, hasErrors, isCivilDate, isPlausibleEmail, validateContent, validateSettingInput } from "./validate";

/**
 * The proposal data layer — every read and write the signed-in firm makes.
 *
 * ── EVERY CALL GOES THROUGH THE CALLER'S OWN SCOPED CLIENT ──────────────────
 * No service-role client in this file (the client's own link is `public.ts`,
 * the one exception). `getScopedClient()` is called fresh in every exported
 * function, so each query carries the caller's `active_org_id` and RLS is the
 * real boundary. `org_id` on an INSERT is read from `current_org_id()`, never
 * from caller input. The role checks below are the friendly refusal that
 * mirrors the 0089 policy lists; they are not the boundary.
 *
 * ── WHAT THE DATABASE DOES, SO THIS FILE DOES NOT ───────────────────────────
 * The 0089 BEFORE UPDATE trigger owns the lifecycle: it freezes sent / accepted
 * / superseded / withdrawn rows, silently returns an edited APPROVED row to
 * draft, allows only the legal status moves, lets only a named approver reach
 * `approved` (stamping approved_by / approved_at), and stamps updated_at /
 * updated_by. An AFTER trigger writes the status events (created, approved,
 * unapproved, sent, superseded, accepted, withdrawn). So this file:
 *   - never stamps approval or timestamps itself;
 *   - never writes a status event (it would duplicate the trigger's);
 *   - writes only the events the trigger cannot know about: `edited` (with what
 *     changed and the legal total before / after), `revised`, and `viewed`
 *     (public.ts).
 * It still reads the row first and fences each write on the status it read, so
 * the refusal a person sees is a sentence ("already sent, create a revision")
 * and not a trigger exception.
 *
 * ── EVENT ORDERING ──────────────────────────────────────────────────────────
 * `edited` and `revised` are supplementary audit lines: the mutation is the
 * record, and a broken audit table must never block a staff member correcting
 * a typo. They are written AFTER the change and their failure is swallowed
 * (the same judgement as `writeQuoteEventSafe`). The lifecycle events that
 * matter (approved, sent, accepted ...) come from the trigger in the same
 * transaction as the status change, so they cannot be missing.
 *
 * ── THE `ProposalsDbClient` CAST ────────────────────────────────────────────
 * The generated `Database` type has no 0089 tables until a project they are
 * applied to can regenerate it. `proposalsDb()` casts the SAME connection to a
 * narrow structural interface once, as `quotesDb()` does.
 */

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/* ─────────────────────────── the untyped client shape ───────────────────── */

export type ProposalsDbError = { code?: string; message?: string } | null;
export type ProposalsDbResult<T = unknown> = { data: T; error: ProposalsDbError };

export interface ProposalsDbQuery<T = unknown> extends PromiseLike<ProposalsDbResult<T>> {
  select(columns?: string): ProposalsDbQuery<T>;
  insert(rows: unknown): ProposalsDbQuery<T>;
  update(patch: unknown): ProposalsDbQuery<T>;
  upsert(rows: unknown, options?: { onConflict?: string }): ProposalsDbQuery<T>;
  eq(column: string, value: unknown): ProposalsDbQuery<T>;
  in(column: string, values: readonly unknown[]): ProposalsDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ProposalsDbQuery<T>;
  limit(count: number): ProposalsDbQuery<T>;
  single(): PromiseLike<ProposalsDbResult<T>>;
  maybeSingle(): PromiseLike<ProposalsDbResult<T>>;
}

export interface ProposalsDbClient {
  from(table: string): ProposalsDbQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<ProposalsDbResult<unknown>>;
}

/** The caller's own RLS-scoped client, seen through the 0089 table shapes. */
export function proposalsDb(supabase: ScopedClient): ProposalsDbClient {
  return supabase as unknown as ProposalsDbClient;
}

/* ─────────────────────────── columns ─────────────────────────────────────── */

/** Every column of `client_proposal`, named (never `select('*')`). */
const PROPOSAL_COLUMNS = [
  "id",
  "org_id",
  "family_id",
  "version",
  "public_token",
  "lead_id",
  "matter_id",
  "client_name",
  "client_email",
  "title",
  "status",
  "content",
  "expires_on",
  "pay_url",
  "source",
  "created_by",
  "updated_by",
  "approved_by",
  "approved_at",
  "sent_at",
  "accepted_at",
  "superseded_at",
  "withdrawn_at",
  "accepted_selection",
  "accepted_snapshot",
  "created_at",
  "updated_at",
].join(", ");

const LIST_COLUMNS = [
  "id",
  "family_id",
  "version",
  "client_name",
  "client_email",
  "title",
  "status",
  "content",
  "expires_on",
  "pay_url",
  "source",
  "lead_id",
  "matter_id",
  "approved_at",
  "sent_at",
  "accepted_at",
  "accepted_snapshot",
  "created_at",
  "updated_at",
].join(", ");

const VERSION_COLUMNS = "id, version, status, source, created_at, updated_at, approved_at, sent_at, accepted_at, superseded_at, withdrawn_at";
const EVENT_COLUMNS = "id, org_id, proposal_id, family_id, type, actor, actor_user_id, payload, created_at";
const SETTING_COLUMNS = "org_id, approver_user_ids, default_pay_url, notify_email, pricing, updated_by, created_at, updated_at";

/* ─────────────────────────── role gates ──────────────────────────────────── */

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

async function requireRole(supabase: ScopedClient, allowed: Role[], what: string): Promise<Role> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw friendlyProposalError(error, what);
  if (!isRole(data) || !allowed.includes(data)) {
    throw new ProposalError("forbidden", `You don't have permission to ${what}.`);
  }
  return data;
}

/** Staff roles from the 0089 insert/update policies. Re-checked on every call. */
export function requireProposalWriteRole(supabase: ScopedClient): Promise<Role> {
  return requireRole(supabase, PROPOSAL_STAFF_WRITE_ROLES, "write proposals");
}

/** Owner / admin / senior_admin: the firm's proposal settings. */
export function requireProposalAdminRole(supabase: ScopedClient): Promise<Role> {
  return requireRole(supabase, PROPOSAL_ADMIN_ROLES, "change the proposal settings");
}

async function currentOrgId(supabase: ScopedClient): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw friendlyProposalError(error);
  if (!data) throw new ProposalError("unavailable", "No active organization for the current session.");
  return data;
}

async function currentUserId(supabase: ScopedClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/* ─────────────────────────── public token ────────────────────────────────── */

/**
 * 32 random bytes as unpadded base64url: 43 characters, inside 0089's 32..64
 * check. Generated here, server-side, only; one token is shared by every
 * version of a family, so a client's link keeps working across revisions.
 */
export function generateProposalToken(): string {
  return randomBytes(32).toString("base64url");
}

/* ─────────────────────────── pure helpers ────────────────────────────────── */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new ProposalError("not_found", "Proposal not found.");
  }
}

/** The legal and USPTO totals of a content document at the firm's own preselected offer. */
export function offerTotals(content: ProposalContent): { legal_total_cents: number; gov_total_cents: number } {
  const quote = quoteProposal(content, defaultSelection(content));
  return { legal_total_cents: quote.legal_total_cents, gov_total_cents: quote.gov_total_cents };
}

/** Plain-column checks that a draft must still pass (everything else is reported, not refused). */
export function checkDraftColumns(input: {
  clientName?: string;
  clientEmail?: string | null;
  title?: string;
  expiresOn?: string | null;
  payUrl?: string | null;
  content?: unknown;
}): void {
  if (input.clientName !== undefined) {
    const n = input.clientName.trim();
    if (n.length < 1 || n.length > 300) throw new ProposalError("validation", "A proposal needs a client name of 1-300 characters.");
  }
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (t.length < 1 || t.length > 300) throw new ProposalError("validation", "A proposal needs a title of 1-300 characters.");
  }
  if (input.clientEmail) {
    if (!isPlausibleEmail(input.clientEmail.trim())) throw new ProposalError("validation", "That client email address doesn't look right.");
  }
  if (input.expiresOn) {
    if (!isCivilDate(input.expiresOn)) throw new ProposalError("validation", "Pick a real expiry date.");
  }
  if (input.payUrl) {
    const issues = validateContent({}, { pay_url: input.payUrl }).filter((i) => i.path === "pay_url");
    if (issues.length > 0) throw new ProposalError("validation", issues[0].message, issues);
  }
  if (input.content !== undefined) {
    if (!input.content || typeof input.content !== "object" || Array.isArray(input.content)) {
      throw new ProposalError("validation", "The proposal has no content.");
    }
    let size = 0;
    try {
      size = JSON.stringify(input.content).length;
    } catch {
      throw new ProposalError("validation", "The proposal content could not be read.");
    }
    if (size > MAX_CONTENT_BYTES) throw new ProposalError("validation", "The proposal is too large to save (256KB at most).");
  }
}

const COLUMN_LABEL: Partial<Record<EditableColumn, string>> = {
  client_name: "Client name",
  client_email: "Client email",
  title: "Title",
  expires_on: "Expiry date",
  pay_url: "Pay link",
  lead_id: "Linked lead",
  matter_id: "Linked matter",
};

/** `edited` payload changes: content differences first, then plain-column ones. Capped. */
export function buildChanges(
  before: Pick<ProposalRow, EditableColumn>,
  after: Pick<ProposalRow, EditableColumn>,
  columns: readonly EditableColumn[],
): ProposalChange[] {
  const changes: ProposalChange[] = [];
  if (columns.includes("content")) changes.push(...contentChanges(before.content, after.content));
  for (const col of columns) {
    if (col === "content") continue;
    changes.push({
      path: col,
      label: COLUMN_LABEL[col] ?? col,
      format: "text",
      before: (before[col] as string | null) ?? null,
      after: (after[col] as string | null) ?? null,
    });
  }
  return changes.slice(0, 60);
}

/* ─────────────────────────── events ──────────────────────────────────────── */

/**
 * The events this app writes (the trigger writes the status ones). Swallowed:
 * see the header. The caller's org is read off the proposal row, never taken
 * from input.
 */
async function writeProposalEventSafe(
  db: ProposalsDbClient,
  proposal: Pick<ProposalRow, "id" | "org_id" | "family_id">,
  type: ProposalEventType,
  actor: ProposalEventActor,
  actorUserId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeProposalEventChecked(db, proposal, type, actor, actorUserId, payload);
}

/**
 * The same write, and it says whether the line landed. For the Sprint 19 steps, whose
 * timeline entry is the record itself (the paid mark IS its event): "the step ran but its
 * log line did not land" is something the person is told, not something swallowed.
 */
async function writeProposalEventChecked(
  db: ProposalsDbClient,
  proposal: Pick<ProposalRow, "id" | "org_id" | "family_id">,
  type: ProposalEventType,
  actor: ProposalEventActor,
  actorUserId: string | null,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await db.from("client_proposal_event").insert({
      org_id: proposal.org_id,
      proposal_id: proposal.id,
      family_id: proposal.family_id,
      type,
      actor,
      actor_user_id: actorUserId,
      payload,
    });
    if (error) console.error(`[proposals] failed to record ${type} event proposal=${proposal.id}`, error.code);
    return !error;
  } catch (err) {
    console.error(`[proposals] failed to record ${type} event proposal=${proposal.id}`, err);
    return false;
  }
}

/* ─────────────────────────── paid, and the follow-up steps (Sprint 19) ──── */

/**
 * Writes one step as a staff `edited` event for the signed-in user (the only kind of event
 * 0089 lets staff insert), and returns whether it landed. No user, no write: a step is never
 * recorded without someone to attribute it to. The org and family are read off the proposal
 * row the caller loaded through its own scoped client.
 */
export async function recordProposalStep(proposal: Pick<ProposalRow, "id" | "org_id" | "family_id">, payload: StepPayload): Promise<boolean> {
  const supabase = await getScopedClient();
  const userId = await currentUserId(supabase);
  if (!userId) return false;
  return writeProposalEventChecked(proposalsDb(supabase), proposal, "edited", "staff", userId, payload);
}

/** One version by id, through the caller's own scoped client. Null when it isn't visible to this firm (or the id is malformed). Throws on a failed read. */
export async function getProposalRow(id: string): Promise<ProposalRow | null> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  const supabase = await getScopedClient();
  const { data, error } = await proposalsDb(supabase).from("client_proposal").select(PROPOSAL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw friendlyProposalError(error, "load the proposal");
  return (data as ProposalRow | null) ?? null;
}

export type ProposalStepEvent = StepEventInput & { proposal_id: string; actor: string; actor_user_id: string | null };
export type StepEventsRead = { ok: true; events: ProposalStepEvent[] } | { ok: false };

/**
 * The step events of one version, newest first. Two-way on purpose: `{ ok: false }` is a
 * read that failed, which the page shows as "Paid status couldn't be read", never as "Not paid".
 */
export async function listProposalStepEvents(proposalId: string): Promise<StepEventsRead> {
  if (typeof proposalId !== "string" || !UUID_PATTERN.test(proposalId)) return { ok: false };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await proposalsDb(supabase)
      .from("client_proposal_event")
      .select("proposal_id, type, actor, actor_user_id, payload, created_at")
      .eq("proposal_id", proposalId)
      .in("payload->>step", PROPOSAL_STEPS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false };
    return { ok: true, events: (Array.isArray(data) ? data : []) as ProposalStepEvent[] };
  } catch {
    return { ok: false };
  }
}

export type StepActivity = {
  paid: PaidState;
  /** The newest step event (any step), for the list's Last activity cell; null when there is none. */
  newest: { payload: unknown; created_at: string; actor: string; actor_user_id: string | null } | null;
};

/**
 * Paid state and newest step event for each listed version. Named columns, chunked
 * `in(...)`, THROWS when a read fails: the list shows "Couldn't read", it never treats a
 * failure as "Not paid".
 */
export async function listStepActivity(proposalIds: readonly string[]): Promise<Map<string, StepActivity>> {
  const out = new Map<string, StepActivity>();
  const ids = [...new Set(proposalIds)].filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 0) return out;
  const supabase = await getScopedClient();
  const db = proposalsDb(supabase);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += EVENT_ID_CHUNK) chunks.push(ids.slice(i, i + EVENT_ID_CHUNK));
  const reads = await Promise.all(
    chunks.map((chunk) =>
      db
        .from("client_proposal_event")
        .select("proposal_id, type, actor, actor_user_id, payload, created_at")
        .in("proposal_id", chunk)
        .in("payload->>step", PROPOSAL_STEPS)
        .order("created_at", { ascending: false })
        .limit(500),
    ),
  );
  const byProposal = new Map<string, ProposalStepEvent[]>();
  for (const { data, error } of reads) {
    if (error) throw friendlyProposalError(error, "load the paid status");
    for (const row of (Array.isArray(data) ? data : []) as ProposalStepEvent[]) {
      byProposal.set(row.proposal_id, [...(byProposal.get(row.proposal_id) ?? []), row]);
    }
  }
  for (const id of ids) {
    const events = byProposal.get(id) ?? [];
    const newest = events
      .filter((e) => readStep(e.payload))
      .reduce<ProposalStepEvent | null>((best, e) => (!best || e.created_at > best.created_at ? e : best), null);
    out.set(id, {
      paid: paidStateFromEvents(events),
      newest: newest ? { payload: newest.payload, created_at: newest.created_at, actor: newest.actor, actor_user_id: newest.actor_user_id } : null,
    });
  }
  return out;
}

async function loadRow(db: ProposalsDbClient, id: string): Promise<ProposalRow> {
  assertId(id);
  const { data, error } = await db.from("client_proposal").select(PROPOSAL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw friendlyProposalError(error, "load the proposal");
  if (!data) throw new ProposalError("not_found", "Proposal not found.");
  return data as ProposalRow;
}

/* ─────────────────────────── reads ───────────────────────────────────────── */

export type ProposalListItem = {
  id: string;
  family_id: string;
  version: number;
  client_name: string;
  title: string;
  status: ProposalStatus;
  source: ProposalSource;
  expires_on: string | null;
  lead_id: string | null;
  matter_id: string | null;
  approved_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  /** Brand names in content order, for the list's title line. */
  brands: string[];
  /** The packages this offer names (see `offeredPackages`); none when the package name is blank. */
  offered: OfferedPackage[];
  /** Classes in the quote: the ones the client accepted, else the pre-ticked ones. */
  class_count: number;
  /** The package the client accepted, once accepted. */
  signed_package: string | null;
  /** The staff-only "edited from <package>" note (`content.package_basis`), or null. */
  package_basis: ProposalPackageBasis | null;
  /** What the client pays now: the accepted total once accepted, else the firm's preselected offer. */
  legal_total_cents: number;
  /** USPTO fees, due at filing. */
  gov_total_cents: number;
  /**
   * The first rule break that would refuse approval, for a draft or approved
   * row; null when there is none (and for every other status). The list shows
   * "Blocked" from it.
   */
  blocking_issue: string | null;
};

export type ProposalListOptions = {
  /** Collapse each family to its newest version. Default true. */
  latestOnly?: boolean;
  status?: ProposalStatus;
  leadId?: string;
  matterId?: string;
  /** Rows read (not families returned). Default 200, max 500. */
  limit?: number;
};

export async function listProposals(options: ProposalListOptions = {}): Promise<ProposalListItem[]> {
  const supabase = await getScopedClient();
  const db = proposalsDb(supabase);
  const limit = Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)));

  let query = db.from("client_proposal").select(LIST_COLUMNS);
  if (options.status) query = query.eq("status", options.status);
  if (options.leadId) query = query.eq("lead_id", options.leadId);
  if (options.matterId) query = query.eq("matter_id", options.matterId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw friendlyProposalError(error, "load the proposals");

  const rows = (Array.isArray(data) ? data : []) as Array<
    Omit<
      ProposalListItem,
      "legal_total_cents" | "gov_total_cents" | "blocking_issue" | "brands" | "offered" | "class_count" | "signed_package" | "package_basis"
    > & {
      client_email: string | null;
      pay_url: string | null;
      content: ProposalContent;
      accepted_snapshot: AcceptedSnapshot | null;
    }
  >;

  let kept = rows;
  if (options.latestOnly !== false) {
    const newest = new Map<string, number>();
    for (const r of rows) newest.set(r.family_id, Math.max(newest.get(r.family_id) ?? 0, r.version));
    kept = rows.filter((r) => newest.get(r.family_id) === r.version);
  }

  return kept.map(({ content, accepted_snapshot, client_email, pay_url, ...rest }) => {
    const accepted = accepted_snapshot?.quote;
    const quote = accepted ?? quoteProposal(content, defaultSelection(content));
    const totals = { legal_total_cents: quote.legal_total_cents, gov_total_cents: quote.gov_total_cents };
    const names = Array.isArray(content?.names) ? content.names : [];
    const basis = content?.package_basis;
    const signedPackage = accepted_snapshot?.content?.pricing?.package;
    // Only a row that can still be approved can be blocked from approval.
    const blocking_issue =
      rest.status === "draft" || rest.status === "approved"
        ? (validateContent(content, { forApproval: true, title: rest.title, expires_on: rest.expires_on, pay_url, client_email }).find(
            (i) => i.level === "error",
          )?.message ?? null)
        : null;
    return {
      ...rest,
      ...totals,
      blocking_issue,
      brands: names.map((n) => (typeof n?.name === "string" ? n.name.trim() : "")).filter(Boolean),
      offered: offeredPackages(content),
      class_count: (Array.isArray(quote.names) ? quote.names : []).reduce((n, nm) => n + (nm.classes?.length ?? 0), 0),
      signed_package: typeof signedPackage === "string" && signedPackage.trim() ? signedPackage.trim() : null,
      package_basis:
        basis && typeof basis.name === "string" && Array.isArray(basis.edited) && basis.edited.length > 0
          ? { name: basis.name, edited: basis.edited.filter((f): f is string => typeof f === "string") }
          : null,
    };
  });
}

/** The events a list's Last activity cell reads: not `viewed`, which a client's refreshes would let crowd out the rest. */
const LAST_ACTIVITY_EVENT_TYPES = ["created", "edited", "revised", "approved", "unapproved", "sent", "accepted", "withdrawn", "superseded"] as const;
const EVENT_ID_CHUNK = 50;

/**
 * The newest event of each listed proposal, keyed by proposal id (a proposal with no event is
 * simply absent). Named columns, `in("proposal_id", ids)` in chunks so the request line stays
 * short, newest first. THROWS when a read fails: the caller shows a derived line instead of
 * guessing, it never treats a failure as "no activity".
 */
export async function listLatestProposalEvents(proposalIds: readonly string[]): Promise<Map<string, ProposalLatestEvent>> {
  const out = new Map<string, ProposalLatestEvent>();
  const ids = [...new Set(proposalIds)].filter((id) => UUID_PATTERN.test(id));
  if (ids.length === 0) return out;
  const supabase = await getScopedClient();
  const db = proposalsDb(supabase);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += EVENT_ID_CHUNK) chunks.push(ids.slice(i, i + EVENT_ID_CHUNK));
  const reads = await Promise.all(
    chunks.map((chunk) =>
      db
        .from("client_proposal_event")
        .select("proposal_id, type, actor, actor_user_id, created_at")
        .in("proposal_id", chunk)
        .in("type", LAST_ACTIVITY_EVENT_TYPES)
        .order("created_at", { ascending: false })
        .limit(500),
    ),
  );
  for (const { data, error } of reads) {
    if (error) throw friendlyProposalError(error, "load the proposal activity");
    for (const row of (Array.isArray(data) ? data : []) as Array<ProposalLatestEvent & { proposal_id: string }>) {
      const seen = out.get(row.proposal_id);
      if (!seen || row.created_at > seen.created_at) out.set(row.proposal_id, row);
    }
  }
  return out;
}

export type ProposalLatestEvent = { type: string; actor: string; actor_user_id: string | null; created_at: string };

export type ProposalVersionSummary = Pick<
  ProposalRow,
  | "id"
  | "version"
  | "status"
  | "source"
  | "created_at"
  | "updated_at"
  | "approved_at"
  | "sent_at"
  | "accepted_at"
  | "superseded_at"
  | "withdrawn_at"
>;

export type ProposalDetail = {
  proposal: ProposalRow;
  /** Every version of this client offer, newest first. */
  versions: ProposalVersionSummary[];
  /** The family's audit log, newest first. */
  events: ProposalEventRow[];
};

/** One version with its family's versions and event log, or null when it isn't visible to this firm. */
export async function getProposal(id: string): Promise<ProposalDetail | null> {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) return null;
  const supabase = await getScopedClient();
  const db = proposalsDb(supabase);

  const { data, error } = await db.from("client_proposal").select(PROPOSAL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw friendlyProposalError(error, "load the proposal");
  if (!data) return null;
  const proposal = data as ProposalRow;

  const [versions, events] = await Promise.all([
    db.from("client_proposal").select(VERSION_COLUMNS).eq("family_id", proposal.family_id).order("version", { ascending: false }),
    db.from("client_proposal_event").select(EVENT_COLUMNS).eq("family_id", proposal.family_id).order("created_at", { ascending: false }).limit(300),
  ]);
  if (versions.error) throw friendlyProposalError(versions.error, "load the proposal's versions");
  if (events.error) throw friendlyProposalError(events.error, "load the proposal's history");

  return {
    proposal,
    versions: (Array.isArray(versions.data) ? versions.data : []) as ProposalVersionSummary[],
    events: (Array.isArray(events.data) ? events.data : []) as ProposalEventRow[],
  };
}

/* ─────────────────────────── create / edit ───────────────────────────────── */

export type CreateProposalInput = {
  clientName: string;
  clientEmail?: string | null;
  title?: string;
  content: ProposalContent;
  leadId?: string | null;
  matterId?: string | null;
  expiresOn?: string | null;
  payUrl?: string | null;
  /** 'agent' when a drafting agent calls this on a person's behalf. Default 'manual'. */
  source?: Exclude<ProposalSource, "revision">;
};

/**
 * A new client offer: version 1, status draft, with its own token. A draft may
 * carry validation errors (the editor shows them); only approval refuses them.
 */
export async function createProposal(input: CreateProposalInput): Promise<ProposalRow> {
  checkDraftColumns({
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    title: input.title,
    expiresOn: input.expiresOn,
    payUrl: input.payUrl,
    content: input.content,
  });

  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);
  const orgId = await currentOrgId(supabase);
  const userId = await currentUserId(supabase);

  const id = randomUUID();
  const { data, error } = await db
    .from("client_proposal")
    .insert({
      id,
      org_id: orgId,
      family_id: id,
      version: 1,
      public_token: generateProposalToken(),
      lead_id: input.leadId ?? null,
      matter_id: input.matterId ?? null,
      client_name: input.clientName.trim(),
      client_email: input.clientEmail?.trim() || null,
      title: input.title?.trim() || "Trademark Proposal",
      status: "draft",
      content: input.content,
      expires_on: input.expiresOn || null,
      pay_url: input.payUrl?.trim() || null,
      source: input.source ?? "manual",
      created_by: userId,
      updated_by: userId,
    })
    .select(PROPOSAL_COLUMNS)
    .single();
  if (error) throw friendlyProposalError(error, "create the proposal");
  // The 'created' event is written by the database trigger.
  return data as ProposalRow;
}

export type UpdateProposalInput = {
  content?: ProposalContent;
  clientName?: string;
  clientEmail?: string | null;
  title?: string;
  expiresOn?: string | null;
  payUrl?: string | null;
  leadId?: string | null;
  matterId?: string | null;
};

/** What a save is allowed to overwrite: exactly the version of the row the editor rendered. */
export type UpdateProposalOptions = {
  /**
   * `updated_at` of the row as the editor rendered it. The write is fenced on
   * it (`.eq('updated_at', ...)`): if anyone saved, approved, un-approved or
   * sent the row since, zero rows change and the save is refused rather than
   * silently overwriting their work.
   */
  expectedUpdatedAt: string;
};

export const PROPOSAL_SAVE_CONFLICT =
  "Someone else saved this proposal while you were editing. Reload to see their changes.";

/**
 * Edit a draft or approved version. Editing an APPROVED row sends it back to
 * draft (the trigger does that; the returned row shows it) and it needs
 * re-approval. A sent / accepted / superseded / withdrawn version is refused
 * with a sentence pointing at `reviseProposal`.
 *
 * Writes an `edited` event naming the fields, the field-level changes, and the
 * legal total before and after. A call that changes nothing writes nothing.
 *
 * Optimistic concurrency: `expectedUpdatedAt` is required. A stale value is a
 * `conflict` ProposalError (PROPOSAL_SAVE_CONFLICT), checked up front against
 * the row just read and again as the write's own fence, so two saves racing
 * from the same page cannot both land.
 */
export async function updateProposal(
  id: string,
  patch: UpdateProposalInput,
  options: UpdateProposalOptions,
): Promise<ProposalRow> {
  checkDraftColumns(patch);
  const expected = typeof options?.expectedUpdatedAt === "string" ? options.expectedUpdatedAt.trim() : "";
  if (!expected || Number.isNaN(Date.parse(expected))) {
    // No usable version to fence on: refuse, never fall back to an unfenced write.
    throw new ProposalError("conflict", PROPOSAL_SAVE_CONFLICT);
  }

  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);
  const userId = await currentUserId(supabase);

  const current = await loadRow(db, id);
  // Same instant, whatever the timestamp's spelling; the write below is the
  // exact fence. Checked before "frozen" so the person is told to reload.
  if (Date.parse(current.updated_at) !== Date.parse(expected)) {
    throw new ProposalError("conflict", PROPOSAL_SAVE_CONFLICT);
  }
  if (!isProposalEditable(current.status)) {
    throw new ProposalError(
      "frozen",
      current.status === "sent"
        ? "This version has been sent. Create a revision to change it."
        : `This version is ${current.status} and can't be changed.`,
    );
  }

  const next: Partial<Pick<ProposalRow, EditableColumn>> = {};
  if (patch.content !== undefined) next.content = patch.content;
  if (patch.clientName !== undefined) next.client_name = patch.clientName.trim();
  if (patch.clientEmail !== undefined) next.client_email = patch.clientEmail?.trim() || null;
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (patch.expiresOn !== undefined) next.expires_on = patch.expiresOn || null;
  if (patch.payUrl !== undefined) next.pay_url = patch.payUrl?.trim() || null;
  if (patch.leadId !== undefined) next.lead_id = patch.leadId || null;
  if (patch.matterId !== undefined) next.matter_id = patch.matterId || null;

  const columns = changedColumns(current, next);
  if (columns.length === 0) return current;

  const write: Record<string, unknown> = {};
  for (const col of columns) write[col] = next[col];

  const { data, error } = await db
    .from("client_proposal")
    .update(write)
    .eq("id", current.id)
    // Fenced on the status that was read: if it moved (sent while this edit was
    // in flight), zero rows change and the caller is told, rather than an edit
    // landing on a version the client may already be reading.
    .eq("status", current.status)
    // The optimistic-concurrency fence: the row must still be the one the
    // editor rendered. The 0089 trigger stamps updated_at on every change.
    .eq("updated_at", expected)
    .select(PROPOSAL_COLUMNS)
    .maybeSingle();
  if (error) throw friendlyProposalError(error, "save the proposal");
  if (!data) throw new ProposalError("conflict", PROPOSAL_SAVE_CONFLICT);
  const updated = data as ProposalRow;

  const payload: ProposalEditedPayload = {
    fields: columns,
    legal_total_before: offerTotals(current.content).legal_total_cents,
    legal_total_after: offerTotals(updated.content).legal_total_cents,
    reset_to_draft: current.status === "approved" && updated.status === "draft",
    changes: buildChanges(current, updated, columns),
  };
  await writeProposalEventSafe(db, updated, "edited", "staff", userId, payload as unknown as Record<string, unknown>);
  return updated;
}

/* ─────────────────────────── lifecycle ───────────────────────────────────── */

/**
 * Draft -> approved. Refused here with the list of problems when the proposal
 * breaks a firm rule (`validateContent` with `forApproval`); refused by the
 * database unless the caller is one of the firm's named approvers, and it can
 * never be done by a service-role caller. The trigger stamps approved_by /
 * approved_at.
 */
export async function approveProposal(id: string): Promise<ProposalRow> {
  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);

  const current = await loadRow(db, id);
  if (current.status !== "draft") {
    throw new ProposalError("conflict", current.status === "approved" ? "This version is already saved." : `A ${current.status} version can't be saved this way.`);
  }
  const issues = validateContent(current.content, {
    forApproval: true,
    title: current.title,
    expires_on: current.expires_on,
    pay_url: current.pay_url,
    client_email: current.client_email,
  });
  if (hasErrors(issues)) {
    throw new ProposalError("validation", "Fix the problems listed before creating the link.", issues);
  }
  return transition(db, current, "draft", "approved", "approve the proposal");
}

/** Approved -> draft, so it can be edited again. Needs re-approval afterwards. */
export async function unapproveProposal(id: string): Promise<ProposalRow> {
  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);
  const current = await loadRow(db, id);
  if (current.status !== "approved") throw new ProposalError("conflict", "Only a saved version can be edited again.");
  return transition(db, current, "approved", "draft", "send the proposal back to draft");
}

/**
 * Approved -> sent, atomically, through `client_proposal_send`: any earlier
 * `sent` version of the family is superseded in the same call. The client's
 * link (`/p/<public_token>`) starts working here, and not before.
 */
export async function sendProposal(id: string): Promise<ProposalRow> {
  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);

  const current = await loadRow(db, id);
  if (current.status !== "approved") {
    throw new ProposalError("conflict", "The link can only be turned on for a saved version. Save and create the link first.");
  }
  const { error } = await db.rpc("client_proposal_send", { p_id: current.id });
  if (error) throw friendlyProposalError(error, "mark the proposal as sent");
  return loadRow(db, current.id);
}

/** Draft, approved or sent -> withdrawn. Terminal; the client's link stops working. */
export async function withdrawProposal(id: string): Promise<ProposalRow> {
  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);
  const current = await loadRow(db, id);
  if (current.status !== "draft" && current.status !== "approved" && current.status !== "sent") {
    throw new ProposalError("conflict", `A ${current.status} version can't be withdrawn.`);
  }
  return transition(db, current, current.status, "withdrawn", "withdraw the proposal");
}

async function transition(
  db: ProposalsDbClient,
  current: ProposalRow,
  from: ProposalStatus,
  to: ProposalStatus,
  doing: string,
): Promise<ProposalRow> {
  const { data, error } = await db
    .from("client_proposal")
    .update({ status: to })
    .eq("id", current.id)
    .eq("status", from)
    .select(PROPOSAL_COLUMNS)
    .maybeSingle();
  if (error) throw friendlyProposalError(error, doing);
  if (!data) throw new ProposalError("conflict", "This proposal changed while you were looking at it. Refresh and try again.");
  return data as ProposalRow;
}

/**
 * Sent -> a new draft version in the same family (same token, version + 1,
 * source 'revision'), copied from the sent one. The sent version keeps being
 * the client's live page until the revision is approved and sent, at which
 * point `client_proposal_send` supersedes it. Refused when the family already
 * has an open (draft or approved) version: the database allows only one, and
 * the error says so rather than surfacing a unique-index violation.
 */
export async function reviseProposal(id: string): Promise<ProposalRow> {
  const supabase = await getScopedClient();
  await requireProposalWriteRole(supabase);
  const db = proposalsDb(supabase);
  const userId = await currentUserId(supabase);

  const source = await loadRow(db, id);
  if (source.status !== "sent") {
    throw new ProposalError("conflict", "Only a sent version can be revised. A draft or approved version can be edited directly.");
  }

  const { data: family, error: familyError } = await db
    .from("client_proposal")
    .select("id, version, status")
    .eq("family_id", source.family_id)
    .order("version", { ascending: false });
  if (familyError) throw friendlyProposalError(familyError, "load the proposal's versions");
  const versions = (Array.isArray(family) ? family : []) as Array<{ id: string; version: number; status: ProposalStatus }>;
  if (versions.some((v) => isProposalEditable(v.status))) {
    throw new ProposalError("conflict", "There is already a draft of the next version. Open it from the version history instead.");
  }
  const nextVersion = Math.max(source.version, ...versions.map((v) => v.version)) + 1;

  const { data, error } = await db
    .from("client_proposal")
    .insert({
      id: randomUUID(),
      org_id: source.org_id,
      family_id: source.family_id,
      version: nextVersion,
      public_token: source.public_token,
      lead_id: source.lead_id,
      matter_id: source.matter_id,
      client_name: source.client_name,
      client_email: source.client_email,
      title: source.title,
      status: "draft",
      content: source.content,
      expires_on: source.expires_on,
      pay_url: source.pay_url,
      source: "revision",
      created_by: userId,
      updated_by: userId,
    })
    .select(PROPOSAL_COLUMNS)
    .single();
  if (error) throw friendlyProposalError(error, "create the revision");
  const revision = data as ProposalRow;

  await writeProposalEventSafe(db, revision, "revised", "staff", userId, {
    from_version: source.version,
    from_proposal_id: source.id,
    version: revision.version,
  });
  return revision;
}

/* ─────────────────────────── the firm's settings ─────────────────────────── */

/** The firm's proposal settings, or null when none have been saved yet. */
export async function getProposalSettings(): Promise<ProposalSettingRow | null> {
  const supabase = await getScopedClient();
  const db = proposalsDb(supabase);
  const { data, error } = await db.from("client_proposal_setting").select(SETTING_COLUMNS).maybeSingle();
  if (error) throw friendlyProposalError(error, "load the proposal settings");
  return (data as ProposalSettingRow | null) ?? null;
}

/**
 * Whether the signed-in user is one of the firm's named approvers. Used to
 * decide whether to SHOW the Approve button; the database trigger is what
 * actually enforces it.
 */
export async function isCurrentUserApprover(): Promise<boolean> {
  try {
    const supabase = await getScopedClient();
    const userId = await currentUserId(supabase);
    if (!userId) return false;
    const setting = await getProposalSettings();
    return !!setting && setting.approver_user_ids.includes(userId);
  } catch {
    return false;
  }
}

export type SaveProposalSettingsInput = {
  approverUserIds: string[];
  defaultPayUrl?: string | null;
  notifyEmail?: string | null;
  pricing: Record<string, unknown>;
};

/** Owner / admin / senior_admin only. Creates the firm's row on first save. */
export async function saveProposalSettings(input: SaveProposalSettingsInput): Promise<ProposalSettingRow> {
  const approvers = Array.from(new Set(input.approverUserIds));
  const issues = validateSettingInput({
    approver_user_ids: approvers,
    default_pay_url: input.defaultPayUrl ?? null,
    notify_email: input.notifyEmail ?? null,
    pricing: input.pricing,
  });
  if (hasErrors(issues)) throw new ProposalError("validation", issues[0].message, issues);

  const supabase = await getScopedClient();
  await requireProposalAdminRole(supabase);
  const db = proposalsDb(supabase);
  const orgId = await currentOrgId(supabase);
  const userId = await currentUserId(supabase);

  const { data, error } = await db
    .from("client_proposal_setting")
    .upsert(
      {
        org_id: orgId,
        approver_user_ids: approvers,
        default_pay_url: input.defaultPayUrl?.trim() || null,
        notify_email: input.notifyEmail?.trim() || null,
        pricing: input.pricing,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    )
    .select(SETTING_COLUMNS)
    .single();
  if (error) throw friendlyProposalError(error, "save the proposal settings");
  return data as ProposalSettingRow;
}
