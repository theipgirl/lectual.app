import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listMemberDirectory } from "@/lib/members/directory";
import type { Database, Json } from "@/lib/db/types";

/**
 * The notification centre's data layer (blueprint §13.3).
 *
 * Every statement goes through getScopedClient(), so RLS is the tenant
 * boundary and no org_id filter is applied by hand (AGENTS.md). The bell's
 * policies are narrower than any other table's: crm_notification_select_mine
 * and crm_notification_update_mine both carry `user_id = auth.uid()`, which
 * means the reads below need no user filter either — asking for "all
 * notifications" already returns exactly the caller's own.
 *
 * This is an IN-APP bell and nothing else. Nothing here sends email or SMS;
 * the firm's client-facing automations stay in Lawmatics (§1 row 1.12), and
 * no notification ever reaches a client.
 */

export type NotificationKind = Database["public"]["Enums"]["crm_notification_kind"];
export type Notification = Database["public"]["Tables"]["crm_notification"]["Row"];

export type NotifyInput = {
  /** The recipient. Must be a member of the caller's ACTIVE org, or the call is dropped. */
  userId: string;
  kind: NotificationKind;
  leadId?: string | null;
  matterId?: string | null;
  /** The crm_activity row that caused this, when there is one (the note carrying the @mention). */
  activityId?: string | null;
  /** Who did the thing. Null for system producers (the email sync). */
  actorId?: string | null;
  /** Render hints only — a short preview, a display name. NEVER a mail body. */
  payload?: Record<string, unknown>;
};

/** Resolves the caller's active org id via the `current_org_id()` RPC. */
async function currentOrgId(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) return null;
  return data ?? null;
}

/**
 * Raises one notification.
 *
 * Deliberately NEVER throws. Every producer (§13.3) sits inside somebody
 * else's write path — saveNote, assignLead, the email sync — and the note or
 * the assignment is the record that matters. A bell row that cannot be written
 * must not take the note down with it, so a failure here is warned about and
 * swallowed. (This is not the "three-state read" rule in reverse: nothing in
 * this function renders an empty list as "all caught up" — listMine below
 * still throws on a failed read, which is what keeps the panel honest.)
 *
 * Two things are refused before the insert:
 *
 *   1. Notifying yourself. An author is not told about their own @mention and
 *      a self-assignment raises nothing.
 *   2. A recipient who is not a member of the active org. The uuid can come
 *      from a form (the @-mention picker posts ids), so it is validated
 *      against listMemberDirectory() — which is itself scoped to the active
 *      org — before anything is stored. A non-member is dropped SILENTLY and
 *      logged nowhere: a warning naming a uuid that did not match would turn
 *      this into an oracle for "is this person a member of this firm", which
 *      is precisely the cross-tenant inference the schema is built to prevent.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return;

  try {
    const directory = await listMemberDirectory();
    if (!directory.some((member) => member.userId === input.userId)) return;

    const supabase = await getScopedClient();
    const orgId = await currentOrgId(supabase);
    // No active org means no token claim to scope by; the insert would fail
    // the WITH CHECK anyway. Drop rather than send a doomed statement.
    if (!orgId) return;

    const { error } = await supabase.from("crm_notification").insert({
      org_id: orgId,
      user_id: input.userId,
      kind: input.kind,
      lead_id: input.leadId ?? null,
      matter_id: input.matterId ?? null,
      activity_id: input.activityId ?? null,
      actor_id: input.actorId ?? null,
      payload: (input.payload ?? {}) as Json,
    });
    if (error) {
      // The kind, not the recipient or the payload: enough to debug a broken
      // producer, nothing that identifies a person or a lead.
      console.warn(`[notifications] could not raise "${input.kind}": ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `[notifications] could not raise "${input.kind}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The caller's own notifications, newest first.
 *
 * Throws on a query error — the panel's three-state handling depends on a
 * failure being a throw and never an empty array. An empty array here must
 * only ever mean "we reached the bell and there was nothing in it"
 * (AGENTS.md: the approval-queue lesson, which applies to every surface that
 * can say "all caught up").
 */
export async function listMine({ limit = 50 }: { limit?: number } = {}): Promise<
  Notification[]
> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_notification")
    .select("*")
    // No user_id filter: crm_notification_select_mine already pins
    // user_id = auth.uid(), and re-stating it here would suggest the
    // filter is what protects the row, which it is not.
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** How many of the caller's own notifications are unread. Throws on failure (see listMine). */
export async function unreadCount(): Promise<number> {
  const supabase = await getScopedClient();
  const { count, error } = await supabase
    .from("crm_notification")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Marks one notification read. A no-op on a row that is already read (the
 * `read_at is null` filter), so re-clicking never moves the original
 * timestamp, and a no-op on anyone else's row (RLS matches zero rows rather
 * than erroring).
 */
export async function markRead(id: string): Promise<void> {
  const supabase = await getScopedClient();
  const { error } = await supabase
    .from("crm_notification")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) throw error;
}

/** Marks every unread notification of the CALLER's read. RLS is what keeps "every" personal. */
export async function markAllRead(): Promise<void> {
  const supabase = await getScopedClient();
  const { error } = await supabase
    .from("crm_notification")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw error;
}
