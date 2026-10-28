import "server-only";

import { firmToken } from "@/lib/intake-forms/lawmatics-sync";
import { addNote, type FetchLike } from "@/lib/lawmatics/writes";
import { formatDollars } from "@/lib/proposal-editor/events";
import { addedClassCount } from "./added-classes";
import { stepPayload, stepSucceeded, type ProposalStep, type StepEventInput, type StepPayload } from "./paid";
import { MARK_KIND_LABEL, type AcceptedSnapshot } from "./types";

/**
 * What happens after a client accepts on `/p/<token>` (Sprint 19). It runs in `after()`,
 * as the service role, because the client has no session:
 *
 *   1. an in-app notice (crm_notification, kind `approval_needed`) to the proposal's
 *      approvers and the firm's intake staff: a headline, nothing else;
 *   2. a Lawmatics NOTE on the right record, through the firm's OWN connection.
 *
 * Each step is independent, records its outcome on the proposal's timeline, and runs once
 * per accepted version (a version has its own id, so the dedupe is by proposal id). NOTHING
 * here throws into the acceptance, and nothing here logs a name, an email, an amount or a
 * token: a failure logs a fixed sentence and the step name.
 *
 * ── THE CLIENT IS PASSED IN ─────────────────────────────────────────────────
 * `public.ts` already holds the one service-role connection of this module. It hands it
 * to `runAcceptanceFollowups` as an argument, so no second admin import exists. Every
 * statement is fenced by the proposal's OWN `org_id` (read from the row, never from input).
 *
 * ── WHY THE NOTE TARGET IS MATCHED IN LECTUAL ───────────────────────────────
 * matter id -> lead id -> exactly one of the firm's own leads with that email. Never a
 * sweep of Lawmatics (a paginated read on a path with no session can run long), and never
 * a guess between two. All three are Lawmatics matters (prospects).
 */

/* ─────────────────────────── the client shape ──────────────────────────── */

type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError };

export interface FollowupQuery extends PromiseLike<DbResult> {
  select(columns: string): FollowupQuery;
  insert(rows: unknown): FollowupQuery;
  eq(column: string, value: unknown): FollowupQuery;
  in(column: string, values: readonly unknown[]): FollowupQuery;
  ilike(column: string, pattern: string): FollowupQuery;
  order(column: string, options?: { ascending?: boolean }): FollowupQuery;
  limit(count: number): FollowupQuery;
  maybeSingle(): PromiseLike<DbResult>;
}

/** Just what the follow-ups call. Structural, so the service-role client and a test fake both fit. */
export interface FollowupDb {
  from(table: string): FollowupQuery;
}

/** The read-only part of it: what the note's target lookup needs (also served by the signed-in client). */
export type LookupDb = FollowupDb;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/* ─────────────────────────── the words ─────────────────────────────────── */

/** "<client> accepted <package> · legal $4,950". Legal fee only: the USPTO fee is not part of a headline. */
export function acceptanceHeadline(input: { clientName: string; packageName: string; legalTotalCents: number; addedClasses?: number }): string {
  const client = text(input.clientName) || "A client";
  const pkg = text(input.packageName);
  const added = input.addedClasses && input.addedClasses > 0 ? ` · ${input.addedClasses} ${input.addedClasses === 1 ? "class" : "classes"} added by the client` : "";
  return `${client} accepted ${pkg ? `${pkg} ` : "their proposal "}· legal ${formatDollars(input.legalTotalCents)}${added}`;
}

/**
 * The Lawmatics note: what was accepted, with the legal fee and the USPTO fees as two
 * separate figures. This goes into the firm's own CRM, so the brand names and marks are
 * in it; they are not in the in-app notice.
 */
