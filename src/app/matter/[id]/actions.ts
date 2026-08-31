"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ROLES, type Role } from "@/lib/auth/roles";
import { courtWallClockToUtcIso } from "@/lib/court-time";
import { getScopedClient } from "@/lib/db/scoped-client";
import {
  ANSWER_CLOCK_BASIS,
  computeAnswerClock,
} from "@/lib/deadlines/answer-clock";
import { isCivilDate } from "@/lib/deadlines/urgency";
import {
  DEADLINE_CONFIRM_ROLES,
  MATTER_WRITE_ROLES,
  appendNote,
  confirmDeadline,
  createDeadline,
  satisfyDeadline,
  updateLitigationDetail,
  type WriteError,
  type WriteResult,
} from "@/lib/matters/write";
import { completeTask, createTask } from "@/lib/tasks";

/**
 * Server actions for `/matter/[id]` — thin wrappers over `@/lib/matters/write`
 * and `@/lib/tasks`.
 *
 * WHAT THIS FILE IS ALLOWED TO DO. It reads a form, turns strings into the
 * arguments the write layer already validates, and turns the write layer's
 * `WriteResult` into a redirect the page can render. It contains no query, no
 * table name and no `org_id` — every one of those belongs a layer down, where
 * the rule "org_id is read off the parent row" is stated once and holds for
 * every caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE RULES THIS FILE ENFORCES IN ITS OWN RIGHT
 *
 * 1. THE ROLE IS RE-CHECKED HERE, ON EVERY ACTION, EVEN THOUGH THE WRITE LAYER
 *    CHECKS IT TOO. A server action is a public HTTP endpoint: its id ships to
 *    the browser and anything can POST to it, so "the page only renders this
 *    button for an attorney" is a statement about the page, not about the
 *    endpoint. `gate()` resolves the caller's role from the database on every
 *    single invocation — never from a cache, never from a prop, never from the
 *    form — and RLS is still the boundary underneath both checks.
 *
 * 2. NOTHING IDENTIFYING IS TAKEN FROM THE FORM. The only field read out of a
 *    submission that reaches the database is a matter id, a row id and the
 *    user's own typed content. `org_id` is never read here — there is no
 *    `formData.get("org_id")` in this file and there must never be one — and
 *    neither is any actor id: the write layer stamps `actor_id` and
 *    `confirmed_by` from the session. A hidden field is an attacker-controlled
 *    string that happens to have travelled through our own HTML.
 *
 * 3. A SUGGESTED DATE IS RECOMPUTED SERVER-SIDE, NEVER ACCEPTED AS POSTED.
 *    `docketAnswerDate` takes the SERVICE date and runs the answer clock again
 *    here; the date rendered in the browser is not trusted to be the date that
 *    gets docketed. It is written `source: 'manual'`, `anchor_event: 'service'`,
 *    `anchor_date: <the service date>`, with `ANSWER_CLOCK_BASIS` recorded in
 *    `calculation_basis` and `attorney_confirmed` false. A calculated deadline
 *    source is not written anywhere in this app and is not even representable
 *    in the write layer's input type.
 *
 * ERRORS TRAVEL AS A REDIRECT, NOT AS THROWN STATE. Every action ends by
 * revalidating the case file and redirecting back to it with `?notice=` or
 * `?error=`, so the whole surface stays server-rendered — no client state
 * machine, and a refusal survives a page reload instead of evaporating.
 */

// ── Where an action lands when it is done ────────────────────────────────────

/**
 * The case file's own URL. `trailingSlash: true` in `next.config.ts`, so the
 * slash is part of the path rather than a redirect hop.
 */
function matterPath(matterId: string): string {
  return `/matter/${encodeURIComponent(matterId)}/`;
}

type Landing = {
  /** Short confirmation of what was written. */
  notice?: string;
  /** Why nothing was written. */
  error?: string;
  /**
   * The open deadline standing in the way of a docket, for the "supersede
   * that one?" offer. Carried as an id only; the page reads the row itself.
   */
  existing?: string;
  /** Anchors the browser at the section the action came from. */
  hash?: string;
};

