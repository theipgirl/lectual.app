import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import { logActivitySafe } from "@/lib/matters";
import { CAN_WRITE_LEAD, resolveCurrentRole } from "@/lib/pipeline/leads";
import { LeadWriteError, forbiddenLeadWrite } from "@/lib/pipeline/errors";
import type { Role } from "@/lib/auth/roles";
import type { TimeEntry } from "./rollup";

/**
 * Reads and writes for the ⏱ on an intake card (blueprint §13.1).
 *
 * Every statement goes through getScopedClient(), so RLS (the four
 * crm_time_entry policies in 0056) is the tenant boundary and no org_id filter
 * is applied by hand — AGENTS.md. org_id is never taken from the caller
 * either: it is read off the parent lead or matter through the same scoped
 * client, exactly as logActivity does, so the denormalised column RLS keys on
 * can never drift from its parent's real org.
 *
 * What this is NOT: billing. A row here is internal effort — how long someone
 * spent on an intake card — and nothing in this module or the table behind it
 * carries a rate, a currency or a billable flag. RPB bills flat fees and
 * Lectual bills flat fees (AGENTS.md non-negotiables); a time entry never
 * reaches a client and never becomes an invoice line.
 *
 * NOT re-exported from src/lib/time/index.ts on purpose — see that file.
 */

export type { TimeEntry };

export type TimeTarget = {
  leadId?: string | null;
  matterId?: string | null;
  /**
   * Log against somebody ELSE. Refused for every role but the three below, and
   * validated against the org's member directory before it is written — the id
   * can arrive from a form, and RLS alone would happily store a well-formed
   * uuid belonging to nobody.
   */
  userId?: string | null;
};

/**
 * Roles allowed to log time at all. The same list as CAN_WRITE_LEAD, and the
 * same list as crm_time_entry_insert_staff's role predicate in 0056 — reused
 * rather than re-typed so the two cannot drift. RLS is the real boundary; this
 * exists so a refusal reads as a sentence instead of a Postgres error.
 */
export const CAN_LOG_TIME: Role[] = CAN_WRITE_LEAD;

/**
 * Roles allowed to log time under someone else's name — the other half of
 * 0056's write predicate. An office manager fixing a colleague's forgotten
 * Stop is legitimate; a paralegal putting three hours against the law clerk's
 * name is not a mistake the product should make possible.
 */
export const CAN_LOG_FOR_OTHERS: Role[] = ["owner", "admin", "senior_admin"];

/** Twelve hours. A manual entry longer than a working day is a typo, not work. */
export const MAX_MANUAL_SECONDS = 12 * 3600;

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

async function callerId(supabase: ScopedClient): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new LeadWriteError("You're signed out — sign in and try again.");
  return user.id;
}

/** Role gate, re-resolved on every call so a revoked role bites immediately. */
async function requireTimeRole(supabase: ScopedClient, what: string): Promise<Role> {
  const role = await resolveCurrentRole(supabase);
  if (!CAN_LOG_TIME.includes(role)) throw forbiddenLeadWrite(role, what);
  return role;
}

/**
 * Whose row this is. Always the caller, unless an owner/admin/senior_admin
 * deliberately named someone else AND that someone is a member of this org.
 */
async function resolveSubject(
  target: TimeTarget,
  caller: string,
  role: Role,
): Promise<string> {
  const requested = target.userId?.trim();
  if (!requested || requested === caller) return caller;
  if (!CAN_LOG_FOR_OTHERS.includes(role)) {
    throw forbiddenLeadWrite(role, "log time for someone else");
  }
  const directory = await listMemberDirectory();
  if (!directory.some((member) => member.userId === requested)) {
    throw new LeadWriteError("That person isn't a member of this firm.");
  }
  return requested;
}

/**
 * The org the entry belongs to, read off its parent row.
 *
 * A parent the scoped client cannot see comes back empty, which is how a
 * cross-org id becomes "isn't visible to your firm" instead of a foreign-key
 * error naming a table.
 */