export function acceptanceNoteBody(snapshot: AcceptedSnapshot, clientName: string): { name: string; body: string } {
  const { content, quote } = snapshot;
  const addedIds = new Set((content.names ?? []).flatMap((n) => (n.classes ?? []).filter((c) => c.client_added === true).map((c) => c.id)));
  const pkg = text(content.pricing?.package) || "Proposal";
  const lines: string[] = [`${text(clientName) || "The client"} accepted this proposal. Accepted ${snapshot.accepted_at}.`, `Package: ${pkg}`];
  for (const n of (Array.isArray(quote.names) ? quote.names : []).filter((x) => x.included)) {
    const marks = n.marks.map((m) => MARK_KIND_LABEL[m.kind] ?? m.kind).join(" + ");
    // What the client typed is never copied into the firm's CRM: only the firm's own class labels are named.
    const classes = n.classes.filter((c) => !addedIds.has(c.id)).map((c) => text(c.label)).filter(Boolean).join("; ");
    lines.push(`- ${text(n.name)}: ${marks}${classes ? `; classes: ${classes}` : ""}`);
  }
  for (const a of (Array.isArray(quote.adjustments) ? quote.adjustments : []).filter((x) => x.discount_cents > 0)) {
    lines.push(`Adjustment: ${text(a.label) || "Adjustment"} −${formatDollars(a.discount_cents)}`);
  }
  if (addedIds.size > 0) lines.push(`Classes added by the client: ${addedIds.size} (priced into the totals below)`);
  lines.push(`Legal fee, due when accepted: ${formatDollars(quote.legal_total_cents)}`);
  lines.push(`USPTO fees, due at filing: ${formatDollars(quote.gov_total_cents)} (separate; not part of the legal fee)`);
  return { name: `Proposal accepted: ${pkg}`.slice(0, 120), body: lines.join("\n") };
}

/* ─────────────────────────── the note's target ─────────────────────────── */

export type NoteTarget = { ok: true; notableType: "Prospect"; notableId: string } | { ok: false; reason: "none" | "more_than_one" | "unreadable" };

export const NOTE_TARGET_TEXT: Record<"none" | "more_than_one" | "unreadable", string> = {
  none: "no Lawmatics record found",
  more_than_one: "more than one record matches",
  unreadable: "couldn't read the matter or lead",
};

export type NoteTargetInput = { orgId: string; matterId: string | null; leadId: string | null; clientEmail: string | null };

function lawmaticsIdOf(row: unknown): string | null {
  const id = isObject(row) ? row.lawmatics_id : null;
  return typeof id === "string" || typeof id === "number" ? String(id).trim() || null : null;
}

/** An address as an `ilike` pattern that matches itself and nothing wider. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * matter id, then lead id, then exactly one lead with the client's email. A matter or lead
 * with no `lawmatics_id` falls through to the next rule; two or more qualifying leads, or
 * none, is no target. A failed read is `unreadable`, never "none".
 */