/**
 * Ends an action: revalidate the case file, then send the browser back to it.
 *
 * `redirect()` signals by throwing, so this never returns and must be the last
 * thing an action does. Revalidation happens first, unconditionally — a failed
 * write leaves the page unchanged, and re-reading it costs one request while
 * serving a stale docket could cost a hearing.
 */
function land(matterId: string, result: Landing): never {
  revalidatePath(matterPath(matterId));

  const query = new URLSearchParams();
  if (result.notice) query.set("notice", result.notice);
  if (result.error) query.set("error", result.error);
  if (result.existing) query.set("existing", result.existing);

  const search = query.toString();
  const suffix = search === "" ? "" : `?${search}`;
  const hash = result.hash ? `#${result.hash}` : "";
  redirect(`${matterPath(matterId)}${suffix}${hash}`);
}

/** Turns a write-layer refusal into the landing the page will render. */
function landing(error: WriteError, hash?: string): Landing {
  return {
    error: error.message,
    existing: error.code === "already-open" ? (error.existing?.id ?? undefined) : undefined,
    hash,
  };
}

// ── The role gate ────────────────────────────────────────────────────────────

/**
 * The caller's role in their active org, asked of the database on every call.
 *
 * `current_org_role()` is the same JWT-claim-backed function the RLS policies
 * themselves use, so this check and the boundary underneath it read the same
 * source. Nothing is memoised: a role can be revoked between two clicks, and
 * an action that trusted a value resolved a page-render ago would be acting on
 * a membership that no longer exists.
 */
async function currentRole(): Promise<Role | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw error;
  return typeof data === "string" && (ROLES as readonly string[]).includes(data)
    ? (data as Role)
    : null;
}

/**
 * `null` when the caller holds one of `allowed`, a refusal sentence otherwise.
 * The write layer repeats this check against its own list; both are app-side
 * courtesies over RLS, which is what actually refuses the row.
 */
async function gate(allowed: readonly Role[], subject: string): Promise<string | null> {
  const role = await currentRole();
  if (!role) return "You don't have access to this firm's matters.";
  if (!allowed.includes(role)) return `Your role doesn't allow ${subject}.`;
  return null;
}

// ── Form reading ─────────────────────────────────────────────────────────────