async function orgIdForTarget(supabase: ScopedClient, target: TimeTarget): Promise<string> {
  if (target.leadId) {
    const { data, error } = await supabase
      .from("crm_lead")
      .select("org_id")
      .eq("id", target.leadId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new LeadWriteError("That lead no longer exists, or isn't visible to your firm.");
    return data.org_id;
  }
  const { data, error } = await supabase
    .from("crm_matter")
    .select("org_id")
    .eq("id", target.matterId!)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LeadWriteError("That matter no longer exists, or isn't visible to your firm.");
  return data.org_id;
}

function requireTarget(target: TimeTarget): void {
  if (!target.leadId && !target.matterId) {
    throw new LeadWriteError("Time has to be logged against a lead or a matter.");
  }
}

/** "You already have a timer running on Marisol Okafor." */
async function alreadyRunning(
  supabase: ScopedClient,
  running: Pick<TimeEntry, "lead_id" | "matter_id">,
): Promise<LeadWriteError> {
  let where = "something else";
  if (running.lead_id) {
    const { data } = await supabase
      .from("crm_lead")
      .select("first_name, last_name, business_name")
      .eq("id", running.lead_id)
      .maybeSingle();
    const name = data
      ? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || data.business_name?.trim()
      : null;
    where = name || "another lead";
  } else if (running.matter_id) {
    where = "a matter";
  }
  return new LeadWriteError(
    `You already have a timer running on ${where}. Stop it before starting another.`,
  );
}

/** The caller's open timer, or null. One row at most — 0056's partial unique index. */
export async function runningForMe(): Promise<TimeEntry | null> {
  const supabase = await getScopedClient();
  const caller = await callerId(supabase);
  const { data, error } = await supabase
    .from("crm_time_entry")
    .select("*")
    .eq("user_id", caller)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Starts a clock on a lead (or a matter).
 *
 * Refused when the subject already has one running. The database says so too —
 * crm_time_entry_one_running_per_user — and the 23505 that index raises is
 * translated below rather than left to leak a constraint name, because two
 * browser tabs can both pass the check above and only one can win the insert.
 *
 * No timeline row is written here. A start is not yet a fact about how long
 * anything took, and a `time_logged` activity with zero seconds would be a
 * row the firm has to learn to ignore. Stop and manual entries log; start
 * does not.
 */
export async function startTimer(target: TimeTarget): Promise<TimeEntry> {
  requireTarget(target);

  const supabase = await getScopedClient();
  const role = await requireTimeRole(supabase, "log time");
  const caller = await callerId(supabase);
  const userId = await resolveSubject(target, caller, role);
  const orgId = await orgIdForTarget(supabase, target);

  const { data: open, error: openError } = await supabase
    .from("crm_time_entry")
    .select("id, lead_id, matter_id")
    .eq("user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (openError) throw openError;
  if (open) throw await alreadyRunning(supabase, open);

  const { data, error } = await supabase
    .from("crm_time_entry")
    .insert({
      org_id: orgId,
      lead_id: target.leadId ?? null,
      matter_id: target.matterId ?? null,
      user_id: userId,
      started_at: new Date().toISOString(),
      seconds: 0,
    })
    .select("*");
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new LeadWriteError(
        "A timer is already running — it may have been started in another tab. Refresh and stop it first.",
      );
    }
    throw error;
  }

  const created = (data ?? [])[0];
  if (!created) {
    throw new LeadWriteError("Couldn't start a timer here — refresh and try again.");
  }
  return created;
}

/**
 * Closes a running entry and records how long it ran.
 *
 * The duration is computed HERE, from the stored `started_at` to the server's
 * `now`. The browser's clock never contributes: it can be wrong, it can be
 * paused by a sleeping laptop, and it is trivially editable — none of which
 * should decide a number the firm reads back as effort.
 *
 * Deliberately NOT capped. A timer left running overnight records the hours it
 * actually ran; §13.3's 8-hour `time_running` notification is how a forgotten
 * clock gets noticed, and silently trimming it would hide the mistake instead
 * of surfacing it. (The 12-hour cap applies to MANUAL entries, where the
 * number is typed rather than measured.)
 */
export async function stopTimer(entryId: string, note?: string | null): Promise<TimeEntry> {
  if (!entryId) throw new LeadWriteError("Missing timer.");

  const supabase = await getScopedClient();
  await requireTimeRole(supabase, "log time");

  const { data: entry, error: readError } = await supabase
    .from("crm_time_entry")
    .select("id, lead_id, matter_id, started_at, ended_at")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) throw readError;
  if (!entry) throw new LeadWriteError("That timer no longer exists, or isn't visible to your firm.");
  if (entry.ended_at) throw new LeadWriteError("That timer has already been stopped.");

  const endedAt = new Date();
  const started = Date.parse(entry.started_at);
  const seconds = Number.isFinite(started)
    ? Math.max(0, Math.floor((endedAt.getTime() - started) / 1000))
    : 0;
  const trimmed = note?.trim() || null;

  const { data, error } = await supabase
    .from("crm_time_entry")
    .update({ ended_at: endedAt.toISOString(), seconds, note: trimmed })
    .eq("id", entryId)
    // The guard against a second Stop racing the first: whoever gets there
    // last matches zero rows rather than overwriting the first one's duration.
    .is("ended_at", null)
    .select("*");
  if (error) throw error;

  // Zero affected rows is NOT an error to PostgREST — an update whose USING
  // clause matches nothing simply succeeds. Selecting an array rather than
  // .single() is what keeps a cross-org id or a raced Stop from coming back as
  // a green "saved" (same reasoning as setTemperature in src/lib/intake/leads.ts).
  const stopped = (data ?? [])[0];
  if (!stopped) {
    throw new LeadWriteError("That timer has already been stopped, or isn't yours to stop.");
  }

  await logTimeActivity(stopped);
  return stopped;
}

