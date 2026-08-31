import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database, Json } from "@/lib/db/types.generated";
import { ROLES, type Role } from "@/lib/auth/roles";
import { deadlineKindLabel, type DeadlineKind } from "@/lib/deadlines/kinds";
import { getMatterStage, type MatterStage } from "./stages";

/**
 * Every write this app performs against a matter.
 *
 * This is a small file with a large amount of rule in it, so the rules are
 * stated once here rather than repeated at each call site.
 *
 * 1. `org_id` IS READ OFF THE PARENT ROW. ALWAYS. Never off a form, never off
 *    a session claim, never off an argument. The parent is looked up through
 *    the caller's own scoped client, so a matter in another tenant is simply
 *    invisible (no row → "not found") before any child row is written, and the
 *    `org_id` stamped on the child is the parent's own. A caller-supplied
 *    `org_id` on a denormalized column IS a cross-tenant write, and RLS's WITH
 *    CHECK would happily accept it, because all it tests is that the value
 *    equals the caller's own org. The composite `(matter_id, org_id)` FKs are
 *    the structural backstop; this is the layer that never gets there.
 *
 * 2. NO `org_id` FILTER ON ANY READ. Same rule as the read modules. RLS scopes
 *    every query here; a redundant filter would mask a policy regression.
 *
 * 3. A CALCULATED DEADLINE SOURCE IS UNREPRESENTABLE. See `DocketableDeadlineSource`
 *    below. This app suggests dates (`@/lib/deadlines/answer-clock`) and it
 *    dockets dates a human chose, and those are different acts. A suggestion
 *    that has been docketed is `'manual'` with the attorney's own basis
 *    sentence recorded in `calculation_basis`; a date read off a court's
 *    notice is `'official_notice'`. There is no third case this app may write,
 *    and the type system — not a code review — is what enforces it.
 *
 * 4. NOTHING IS EVER PRE-CONFIRMED. `attorney_confirmed` is flipped only by
 *    `confirmDeadline`, only by an attorney or the owner, and the database's
 *    own confirmation-guard trigger drops the confirmation if the date later
 *    moves. Lectual is software, not a law firm.
 *
 * 5. WRITES RETURN A RESULT, THEY DO NOT THROW AT THE UI. Every action returns
 *    a discriminated `WriteResult`, so a refusal renders as a sentence and an
 *    "already open" collision renders as an offer to supersede rather than as
 *    a Postgres constraint name. Genuinely unexpected failures still throw.
 *
 * These are exported as server actions via inline `"use server"` on each
 * function rather than a file-level directive, because the file also exports
 * the types and role lists its callers need — a `"use server"` module may
 * export nothing but async functions.
 */

export type MatterDeadlineRow = Database["public"]["Tables"]["crm_matter_deadline"]["Row"];
export type LitigationDetailRow =
  Database["public"]["Tables"]["crm_litigation_detail"]["Row"];
export type MatterRow = Database["public"]["Tables"]["crm_matter"]["Row"];
export type ActivityRow = Database["public"]["Tables"]["crm_activity"]["Row"];
type DeadlineStatus = Database["public"]["Enums"]["crm_deadline_status"];

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type WriteError =
  /** The caller's role does not permit this write. */
  | { code: "forbidden"; message: string }
  /** No such row, or RLS hid it. Deliberately indistinguishable. */
  | { code: "not-found"; message: string }
  /** The input itself is unusable — blank note, no fields to save. */
  | { code: "invalid"; message: string }
  /**
   * A deadline of this kind is already open on this matter. Carries the row
   * that is in the way so the UI can offer "supersede that one?" instead of
   * making the user go and find it.
   */
  | { code: "already-open"; message: string; existing: MatterDeadlineRow | null }
  /** A database constraint refused the value (too long, bad enum, …). */
  | { code: "rejected"; message: string };

export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: WriteError };

function ok<T>(data: T): WriteResult<T> {
  return { ok: true, data };
}

function fail<T>(error: WriteError): WriteResult<T> {
  return { ok: false, error };
}