/** A trimmed field, or `undefined` when it was absent or blank. */
function text(form: FormData, name: string): string | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * A field a form is allowed to CLEAR: present-but-blank reads as `null` ("empty
 * this column"), absent reads as `undefined` ("this form doesn't render that
 * column, leave it alone"). The write layer keys on exactly this distinction,
 * so a partial form cannot blank the fields it never showed.
 */
function clearable(form: FormData, name: string): string | null | undefined {
  const raw = form.get(name);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** A required row id. Actions refuse rather than guess. */
function requireId(form: FormData, name: string): string | null {
  return text(form, name) ?? null;
}

/**
 * A `datetime-local` reading, interpreted as the COURT'S wall clock.
 *
 * `<input type="datetime-local">` yields a bare "2026-09-04T10:00" with no
 * zone, and the browser's zone is the one thing that must not decide what it
 * means: the same string typed in Florida and in California would otherwise
 * store two different instants for one hearing. `courtWallClockToUtcIso` reads
 * it in `America/New_York`, which is where the hearing is actually called.
 */
function courtInstant(form: FormData, name: string): string | null | undefined {
  const raw = clearable(form, name);
  if (raw === undefined || raw === null) return raw;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (!match) return undefined; // Unparseable: leave the stored instant alone.
  const [, y, mo, d, h, mi] = match;
  return courtWallClockToUtcIso(Number(y), Number(mo), Number(d), Number(h), Number(mi));
}

// ── Deadlines ────────────────────────────────────────────────────────────────

/**
 * Dockets one of the answer clock's suggested dates.
 *
 * THE ONLY INPUT THAT MATTERS IS THE SERVICE DATE. The suggested date the user
 * saw is not posted back and would not be believed if it were — the clock is
 * re-run here from `servedOn`, so what lands on the docket is what this
 * server's own arithmetic produces from the anchor the attorney entered.
 *
 * The row it writes:
 *
 *   source              'manual'      — she made this determination, not us
 *   anchor_event        'service'     — what the period runs from
 *   anchor_date         servedOn      — the anchor's own civil date
 *   calculation_basis   the basis sentence, verbatim, naming the interval,
 *                       naming whose rule it is, and saying it still has to be
 *                       checked against the applicable rule and the docket
 *   attorney_confirmed  false         — set by the write layer, unconditionally
 *
 * A calculated deadline source is never written. Twenty days is her own
 * standing office rule; asserting it as a computed procedural period would be
 * a legal determination this product does not make.
 *
 * There is no `answer` value in the deadline-kind enum, so the row is docketed
 * as `other` carrying an explicit title. Inventing a kind is a schema change,
 * and schema for this product lives in another repository.
 */
export async function docketAnswerDate(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "changes to a matter");
  if (refusal) land(matterId, { error: refusal, hash: "answer-clock" });

  const servedOn = text(form, "servedOn");
  if (!isCivilDate(servedOn)) {
    land(matterId, {
      error: "Enter the date of service as a real calendar date before docketing.",
      hash: "answer-clock",
    });
  }

  // Which of the two suggested dates was clicked. Anything else is refused
  // rather than defaulted — a mis-typed value must not silently docket the
  // wrong one of two dates a day apart.
  const which = text(form, "which");
  if (which !== "answer" && which !== "default") {
    land(matterId, { error: "That suggestion is no longer available.", hash: "answer-clock" });
  }

  const clock = computeAnswerClock({ servedOn });
  const isAnswer = which === "answer";
  const dueDate = isAnswer ? clock.answerDue : clock.defaultEligibleOn;
  const title = isAnswer ? "Answer due" : "Default may be sought";

  const result = await createDeadline({
    matterId,
    kind: "other",
    title,
    dueDate,
    source: "manual",
    anchorEvent: "service",
    anchorDate: servedOn,
    calculationBasis: ANSWER_CLOCK_BASIS,
  });

  if (!result.ok) land(matterId, landing(result.error, "answer-clock"));
  land(matterId, {
    notice: `${title} docketed for ${dueDate}. Unconfirmed until an attorney reviews it.`,
    hash: "deadlines",
  });
}

/**
 * Records that a licensed attorney has checked a docket date against the office
 * record.
 *
 * Attorney-and-owner only, three times over: this gate, the write layer's own
 * list, and the database trigger that stamps `confirmed_by` from the session
 * and drops the confirmation again if the date later moves. Nothing in the
 * form can influence who the confirmation is recorded against.
 */
export async function confirmDeadlineAction(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(
    DEADLINE_CONFIRM_ROLES,
    "confirming a docket date — only a licensed attorney can",
  );
  if (refusal) land(matterId, { error: refusal, hash: "deadlines" });

  const deadlineId = requireId(form, "deadlineId");
  if (!deadlineId) land(matterId, { error: "No deadline was named.", hash: "deadlines" });

  const result = await confirmDeadline(deadlineId);
  if (!result.ok) land(matterId, landing(result.error, "deadlines"));
  land(matterId, { notice: "Docket date confirmed.", hash: "deadlines" });
}

/**
 * Closes a docket entry out — satisfied, waived, or superseded.
 *
 * Nothing is deleted. A dropped hearing that leaves no trace on the file is the
 * exact failure this product exists to prevent, so the row stays and records
 * what happened to it. `superseded` is what the "there's already an open one"
 * collision offers: a court moving a date is a replacement, not a completion,
 * and the two are worth telling apart a year later.
 */
export async function closeDeadlineAction(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "changes to a matter");
  if (refusal) land(matterId, { error: refusal, hash: "deadlines" });

  const deadlineId = requireId(form, "deadlineId");
  if (!deadlineId) land(matterId, { error: "No deadline was named.", hash: "deadlines" });

  const requested = text(form, "status");
  const status =
    requested === "waived" ? "waived" : requested === "superseded" ? "superseded" : "satisfied";

  const result = await satisfyDeadline(deadlineId, { status, note: text(form, "note") ?? null });
  if (!result.ok) land(matterId, landing(result.error, "deadlines"));
  land(matterId, {
    notice:
      status === "superseded"
        ? "That entry is closed as superseded. Docket the replacement date now."
        : `Deadline marked ${status}.`,
    hash: "deadlines",
  });
}

