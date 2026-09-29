import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";
import { logActivity } from "./activity";
import {
  type DeadlineKind,
  type DeadlineSource,
  type DeadlineStatus,
  deadlineKindLabel,
  deadlineRule,
} from "./deadline-rules";

export type MatterDeadline = Database["public"]["Tables"]["crm_matter_deadline"]["Row"];

/**
 * The docket (crm_matter_deadline, supabase/migrations/0035_matter_ip_fields.sql).
 *
 * Two things this module deliberately does NOT do:
 *
 *  1. It never creates a deadline on its own. Opening a matter, changing a
 *     status, or importing a record does not silently docket a date. Every row
 *     here is written by an explicit human action, so nobody ends up relying on
 *     a date the firm never chose to put on the calendar.
 *
 *  2. It never confirms a date. `attorney_confirmed` can only be flipped by
 *     confirmDeadline, which is restricted to attorney/owner at the app layer
 *     AND at the database layer (the crm_matter_deadline_confirmation_guard
 *     trigger, which also stamps the confirmer from auth.uid() and drops the
 *     confirmation if the date later moves). Lectual is software, not a law
 *     firm: a calculated date stays an unconfirmed reminder until a licensed
 *     attorney says otherwise.
 *
 * org_id is always read off the parent matter, never taken from caller input —
 * same rule as logActivity and createTask, so the denormalized column RLS reads
 * can never drift from the matter's real tenant.
 */

/**
 * Roles whose confirmation counts. The DB trigger is the real boundary; this
 * list is the app-side half of the same contract and must not drift from it.
 * Rebecca P. Beliard, the founding attorney, holds the owner seat — hence both.
 */
export const DEADLINE_CONFIRM_ROLES = ["owner", "attorney"] as const;

export type CreateDeadlineInput = {
  matterId: string;
  kind: DeadlineKind;
  /** Civil date, YYYY-MM-DD. */
  dueDate: string;
  title?: string | null;
  anchorEvent?: string | null;
  anchorDate?: string | null;
  source?: DeadlineSource;
  /** Plain-language record of the interval used, when source is 'calculated'. */
  calculationBasis?: string | null;
  isExtendable?: boolean;
  maxExtensions?: number | null;
  notes?: string | null;
};

/** Deadlines on one matter, soonest first; closed-out entries last. */
export async function listMatterDeadlines(matterId: string): Promise<MatterDeadline[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .select("*")
    .eq("matter_id", matterId)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type UpcomingDeadline = MatterDeadline & {
  matter_number: string;
  matter_title: string | null;
};

/**
 * Open deadlines across the org, soonest first — the query behind a real
 * "Deadlines" surface. Past-due entries are included (they are the ones that
 * matter most); "overdue" is derived from due_date at render time and never
 * stored.
 *
 * `withinDays` bounds the far end only. RLS scopes rows to the caller's org.
 */
export async function listUpcomingDeadlines(
  options: { withinDays?: number; limit?: number } = {},
): Promise<UpcomingDeadline[]> {
  const supabase = await getScopedClient();
  let query = supabase
    .from("crm_matter_deadline")
    .select("*, crm_matter!inner(matter_number, title)")
    .eq("status", "open");

  if (options.withinDays != null) {
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + options.withinDays);
    query = query.lte("due_date", horizon.toISOString().slice(0, 10));
  }

  query = query.order("due_date", { ascending: true });
  if (options.limit != null) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const { crm_matter: matter, ...rest } = row as MatterDeadline & {
      crm_matter: { matter_number: string; title: string | null } | null;
    };
    return {
      ...rest,
      matter_number: matter?.matter_number ?? "",
      matter_title: matter?.title ?? null,
    };
  });
}

/**
 * Dockets a deadline. Staff-role-gated (MATTER_WRITE_ROLES) — anyone on the
 * team can put a date on the calendar. The row is always written UNCONFIRMED:
 * confirmation is a separate, attorney-only act.
 *
 * Extendability defaults to the reference rule for the kind rather than to
 * `false`, so a Statement of Use does not silently look non-extendable; the
 * caller can override both flags explicitly.
 */