/** PostgREST/Postgres error codes this module translates rather than surfaces. */
const PG_NO_ROW = "PGRST116";
const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Roles allowed to write matters. Mirrors the `crm_matter_*_staff` RLS
 * policies: every staff role EXCEPT `social_media` and `viewer`. RLS is the
 * real boundary; this list exists so a viewer gets a sentence instead of a
 * Postgres error, and it must never drift from the policies without both
 * being changed together.
 */
export const MATTER_WRITE_ROLES: readonly Role[] = [
  "owner",
  "admin",
  "senior_admin",
  "attorney",
  "intake",
  "paralegal",
  "law_clerk",
  "clerk",
] as const;

/**
 * Roles whose confirmation of a docket date counts. Only these two, and the
 * database's confirmation-guard trigger says so independently — this list is
 * the app-side half of the same contract. Confirming a date is a statement
 * that a licensed attorney has checked it against the office record.
 */
export const DEADLINE_CONFIRM_ROLES: readonly Role[] = ["owner", "attorney"] as const;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/**
 * The caller's role in their active org, asked of the database via
 * `current_org_role()` — the same JWT-claim-backed helper the RLS policies
 * use — and re-resolved on every call, never cached across calls.
 */
async function currentRole(supabase: ScopedClient): Promise<Role | null> {
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  return isRole(data) ? data : null;
}

/**
 * `null` when the caller may write matters, a `forbidden` error otherwise.
 * Returned rather than thrown so callers can fold it into their own
 * `WriteResult` without a try/catch. Exported because `@/lib/tasks` gates on
 * exactly this list and must not keep a second copy of it.
 */