export async function resolveNoteTarget(db: LookupDb, input: NoteTargetInput): Promise<NoteTarget> {
  try {
    if (input.matterId) {
      const { data, error } = await db.from("crm_matter").select("lawmatics_id").eq("id", input.matterId).eq("org_id", input.orgId).maybeSingle();
      if (error) return { ok: false, reason: "unreadable" };
      const id = lawmaticsIdOf(data);
      if (id) return { ok: true, notableType: "Prospect", notableId: id };
    }
    if (input.leadId) {
      const { data, error } = await db.from("crm_lead").select("lawmatics_id").eq("id", input.leadId).eq("org_id", input.orgId).maybeSingle();
      if (error) return { ok: false, reason: "unreadable" };
      const id = lawmaticsIdOf(data);
      if (id) return { ok: true, notableType: "Prospect", notableId: id };
    }
    const email = text(input.clientEmail).toLowerCase();
    if (!email) return { ok: false, reason: "none" };
    const { data, error } = await db
      .from("crm_lead")
      .select("id, email, lawmatics_id")
      .eq("org_id", input.orgId)
      .ilike("email", escapeLike(email))
      .limit(10);
    if (error) return { ok: false, reason: "unreadable" };
    const matches = (Array.isArray(data) ? data : []).filter(
      (r) => isObject(r) && typeof r.email === "string" && r.email.trim().toLowerCase() === email && lawmaticsIdOf(r),
    );
    if (matches.length > 1) return { ok: false, reason: "more_than_one" };
    const id = matches.length === 1 ? lawmaticsIdOf(matches[0]) : null;
    return id ? { ok: true, notableType: "Prospect", notableId: id } : { ok: false, reason: "none" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/* ─────────────────────────── one step's result ─────────────────────────── */

export type StepResult = { outcome: string; reason?: string };

export type NoteProposal = {
  id: string;
  orgId: string;
  clientName: string;
  clientEmail: string | null;
  matterId: string | null;
  leadId: string | null;
  snapshot: AcceptedSnapshot;
};

/**
 * Looks up the target and posts the note. `token` is null when the firm has no active
 * Lawmatics connection (no request is made then). Never throws.
 */
export async function addAcceptanceNote(db: LookupDb, proposal: NoteProposal, token: string | null, fetchImpl?: FetchLike): Promise<StepResult> {
  try {
    if (!token) return { outcome: "blocked", reason: "Lawmatics isn't connected" };
    const target = await resolveNoteTarget(db, proposal);
    if (!target.ok) return { outcome: "blocked", reason: NOTE_TARGET_TEXT[target.reason] };
    const note = acceptanceNoteBody(proposal.snapshot, proposal.clientName);
    const sent = await addNote(token, { ...note, notableType: target.notableType, notableId: target.notableId }, fetchImpl);
    return sent.ok ? { outcome: "added" } : { outcome: "failed", reason: `Lawmatics answered ${sent.status ?? "with an error"}` };
  } catch {
    return { outcome: "failed", reason: "unexpected error" };
  }
}

/* ─────────────────────────── the service-role run ──────────────────────── */

export type FollowupInput = { proposalId: string; orgId: string };

export type FollowupDeps = {
  /** The firm's Lawmatics token for this org, or null. Default: `firmToken` over the same client. */
  getToken?: (db: FollowupDb, orgId: string) => Promise<string | null>;
  fetchImpl?: FetchLike;
};

const PROPOSAL_COLUMNS = "id, org_id, family_id, status, client_name, client_email, lead_id, matter_id, accepted_snapshot";

type Row = { id: string; familyId: string } & NoteProposal;

async function readProposal(db: FollowupDb, input: FollowupInput): Promise<Row | null> {
  const { data, error } = await db.from("client_proposal").select(PROPOSAL_COLUMNS).eq("id", input.proposalId).eq("org_id", input.orgId).maybeSingle();
  if (error || !isObject(data) || data.status !== "accepted" || !isObject(data.accepted_snapshot)) return null;
  const snapshot = data.accepted_snapshot as unknown as AcceptedSnapshot;
  if (!isObject(snapshot.quote) || !isObject(snapshot.content)) return null;
  return {
    id: input.proposalId,
    orgId: input.orgId,
    familyId: typeof data.family_id === "string" ? data.family_id : input.proposalId,
    clientName: text(data.client_name),
    clientEmail: typeof data.client_email === "string" ? data.client_email : null,
    matterId: typeof data.matter_id === "string" ? data.matter_id : null,
    leadId: typeof data.lead_id === "string" ? data.lead_id : null,
    snapshot,
  };
}

/** The step events already on this version, or null when they could not be read. */
async function readEarlierSteps(db: FollowupDb, row: Row): Promise<StepEventInput[] | null> {
  const { data, error } = await db
    .from("client_proposal_event")
    .select("proposal_id, created_at, payload")
    .eq("proposal_id", row.id)
    .eq("org_id", row.orgId)
    .in("payload->>step", ["accept_notice", "lawmatics_note"])
    .limit(50);
  if (error) return null;
  return (Array.isArray(data) ? data : []).filter(isObject).map((r) => ({
    proposal_id: typeof r.proposal_id === "string" ? r.proposal_id : row.id,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    payload: r.payload,
  }));
}

/** Writes the step to the timeline as the system. Returns whether the line landed. */
async function recordStep(db: FollowupDb, row: Row, payload: StepPayload): Promise<boolean> {
  try {
    const { error } = await db.from("client_proposal_event").insert({
      org_id: row.orgId,
      proposal_id: row.id,
      family_id: row.familyId,
      type: "edited",
      actor: "system",
      actor_user_id: null,
      payload,
    });
    if (error) console.error(`[proposals] couldn't record the ${payload.step} step`);
    return !error;
  } catch {
    console.error(`[proposals] couldn't record the ${payload.step} step`);
    return false;
  }
}

/** Approvers named in the firm's proposal settings (who are still members) plus every intake member, de-duplicated. */
async function recipientsFor(db: FollowupDb, orgId: string): Promise<string[] | null> {
  const [settings, members] = await Promise.all([
    db.from("client_proposal_setting").select("approver_user_ids").eq("org_id", orgId).maybeSingle(),
    db.from("crm_org_member").select("user_id, role").eq("org_id", orgId),
  ]);
  if (settings.error || members.error) return null;
  const approvers = isObject(settings.data) && Array.isArray(settings.data.approver_user_ids) ? settings.data.approver_user_ids.filter((v): v is string => typeof v === "string") : [];
  const roster = (Array.isArray(members.data) ? members.data : []).filter(isObject);
  const memberIds = new Set(roster.map((m) => m.user_id).filter((v): v is string => typeof v === "string"));
  const ids = new Set<string>();
  for (const id of approvers) if (memberIds.has(id)) ids.add(id);
  for (const m of roster) if (m.role === "intake" && typeof m.user_id === "string") ids.add(m.user_id);
  return [...ids];
}

async function noticeStep(db: FollowupDb, row: Row): Promise<StepResult> {
  try {
    const recipients = await recipientsFor(db, row.orgId);
    if (recipients === null) return { outcome: "failed", reason: "couldn't read who to tell" };
    if (recipients.length === 0) return { outcome: "skipped", reason: "no approvers or intake staff to tell" };
    const headline = acceptanceHeadline({
      clientName: row.clientName,
      packageName: row.snapshot.content.pricing?.package ?? "",
      legalTotalCents: row.snapshot.quote.legal_total_cents,
      addedClasses: addedClassCount(row.snapshot.content),
    });
    const { error } = await db.from("crm_notification").insert(
      recipients.map((userId) => ({
        org_id: row.orgId,
        user_id: userId,
        kind: "approval_needed",
        // Exactly three keys: no email, selection, snapshot, gov total, token or mark names.
        payload: { source: "proposal_accepted", proposal_id: row.id, headline },
      })),
    );
    return error ? { outcome: "failed", reason: "the notice couldn't be saved" } : { outcome: "sent" };
  } catch {
    return { outcome: "failed", reason: "unexpected error" };
  }
}

async function noteStep(db: FollowupDb, row: Row, deps: FollowupDeps): Promise<StepResult> {
  try {
    const token = await (deps.getToken ?? ((d, orgId) => firmToken(d as never, orgId)))(db, row.orgId);
    return await addAcceptanceNote(db, row, token, deps.fetchImpl);
  } catch {
    return { outcome: "failed", reason: "unexpected error" };
  }
}

async function runStep(db: FollowupDb, row: Row, step: ProposalStep, earlier: StepEventInput[] | null, run: () => Promise<StepResult>, blockWhenUnchecked: boolean): Promise<void> {
  if (earlier && stepSucceeded(earlier, row.id, step)) return;
  const result = earlier === null && blockWhenUnchecked ? ({ outcome: "blocked", reason: "couldn't check for an earlier one" } as StepResult) : await run();
  // Counts and the new legal total only: never what the client typed.
  const added = addedClassCount(row.snapshot.content);
  const extra: Record<string, number> = added > 0 ? { added_classes: added, legal_total_cents: row.snapshot.quote.legal_total_cents } : {};
  await recordStep(db, row, stepPayload(step, result.outcome, result.reason, extra));
}

/**
 * Runs both steps for one accepted version. Safe to call twice: a step that already ended
 * in its success word is not repeated, and a step that failed is tried again. Never throws.
 */
export async function runAcceptanceFollowups(db: FollowupDb, input: FollowupInput, deps: FollowupDeps = {}): Promise<void> {
  try {
    const row = await readProposal(db, input);
    if (!row) return;
    const earlier = await readEarlierSteps(db, row);
    // The notice is internal and the acceptance happens once, so an unreadable history does not hold it back;
    // a second note in the firm's CRM is worse than a missing one, so that step waits for a readable history.
    await runStep(db, row, "accept_notice", earlier, () => noticeStep(db, row), false);
    await runStep(db, row, "lawmatics_note", earlier, () => noteStep(db, row, deps), true);
  } catch {
    console.error("[proposals] the acceptance follow-ups stopped early");
  }
}