export async function createDeadline(input: CreateDeadlineInput): Promise<MatterDeadline> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("org_id, filing_basis")
    .eq("id", input.matterId)
    .single();
  if (matterError) throw matterError;

  const rule = deadlineRule(input.kind, matter.filing_basis);
  const isExtendable = input.isExtendable ?? rule.extendable;
  const maxExtensions = isExtendable ? (input.maxExtensions ?? rule.maxExtensions) : null;

  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .insert({
      org_id: matter.org_id,
      matter_id: input.matterId,
      kind: input.kind,
      title: input.title ?? null,
      due_date: input.dueDate,
      anchor_event: input.anchorEvent ?? null,
      anchor_date: input.anchorDate ?? null,
      source: input.source ?? "calculated",
      calculation_basis: input.calculationBasis ?? null,
      is_extendable: isExtendable,
      max_extensions: maxExtensions,
      notes: input.notes ?? null,
      // Never pre-confirmed, whoever is asking.
      attorney_confirmed: false,
      created_by: user?.user?.id ?? null,
    })
    .select("*")
    .single();
  if (error) {
    // 23505 here is crm_matter_deadline_one_open_per_kind: a matter may hold
    // only one OPEN entry per kind — two open Office Action response dates on
    // one file is a docketing error. That index (0053) excludes exactly seven
    // kinds, the litigation ones (hearing, hearing_request, motion_response,
    // notice_of_appeal, set_aside_default, status_check, trial): those are
    // event classes, not statutory clocks, so a matter can genuinely hold more
    // than one open entry of the same kind.
    //
    // Everything else is still constrained — every USPTO trademark kind AND
    // `other`, which is not a trademark kind but is not exempt either. So if
    // this fires, `input.kind` is one of those; say so plainly instead of
    // surfacing a constraint name.
    if ((error as { code?: string }).code === "23505") {
      throw new Error(
        `This matter already has an open "${deadlineKindLabel(input.kind)}" deadline. Close that one out or edit its date instead of adding a second.`,
      );
    }
    throw error;
  }

  await logActivity({
    type: "matter_updated",
    matterId: input.matterId,
    payload: {
      change: "deadline_docketed",
      kind: input.kind,
      label: data.title ?? deadlineKindLabel(input.kind),
      due_date: input.dueDate,
      source: data.source,
      attorney_confirmed: false,
    },
  });

  return data;
}

/**
 * Records that a licensed attorney has checked this date against the office
 * record and stands behind it.
 *
 * Gated twice on purpose. The DB trigger is the boundary that actually holds
 * (it also stamps confirmed_by from the session, so the audit trail can never
 * be supplied by the form); this app-layer check exists so a paralegal gets a
 * clear refusal instead of a raw Postgres error.
 */
export async function confirmDeadline(id: string): Promise<MatterDeadline> {
  const supabase = await getScopedClient();
  const { data: role, error: roleError } = await supabase.rpc("current_org_role");
  if (roleError) throw roleError;
  if (typeof role !== "string" || !(DEADLINE_CONFIRM_ROLES as readonly string[]).includes(role)) {
    throw new Error(
      "Only a licensed attorney can confirm a docket date. Ask the attorney of record to review it.",
    );
  }

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .update({
      attorney_confirmed: true,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await logActivity({
    type: "matter_updated",
    matterId: data.matter_id,
    payload: {
      change: "deadline_confirmed",
      kind: data.kind,
      due_date: data.due_date,
    },
  });

  return data;
}

/**
 * Closes a docket entry out. Entries are never deleted from the app (delete is
 * admin-only at the RLS layer): the file keeps the record of what was due and
 * what happened to it.
 */
export async function closeDeadline(
  id: string,
  status: Exclude<DeadlineStatus, "open">,
  note?: string | null,
): Promise<MatterDeadline> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .update({
      status,
      satisfied_at: status === "satisfied" ? new Date().toISOString() : null,
      // Omitted (not nulled) when no note is given: closing an entry out
      // without a comment must not erase the note someone already wrote.
      notes: note ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await logActivity({
    type: "matter_updated",
    matterId: data.matter_id,
    payload: { change: "deadline_closed", kind: data.kind, status, due_date: data.due_date },
  });

  return data;
}

/**
 * Moves an extendable deadline to a newly granted date and counts the
 * extension. The new date arrives UNCONFIRMED even if the old one was
 * confirmed — the DB trigger enforces that too, because a confirmation that
 * outlives the date it confirmed is a stale docket.
 *
 * Refuses when the entry is not extendable or the extension budget is spent
 * (the DB CHECK backs both up).
 */
export async function extendDeadline(id: string, newDueDate: string): Promise<MatterDeadline> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: current, error: readError } = await supabase
    .from("crm_matter_deadline")
    .select("*")
    .eq("id", id)
    .single();
  if (readError) throw readError;

  if (!current.is_extendable) {
    throw new Error("This deadline isn't extendable.");
  }
  if (
    current.max_extensions != null &&
    current.extensions_used >= current.max_extensions
  ) {
    throw new Error(
      `No extensions left — ${current.extensions_used} of ${current.max_extensions} already used.`,
    );
  }

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .update({
      due_date: newDueDate,
      extensions_used: current.extensions_used + 1,
      source: "official_notice",
      attorney_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  await logActivity({
    type: "matter_updated",
    matterId: data.matter_id,
    payload: {
      change: "deadline_extended",
      kind: data.kind,
      from: current.due_date,
      to: newDueDate,
      extensions_used: data.extensions_used,
    },
  });

  return data;
}