export async function matterWriteRoleError(supabase: ScopedClient): Promise<WriteError | null> {
  const role = await currentRole(supabase);
  if (!role) {
    return { code: "forbidden", message: "You don't have access to this firm's matters." };
  }
  if (!MATTER_WRITE_ROLES.includes(role)) {
    return { code: "forbidden", message: "Your role doesn't allow changes to a matter." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared parent reads
// ---------------------------------------------------------------------------

type ParentMatter = Pick<MatterRow, "id" | "org_id" | "type" | "stage_id" | "matter_number">;

/**
 * The parent matter, read through the caller's scoped client. This is where
 * `org_id` comes from for every child row written below, and it comes from
 * nowhere else.
 */
async function readParentMatter(
  supabase: ScopedClient,
  matterId: string,
): Promise<ParentMatter | null> {
  const { data, error } = await supabase
    .from("crm_matter")
    .select("id, org_id, type, stage_id, matter_number")
    .eq("id", matterId)
    .maybeSingle();
  if (error) {
    if (errorCode(error) === PG_NO_ROW) return null;
    throw error;
  }
  return data ?? null;
}

const NOT_FOUND: WriteError = {
  code: "not-found",
  message: "That matter isn't available — it may have been closed or moved.",
};

/**
 * Appends to the append-only timeline. Insert only: `crm_activity` is
 * trigger-blocked against UPDATE and DELETE for every role including the
 * service role, so a row written here is permanent. Always called AFTER the
 * write it describes has succeeded, so the timeline can never claim something
 * that did not happen.
 *
 * `actor_id` is the signed-in caller's own id, read from the session — never
 * passed in.
 */
async function logMatterActivity(
  supabase: ScopedClient,
  args: {
    orgId: string;
    matterId: string;
    type: ActivityRow["type"];
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { error } = await supabase.from("crm_activity").insert({
    org_id: args.orgId,
    matter_id: args.matterId,
    type: args.type,
    actor_type: "user",
    actor_id: user?.id ?? null,
    payload: args.payload as Json,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/**
 * The only two ways a date may get onto this app's docket.
 *
 * `'calculated'` exists in the database enum — rows written by the other app
 * use it — and it is DELIBERATELY ABSENT here. `CreateDeadlineInput["source"]`
 * is this union, so writing a calculated date is not a code-review finding or
 * a lint rule, it is a type error. The answer clock in
 * `@/lib/deadlines/answer-clock` produces a *suggestion*; when the attorney
 * dockets one it is written `'manual'`, with `anchor_event`, `anchor_date` and
 * the basis sentence recorded alongside it, because it was her determination
 * and not the software's.
 */
export const DOCKETABLE_DEADLINE_SOURCES = ["manual", "official_notice"] as const;
export type DocketableDeadlineSource = (typeof DOCKETABLE_DEADLINE_SOURCES)[number];

// Compile-time proof of both halves of the rule above: the union is a real
// subset of the database enum, and 'calculated' is not in it. Either failing
// is a build error, which is the point.
type _SourceIsSubsetOfEnum =
  DocketableDeadlineSource extends Database["public"]["Enums"]["crm_deadline_source"]
    ? true
    : never;
type _SourceExcludesCalculated = [Extract<DocketableDeadlineSource, "calculated">] extends [never]
  ? true
  : never;
const _sourceRuleHolds: [_SourceIsSubsetOfEnum, _SourceExcludesCalculated] = [true, true];
void _sourceRuleHolds;

export type CreateDeadlineInput = {
  matterId: string;
  kind: DeadlineKind;
  /** Civil date, YYYY-MM-DD. No time, no timezone — a docket date is a day. */
  dueDate: string;
  title?: string | null;
  /**
   * How this date came to be. Defaults to `'manual'` — the honest default,
   * since a date nobody labelled came off a human's own reading.
   */
  source?: DocketableDeadlineSource;
  /** What the date runs from, e.g. `'service'`. Free text, as the column is. */
  anchorEvent?: string | null;
  /** The anchor's own civil date, YYYY-MM-DD. */
  anchorDate?: string | null;
  /**
   * The attorney's plain-language basis for the date — the rule she applied,
   * in her words. Recorded whether or not the date came from a suggestion; it
   * is the thing that makes a docket entry defensible later.
   */
  calculationBasis?: string | null;
  isExtendable?: boolean;
  maxExtensions?: number | null;
  notes?: string | null;
};

/**
 * Dockets a deadline.
 *
 * Staff-role-gated: anyone on the team may put a date on the calendar. The row
 * is always written UNCONFIRMED — confirmation is a separate, attorney-only
 * act, and no argument to this function can change that.
 *
 * `is_extendable` defaults to `false` and `max_extensions` to null. This app
 * ships no interval table and no extension-rule table on purpose (see
 * `@/lib/deadlines/kinds`): claiming a date is extendable is a legal
 * determination, so it is off unless the caller says otherwise.
 *
 * THE COLLISION CASE. The database holds a unique index over open deadlines
 * per matter per kind. A second open entry of the same kind is a docketing
 * error most of the time and a supersession the rest of the time, and only the
 * attorney can tell which — so a 23505 here is caught, the row already in the
 * way is fetched, and the caller gets `{ code: 'already-open', existing }` to
 * render as "there's already an open one — supersede it?". Never a raw
 * Postgres error, and never a silent overwrite.
 */
export async function createDeadline(
  input: CreateDeadlineInput,
): Promise<WriteResult<MatterDeadlineRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return fail(roleError);

  const dueDate = input.dueDate?.trim();
  if (!dueDate) {
    return fail({ code: "invalid", message: "A deadline needs a date." });
  }

  const matter = await readParentMatter(supabase, input.matterId);
  if (!matter) return fail(NOT_FOUND);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isExtendable = input.isExtendable ?? false;

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .insert({
      // Off the parent row. Never off the input.
      org_id: matter.org_id,
      matter_id: matter.id,
      kind: input.kind,
      title: input.title?.trim() || null,
      due_date: dueDate,
      source: input.source ?? "manual",
      anchor_event: input.anchorEvent?.trim() || null,
      anchor_date: input.anchorDate?.trim() || null,
      calculation_basis: input.calculationBasis?.trim() || null,
      is_extendable: isExtendable,
      max_extensions: isExtendable ? (input.maxExtensions ?? null) : null,
      notes: input.notes?.trim() || null,
      // Never pre-confirmed, whoever is asking.
      attorney_confirmed: false,
      created_by: user?.id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (errorCode(error) === PG_UNIQUE_VIOLATION) {
      return fail({
        code: "already-open",
        message: `This matter already has an open "${deadlineKindLabel(input.kind)}" deadline.`,
        existing: await findOpenDeadline(supabase, matter.id, input.kind),
      });
    }
    if (errorCode(error) === PG_CHECK_VIOLATION) {
      return fail({
        code: "rejected",
        message: "That deadline was refused — check the date and any notes for length.",
      });
    }
    throw error;
  }

  await logMatterActivity(supabase, {
    orgId: matter.org_id,
    matterId: matter.id,
    type: "matter_updated",
    payload: {
      change: "deadline_docketed",
      kind: data.kind,
      label: data.title ?? deadlineKindLabel(data.kind),
      due_date: data.due_date,
      source: data.source,
      attorney_confirmed: false,
    },
  });

  return ok(data);
}

/** The open deadline of this kind standing in the way, for the supersede offer. */
async function findOpenDeadline(
  supabase: ScopedClient,
  matterId: string,
  kind: DeadlineKind,
): Promise<MatterDeadlineRow | null> {
  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .select("*")
    .eq("matter_id", matterId)
    .eq("kind", kind)
    .eq("status", "open")
    .order("due_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  // The insert already failed; failing to *describe* why must not escalate
  // into a second error on top of a message the user can act on.
  if (error) return null;
  return data ?? null;
}

/**
 * Records that a licensed attorney has checked this date against the office
 * record and stands behind it.
 *
 * Gated twice on purpose. The database's confirmation-guard trigger is the
 * boundary that actually holds — it also stamps `confirmed_by` from the
 * session, so the audit trail can never be supplied by a form, and it drops
 * the confirmation if the date later moves. This app-layer check exists so a
 * paralegal gets a clear refusal instead of a raw Postgres error.
 */
export async function confirmDeadline(id: string): Promise<WriteResult<MatterDeadlineRow>> {
  "use server";

  const supabase = await getScopedClient();
  const role = await currentRole(supabase);
  if (!role || !DEADLINE_CONFIRM_ROLES.includes(role)) {
    return fail({
      code: "forbidden",
      message:
        "Only a licensed attorney can confirm a docket date. Ask the attorney of record to review it.",
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .update({ attorney_confirmed: true, confirmed_at: now, updated_at: now })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return fail({ code: "not-found", message: "That deadline isn't available any more." });
  }

  await logMatterActivity(supabase, {
    orgId: data.org_id,
    matterId: data.matter_id,
    type: "matter_updated",
    payload: { change: "deadline_confirmed", kind: data.kind, due_date: data.due_date },
  });

  return ok(data);
}

/**
 * How a docket entry may be closed out. `'open'` is excluded: reopening a
 * closed date is not a thing this app does — the file keeps the record of what
 * was due and what happened to it, and a new date is a new entry.
 *
 * `'superseded'` is the value the "already open" collision offers: it closes
 * the standing entry as replaced rather than as done, which is the truthful
 * distinction when a court moves a date.
 */
export const DEADLINE_CLOSE_STATUSES = [
  "satisfied",
  "waived",
  "superseded",
] as const satisfies readonly Exclude<DeadlineStatus, "open">[];
export type DeadlineCloseStatus = (typeof DEADLINE_CLOSE_STATUSES)[number];

/**
 * Closes a docket entry out. Entries are never deleted from this app: delete
 * on `crm_matter_deadline` is admin-gated at the RLS layer and this app has no
 * path to it. A dropped hearing that leaves no trace is exactly the failure
 * this product exists to prevent.
 */
export async function satisfyDeadline(
  id: string,
  options: { status?: DeadlineCloseStatus; note?: string | null } = {},
): Promise<WriteResult<MatterDeadlineRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return fail(roleError);

  const status = options.status ?? "satisfied";
  const now = new Date().toISOString();
  const note = options.note?.trim();

  const patch: Database["public"]["Tables"]["crm_matter_deadline"]["Update"] = {
    status,
    satisfied_at: status === "satisfied" ? now : null,
    updated_at: now,
  };
  // Set only when a note was actually given: closing an entry out without a
  // comment must not erase the note someone already wrote on it.
  if (note) patch.notes = note;

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return fail({ code: "not-found", message: "That deadline isn't available any more." });
  }

  await logMatterActivity(supabase, {
    orgId: data.org_id,
    matterId: data.matter_id,
    type: "matter_updated",
    payload: {
      change: "deadline_closed",
      kind: data.kind,
      status,
      due_date: data.due_date,
    },
  });

  return ok(data);
}

// ---------------------------------------------------------------------------
// Stage moves
// ---------------------------------------------------------------------------

export type MoveMatterStageResult = {
  matter: MatterRow;
  from: MatterStage | null;
  to: MatterStage | null;
};

/**
 * Moves a matter along the firm's docket ladder.
 *
 * UNPLACED → STAGED IS THE PRIMARY CASE, NOT AN EDGE CASE. 22 of this firm's
 * 34 live litigation matters carry `stage_id IS NULL`, and placing them is
 * most of what this function will ever be asked to do. A `from` of null is
 * recorded honestly as null on the timeline rather than as an invented
 * starting stage.
 *
 * Passing `stageId: null` moves a matter back OFF the ladder. That is a real
 * state — "I no longer know where this belongs" is better than a wrong stage —
 * and the schema supports it: `stage_id` and `stage_entered_at` are checked to
 * travel together, so both are cleared as a pair.
 *
 * Staff-role-gated. Moving a matter along the ladder is ordinary work;
 * redefining the ladder itself is an admin write on `crm_matter_stage` that
 * this app never performs.
 */
export async function moveMatterStage(
  matterId: string,
  stageId: string | null,
): Promise<WriteResult<MoveMatterStageResult>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return fail(roleError);

  const matter = await readParentMatter(supabase, matterId);
  if (!matter) return fail(NOT_FOUND);

  // Both stages are resolved through the caller's own scoped client, so RLS is
  // what proves they are on this firm's ladder. The composite (stage_id,
  // org_id) FK is the backstop that makes a cross-tenant link impossible even
  // if this layer were bypassed.
  let to: MatterStage | null = null;
  if (stageId) {
    to = await getMatterStage(stageId);
    if (!to) {
      return fail({ code: "not-found", message: "That stage isn't on this firm's docket." });
    }
  }
  const from = matter.stage_id ? await getMatterStage(matter.stage_id) : null;

  if (matter.stage_id === stageId) {
    const { data, error } = await supabase
      .from("crm_matter")
      .select("*")
      .eq("id", matterId)
      .single();
    if (error) throw error;
    return ok({ matter: data, from, to });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crm_matter")
    .update({
      stage_id: stageId,
      // Paired with stage_id, always. This is the clock the stale badge reads.
      stage_entered_at: stageId ? now : null,
      updated_at: now,
    })
    .eq("id", matterId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(NOT_FOUND);

  await logMatterActivity(supabase, {
    orgId: matter.org_id,
    matterId: matter.id,
    type: "stage_changed",
    payload: {
      from_code: from?.code ?? null,
      from_label: from?.label ?? null,
      to_code: to?.code ?? null,
      to_label: to?.label ?? null,
    },
  });

  return ok({ matter: data, from, to });
}

// ---------------------------------------------------------------------------
// Litigation detail
// ---------------------------------------------------------------------------

/**
 * The editable litigation facts, camelCase the way a form posts them.
 *
 * Every key is optional and every one distinguishes `undefined` ("leave this
 * column alone") from `null` ("clear it"), so a partial form cannot blank the
 * fields it does not render.
 */
export type LitigationDetailInput = {
  county?: string | null;
  caseNumber?: string | null;
  caseStyle?: string | null;
  courtDivision?: string | null;
  judge?: string | null;
  role?: string | null;
  /** Civil date, YYYY-MM-DD. */
  filedOn?: string | null;
  caseStatus?: string | null;
  noticeOfAppearance?: string | null;
  motionToDismiss?: string | null;
  missedHearing?: string | null;
  defaultStatus?: string | null;
  /**
   * Instant, ISO-8601. Stored as a timestamptz and rendered in the court's own
   * wall clock (`@/lib/court-time`) — a hearing stored 14:00Z is a 10:00 EDT
   * appearance, and showing "2:00 PM" is how a pretrial gets missed.
   */
  nextHearingAt?: string | null;
  nextHearingPurpose?: string | null;
  notes?: string | null;
};

const LITIGATION_COLUMNS: ReadonlyArray<[keyof LitigationDetailInput, string]> = [
  ["county", "county"],
  ["caseNumber", "case_number"],
  ["caseStyle", "case_style"],
  ["courtDivision", "court_division"],
  ["judge", "judge"],
  ["role", "role"],
  ["filedOn", "filed_on"],
  ["caseStatus", "case_status"],
  ["noticeOfAppearance", "notice_of_appearance"],
  ["motionToDismiss", "motion_to_dismiss"],
  ["missedHearing", "missed_hearing"],
  ["defaultStatus", "default_status"],
  ["nextHearingAt", "next_hearing_at"],
  ["nextHearingPurpose", "next_hearing_purpose"],
  ["notes", "notes"],
];

/**
 * Writes a matter's litigation facts — creating the `crm_litigation_detail`
 * row on first save and updating it thereafter (`matter_id` is the primary
 * key, so one row per matter, always).
 *
 * Refuses on a non-LIT matter: the case-file page renders litigation facts for
 * that type alone, so writing them onto a trademark file would store data
 * nobody can see. A write into the dark is worse than a refusal.
 *
 * The timeline records WHICH fields changed, not their values. A case number
 * or a hearing date is the row's business; the timeline is not a second copy
 * of the file.
 */
export async function updateLitigationDetail(
  matterId: string,
  fields: LitigationDetailInput,
): Promise<WriteResult<LitigationDetailRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return fail(roleError);

  const matter = await readParentMatter(supabase, matterId);
  if (!matter) return fail(NOT_FOUND);

  if (matter.type !== "LIT") {
    return fail({
      code: "invalid",
      message: "Litigation details can only be recorded on a litigation matter.",
    });
  }

  const columns: Record<string, string | null> = {};
  for (const [key, column] of LITIGATION_COLUMNS) {
    const value = fields[key];
    if (value === undefined) continue;
    // An empty box means "clear it", not "store a blank string".
    columns[column] = value === null || value.trim() === "" ? null : value.trim();
  }
  if (Object.keys(columns).length === 0) {
    return fail({ code: "invalid", message: "Nothing to save." });
  }

  const { data, error } = await supabase
    .from("crm_litigation_detail")
    .upsert(
      {
        matter_id: matter.id,
        // Off the parent row. Never off the input.
        org_id: matter.org_id,
        ...columns,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "matter_id" },
    )
    .select("*")
    .single();
  if (error) {
    if (errorCode(error) === PG_CHECK_VIOLATION) {
      return fail({
        code: "rejected",
        message: "One of those entries is too long to save — shorten it and try again.",
      });
    }
    throw error;
  }

  await logMatterActivity(supabase, {
    orgId: matter.org_id,
    matterId: matter.id,
    type: "matter_updated",
    payload: { change: "litigation_detail", fields: Object.keys(columns) },
  });

  return ok(data);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Appends a note to a matter's timeline.
 *
 * There is no note table: a note IS a `crm_activity` row of type `'note'`, and
 * that table is append-only — DB triggers reject UPDATE and DELETE on every
 * path, including the service role. So a note cannot be edited and cannot be
 * withdrawn. That is a property worth surfacing in the UI before the box is
 * submitted, not a limitation to work around here.
 */
export async function appendNote(
  matterId: string,
  body: string,
): Promise<WriteResult<ActivityRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return fail(roleError);

  const text = body?.trim();
  if (!text) return fail({ code: "invalid", message: "A note needs something in it." });

  const matter = await readParentMatter(supabase, matterId);
  if (!matter) return fail(NOT_FOUND);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { data, error } = await supabase
    .from("crm_activity")
    .insert({
      // Off the parent row. Never off the input.
      org_id: matter.org_id,
      matter_id: matter.id,
      type: "note",
      actor_type: "user",
      actor_id: user?.id ?? null,
      payload: { body: text } as Json,
    })
    .select("*")
    .single();
  if (error) throw error;

  return ok(data);
}