/**
 * Adds an entry for work that has already happened — the "+ time" path, for
 * the call nobody clicked Start before taking.
 *
 * `at` is when the work ENDED (default: now), so `started_at` is back-computed
 * as `at - seconds`. That keeps the stored row indistinguishable from a
 * measured one, which is what lets every roll-up treat the two identically.
 *
 * Two refusals, both because a typed number has no clock behind it to sanity
 * check it: nothing longer than 12 hours, and nothing in the future. Future
 * time is not "effort logged early", it is a keystroke error — and a week
 * total that includes work nobody has done yet is worse than no total.
 */
export async function addManualEntry(
  target: TimeTarget,
  seconds: number,
  note?: string | null,
  at?: Date,
): Promise<TimeEntry> {
  requireTarget(target);

  if (!Number.isFinite(seconds) || Math.floor(seconds) <= 0) {
    throw new LeadWriteError("How long was it? Enter a duration above zero.");
  }
  const whole = Math.floor(seconds);
  if (whole > MAX_MANUAL_SECONDS) {
    throw new LeadWriteError("That's more than 12 hours — log it as more than one entry.");
  }

  const endedAt = at ?? new Date();
  if (!Number.isFinite(endedAt.getTime())) {
    throw new LeadWriteError("That isn't a date we can read.");
  }
  const now = Date.now();
  // A minute of slack, because a browser clock a few seconds fast should not
  // refuse an entry the person is logging right now.
  if (endedAt.getTime() > now + 60_000) {
    throw new LeadWriteError("You can't log time in the future.");
  }

  const supabase = await getScopedClient();
  const role = await requireTimeRole(supabase, "log time");
  const caller = await callerId(supabase);
  const userId = await resolveSubject(target, caller, role);
  const orgId = await orgIdForTarget(supabase, target);

  const { data, error } = await supabase
    .from("crm_time_entry")
    .insert({
      org_id: orgId,
      lead_id: target.leadId ?? null,
      matter_id: target.matterId ?? null,
      user_id: userId,
      started_at: new Date(endedAt.getTime() - whole * 1000).toISOString(),
      ended_at: endedAt.toISOString(),
      seconds: whole,
      note: note?.trim() || null,
    })
    .select("*");
  if (error) throw error;

  const created = (data ?? [])[0];
  if (!created) {
    throw new LeadWriteError("Couldn't log that time — refresh and try again.");
  }

  await logTimeActivity(created);
  return created;
}

/**
 * Removes an entry.
 *
 * RLS decides who may: your own, or anyone's if you are owner/admin/
 * senior_admin (crm_time_entry_delete_own_or_admin). Nothing is written to the
 * timeline — crm_activity is append-only by trigger, so the `time_logged` row
 * the entry produced stays exactly where it is, and inventing a second
 * "deleted" row to explain the first would be a new vocabulary for a very rare
 * correction.
 */
export async function deleteEntry(id: string): Promise<void> {
  if (!id) throw new LeadWriteError("Missing entry.");

  const supabase = await getScopedClient();
  await requireTimeRole(supabase, "log time");

  const { data, error } = await supabase.from("crm_time_entry").delete().eq("id", id).select("id");
  if (error) throw error;
  if ((data ?? []).length === 0) {
    throw new LeadWriteError("That entry is already gone, or isn't yours to delete.");
  }
}

/**
 * Every entry on these leads since `since`, newest first — one query for a
 * whole page of cards rather than one per row.
 *
 * Throws on a query error, never returns an empty array for a failed read:
 * the chip's three states (a total, "nothing yet", "we couldn't tell") depend
 * on the failure being distinguishable, and "0m" on a broken read would tell a
 * firm nobody has touched a lead all week when somebody has.
 *
 * A timer that started BEFORE `since` is outside the window by definition;
 * the caller's own running one is fetched separately by runningForMe() so it
 * is never missed.
 */
export async function listForLeads(leadIds: string[], since: Date | string): Promise<TimeEntry[]> {
  const ids = Array.from(new Set(leadIds.filter(Boolean)));
  // Nothing to ask about. Returned early rather than issuing `in.()`, which is
  // a valid-but-odd PostgREST URL for "match nothing" — same shape as
  // listIntakeLeads' empty-stage guard.
  if (ids.length === 0) return [];

  const sinceIso = typeof since === "string" ? since : since.toISOString();
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_time_entry")
    .select("*")
    .in("lead_id", ids)
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * The timeline row for a closed entry (0056 adds the `time_logged` activity
 * type for exactly this). Best-effort: a failed audit row must never roll back
 * time the user watched being recorded — see logActivitySafe's contract.
 *
 * The payload carries the entry id, the duration and the note, and nothing
 * else. It is an internal memo about internal effort; it is never sent
 * anywhere and never reaches a client.
 */
async function logTimeActivity(entry: TimeEntry): Promise<void> {
  await logActivitySafe({
    type: "time_logged",
    leadId: entry.lead_id ?? undefined,
    matterId: entry.matter_id ?? undefined,
    payload: { entry_id: entry.id, seconds: entry.seconds, note: entry.note },
  });
}
