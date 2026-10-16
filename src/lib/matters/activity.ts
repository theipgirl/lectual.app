import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database, Json } from "@/lib/db/types";

export type Activity = Database["public"]["Tables"]["crm_activity"]["Row"];

/**
 * Activity types added by supabase/migrations/0033_activity_coverage.sql
 * (lead create/edit/assign had no representable type before it). They are
 * listed here rather than in src/lib/db/types.ts because that file is
 * generated — the next `generate_typescript_types` run against the dev project
 * will fold them into `crm_activity_type` and this widening becomes a no-op.
 */
export const ACTIVITY_TYPES_0033 = ["lead_created", "lead_updated", "lead_assigned"] as const;
export type ActivityType0033 = (typeof ACTIVITY_TYPES_0033)[number];

/** Added by supabase/migrations/0036_voice_notes.sql — same widening pattern as 0033. */
export const ACTIVITY_TYPES_0036 = ["voice_note"] as const;
export type ActivityType0036 = (typeof ACTIVITY_TYPES_0036)[number];

/** Added by supabase/migrations/0045_document_center.sql — same widening pattern as 0033/0036. */
export const ACTIVITY_TYPES_0045 = ["document_generated"] as const;
export type ActivityType0045 = (typeof ACTIVITY_TYPES_0045)[number];

/** Added by supabase/migrations/0047_welcome_email_activity.sql — same widening pattern. */
export const ACTIVITY_TYPES_0047 = ["welcome_email"] as const;
export type ActivityType0047 = (typeof ACTIVITY_TYPES_0047)[number];

export type ActivityType =
  | Activity["type"]
  | ActivityType0033
  | ActivityType0036
  | ActivityType0045
  | ActivityType0047;

export type LogActivityInput = {
  type: ActivityType;
  leadId?: string;
  matterId?: string;
  actorType?: Activity["actor_type"];
  payload?: Record<string, unknown>;
};

/**
 * Appends a row to the crm_activity timeline. INSERT only — there is
 * deliberately no update/delete exported here: the table is append-only,
 * enforced by DB triggers (crm_activity_no_update / crm_activity_no_delete,
 * supabase/migrations/0019_matter_activity.sql) that reject every path,
 * including service-role.
 *
 * org_id is never taken from the caller — it's read off the referenced lead
 * or matter row so the denormalized column used directly by RLS can never
 * drift from the parent's real org. actor_id comes from the signed-in
 * caller's own session (supabase.auth.getUser()), never from the input.
 *
 * Not role-gated at the app layer: crm_activity_insert_staff RLS (staff
 * roles only) is the real boundary, and logActivity is called on behalf of
 * system/ai/automation actors as often as a signed-in human, so there is no
 * single "write role" to check here the way there is for matters/tasks.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  if (!input.leadId && !input.matterId) {
    throw new Error("logActivity requires at least one of leadId or matterId");
  }

  const supabase = await getScopedClient();

  let orgId: string;
  if (input.leadId) {
    const { data, error } = await supabase
      .from("crm_lead")
      .select("org_id")
      .eq("id", input.leadId)
      .single();
    if (error) throw error;
    orgId = data.org_id;
  } else {
    const { data, error } = await supabase
      .from("crm_matter")
      .select("org_id")
      .eq("id", input.matterId!)
      .single();
    if (error) throw error;
    orgId = data.org_id;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  const { error } = await supabase.from("crm_activity").insert({
    org_id: orgId,
    lead_id: input.leadId ?? null,
    matter_id: input.matterId ?? null,
    // Cast only widens over the generated enum for the 0033 additions above;
    // Postgres still rejects anything that isn't a real crm_activity_type value.
    type: input.type as Activity["type"],
    actor_id: user?.id ?? null,
    actor_type: input.actorType ?? "user",
    payload: (input.payload ?? {}) as Json,
  });
  if (error) throw error;
}

/**
 * Audit-trail wrapper for a mutation that has ALREADY succeeded.
 *
 * The ordering is deliberate and always the same — mutate first, then log:
 *
 *  1. A failed mutation must never produce an audit row. Logging therefore
 *     runs *after* the write and is simply never reached when the write throws,
 *     so the timeline can't claim something that didn't happen.
 *  2. `logActivity` must never swallow or mask the mutation's own error. It is
 *     called on a separate statement after the caller has already handled the
 *     write's result, so a throw here cannot be mistaken for a write failure.
 *  3. A failed log must not roll back a successful mutation. crm_activity is a
 *     separate INSERT with no shared transaction (and the table is append-only
 *     — a compensating delete is impossible by design), so "undoing" the write
 *     would mean issuing a second mutation with its own failure mode. A missing
 *     timeline row is the strictly smaller harm than silently reverting an edit
 *     the user watched succeed.
 *
 * The failure is therefore swallowed for the caller but reported to the server
 * log with a greppable prefix, so a degraded audit trail stays observable
 * instead of disappearing. Use `logActivity` directly (not this) whenever the
 * activity row *is* the mutation — e.g. the note composer, where a failed
 * insert must surface to the user.
 */
export async function logActivitySafe(input: LogActivityInput): Promise<void> {
  try {
    await logActivity(input);
  } catch (err) {
    console.error(
      `[audit] failed to record ${input.type} for lead=${input.leadId ?? "-"} matter=${input.matterId ?? "-"}`,
      err,
    );
  }
}

/** Lists activity attached to a lead, newest first. */
export async function activityForLead(leadId: string): Promise<Activity[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Lists activity attached to a matter, newest first. */
export async function activityForMatter(matterId: string): Promise<Activity[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("*")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Whether a matter already has an activity row of the given type — the
 * append-only-timeline-as-source-of-truth gate a one-time matter action
 * (e.g. the welcome email, src/lib/welcome/generate.ts) checks before firing
 * again, the same idempotent spirit as ensureMatterForLead's "does a matter
 * already exist for this lead" check in src/lib/matters/matters.ts, just
 * against the timeline instead of a dedicated table.
 */
export async function hasMatterActivityType(
  matterId: string,
  type: ActivityType,
): Promise<boolean> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("id")
    .eq("matter_id", matterId)
    .eq("type", type as Activity["type"])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Org-wide activity feed for Ops Home, newest first, capped at `limit`. */
export async function recentActivity(limit = 20): Promise<Activity[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Org-wide activity attached to a matter (any matter_id), on/after `sinceIso`,
 * newest first. The Team Status page's "what changed since last week" feed —
 * it reads the SAME append-only timeline every matter/deadline/task write
 * already logs to (0019), rather than inventing a new "last touched" column,
 * for the same reason 0042 kept last_touched_at out of crm_matter_stage:
 * nobody types it, so nobody mistypes it.
 *
 * `limit` is a hard cap on rows returned, not a page size — a Monday review is
 * one screen, not a paginated log.
 */
export async function matterActivitySince(sinceIso: string, limit = 500): Promise<Activity[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("*")
    .not("matter_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Same as matterActivitySince, but for lead-attached activity. */
export async function leadActivitySince(sinceIso: string, limit = 500): Promise<Activity[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_activity")
    .select("*")
    .not("lead_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