// ── Litigation detail ────────────────────────────────────────────────────────

/**
 * Saves the litigation facts — venue, judge, case style, the next hearing, the
 * default posture.
 *
 * Every field is `clearable`, so an emptied box clears the column and an
 * omitted box is left alone. `nextHearingAt` arrives as a court wall-clock
 * reading and is converted here; the write layer stores the instant and the
 * page renders it back in court time with the zone named.
 */
export async function saveLitigationDetail(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "changes to a matter");
  if (refusal) land(matterId, { error: refusal, hash: "litigation" });

  const result = await updateLitigationDetail(matterId, {
    county: clearable(form, "county"),
    caseNumber: clearable(form, "caseNumber"),
    caseStyle: clearable(form, "caseStyle"),
    courtDivision: clearable(form, "courtDivision"),
    judge: clearable(form, "judge"),
    role: clearable(form, "role"),
    filedOn: clearable(form, "filedOn"),
    caseStatus: clearable(form, "caseStatus"),
    noticeOfAppearance: clearable(form, "noticeOfAppearance"),
    motionToDismiss: clearable(form, "motionToDismiss"),
    missedHearing: clearable(form, "missedHearing"),
    defaultStatus: clearable(form, "defaultStatus"),
    nextHearingAt: courtInstant(form, "nextHearingAt"),
    nextHearingPurpose: clearable(form, "nextHearingPurpose"),
    notes: clearable(form, "notes"),
  });

  if (!result.ok) land(matterId, landing(result.error, "litigation"));
  land(matterId, { notice: "Litigation details saved.", hash: "litigation" });
}

// ── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Adds a task to the matter. Times are read in court time for the same reason
 * hearings are: a task due "9am" is due at 9am where the office is.
 */
export async function addTaskAction(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "adding a task");
  if (refusal) land(matterId, { error: refusal, hash: "tasks" });

  const title = text(form, "title");
  if (!title) land(matterId, { error: "A task needs a title.", hash: "tasks" });

  const dueAt = courtInstant(form, "dueAt");
  const result: WriteResult<unknown> = await createTask({
    matterId,
    title,
    dueAt: dueAt ?? null,
  });

  if (!result.ok) land(matterId, landing(result.error, "tasks"));
  land(matterId, { notice: "Task added.", hash: "tasks" });
}

/** Marks a task complete. Staff-role-gated; the task keeps its row. */
export async function completeTaskAction(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "changes to a task");
  if (refusal) land(matterId, { error: refusal, hash: "tasks" });

  const taskId = requireId(form, "taskId");
  if (!taskId) land(matterId, { error: "No task was named.", hash: "tasks" });

  const result: WriteResult<unknown> = await completeTask(taskId);
  if (!result.ok) land(matterId, landing(result.error, "tasks"));
  land(matterId, { notice: "Task completed.", hash: "tasks" });
}

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * Appends a note to the matter's timeline.
 *
 * A note IS a `crm_activity` row, and that table is trigger-blocked against
 * UPDATE and DELETE for every role including the service role. A note cannot be
 * edited and cannot be withdrawn once it is written — the page says so above
 * the box, before it is submitted.
 */
export async function addNoteAction(form: FormData): Promise<void> {
  const matterId = requireId(form, "matterId");
  if (!matterId) return;

  const refusal = await gate(MATTER_WRITE_ROLES, "adding a note");
  if (refusal) land(matterId, { error: refusal, hash: "activity" });

  const body = text(form, "body");
  if (!body) land(matterId, { error: "A note needs something in it.", hash: "activity" });

  const result = await appendNote(matterId, body);
  if (!result.ok) land(matterId, landing(result.error, "activity"));
  land(matterId, { notice: "Note added to the timeline — permanently.", hash: "activity" });
}
