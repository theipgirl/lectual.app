import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { CardEvent, CardEventKind, CardState } from "@/lib/queue/deck";

/**
 * The approval deck's second source: `queue_card_event` (lectual 0103), append-only rows saying an approval card was
 * handed to someone, put off until later, or sent back. Read and written through the scoped client only, so RLS keeps
 * each firm to its own rows; `actor_id` is the database's `auth.uid()` default and is never sent from here.
 *
 * Three states, never two: `ok`, `not-set-up` (the table isn't there yet: 42P01 / PGRST205) and `unavailable` (any
 * other failure). A deck that can't read these shows EVERY card it would otherwise deal, never fewer.
 */

const COLUMNS = "queue_item_id, kind, actor_id, target_user_id, until, note, created_at";
const CHUNK = 100;

const KINDS: readonly CardEventKind[] = ["handoff", "later", "returned", "draft_to", "drafted"];

export function isNotSetUpError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

function toEvent(row: Record<string, unknown>): CardEvent | null {
  const kind = row.kind;
  if (typeof row.queue_item_id !== "string" || typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return null;
  if (typeof row.actor_id !== "string" || typeof row.created_at !== "string") return null;
  return {
    queueItemId: row.queue_item_id,
    kind: kind as CardEventKind,
    actorId: row.actor_id,
    targetUserId: typeof row.target_user_id === "string" ? row.target_user_id : null,
    until: typeof row.until === "string" ? row.until : null,
    note: typeof row.note === "string" ? row.note : null,
    createdAt: row.created_at,
  };
}

/** The events for these queue items, oldest first. */
export async function loadCardState(itemIds: readonly string[]): Promise<CardState> {
  const ids = [...new Set(itemIds.filter((i) => typeof i === "string" && i.length > 0))];
  try {
    const supabase = await getScopedClient();
    const events: CardEvent[] = [];
    if (ids.length === 0) {
      // Still ask, so a missing table reads as not set up rather than as "nothing handed off".
      const { error } = await supabase.from("queue_card_event").select("queue_item_id").limit(1);
      if (error) return isNotSetUpError(error) ? { status: "not-set-up" } : { status: "unavailable" };
      return { status: "ok", events };
    }
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase
        .from("queue_card_event")
        .select(COLUMNS)
        .in("queue_item_id", ids.slice(i, i + CHUNK))
        .order("created_at", { ascending: true });
      if (error) return isNotSetUpError(error) ? { status: "not-set-up" } : { status: "unavailable" };
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const e = toEvent(row);
        if (e) events.push(e);
      }
    }
    events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { status: "ok", events };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The kinds lectual 0112 adds. Before 0112 the table refuses them: the kind CHECK (23514, naming the constraint
 * `queue_card_event_kind_check`, Postgres's default name for a CHECK on the `kind` column) or, if `kind` is an enum, an
 * invalid enum value (22P02, "invalid input value for enum ...: "draft_to""). Both the CODE and the message must say so,
 * and only for these two kinds: another CHECK (0112's own shape check), a 22P02 from a bad uuid, or an old kind's refusal
 * stays "failed", never "not switched on".
 */
export const KINDS_0112: readonly CardEventKind[] = ["draft_to", "drafted"];
export const KIND_CHECK_NAME = "queue_card_event_kind_check";
export function isKindNotSetUpError(kind: CardEventKind, error: unknown): boolean {
  if (!KINDS_0112.includes(kind)) return false;
  // Read only to recognise the refusal; never shown or logged.
  const refusal = error as { code?: unknown; message?: unknown } | null;
  const text = typeof refusal?.message === "string" ? refusal.message : "";
  if (refusal?.code === "23514") return text.includes(KIND_CHECK_NAME);
  if (refusal?.code === "22P02") return /invalid input value for enum/i.test(text) && text.includes(`"${kind}"`);
  return false;
}

/** 23505: a unique index refused the row (0112's one-`drafted`-per-item claim). */
const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

export type RecordResult = { ok: true } | { ok: false; reason: "not-set-up" | "failed" | "conflict" };

/**
 * Append one event. The org comes from the caller's own session (the scoped read of the active org), `actor_id` from
 * the database default. Nothing here decides whether the caller may: the action does that first.
 */
export async function recordCardEvent(input: {
  orgId: string;
  queueItemId: string;
  kind: CardEventKind;
  targetUserId?: string | null;
  until?: string | null;
  note?: string | null;
}): Promise<RecordResult> {
  try {
    const supabase = await getScopedClient();
    const { error } = await supabase.from("queue_card_event").insert({
      org_id: input.orgId,
      queue_item_id: input.queueItemId,
      kind: input.kind,
      target_user_id: input.targetUserId ?? null,
      until: input.until ?? null,
      note: input.note ?? null,
    });
    if (error) return { ok: false, reason: isNotSetUpError(error) || isKindNotSetUpError(input.kind, error) ? "not-set-up" : isUniqueViolation(error) ? "conflict" : "failed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
