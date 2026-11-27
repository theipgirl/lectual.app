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

const COLUMNS = "queue_item_id, kind, actor_id, target_user_id, until, note, attempt, created_at";
/** Before lectual 0112 there is no `attempt` column (42703 / PGRST204): read the 0103 columns, every attempt is null. */
const COLUMNS_0103 = "queue_item_id, kind, actor_id, target_user_id, until, note, created_at";
const isMissingColumn = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42703" || code === "PGRST204";
};
const CHUNK = 100;

const KINDS: readonly CardEventKind[] = ["handoff", "later", "returned", "draft_to", "drafting", "drafted", "draft_failed", "pass_failed"];

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
    attempt: typeof row.attempt === "number" ? row.attempt : null,
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
    let columns = COLUMNS;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const read = () => supabase.from("queue_card_event").select(columns).in("queue_item_id", ids.slice(i, i + CHUNK)).order("created_at", { ascending: true });
      let { data, error } = await read();
      if (error && columns === COLUMNS && isMissingColumn(error)) {
        columns = COLUMNS_0103;
        ({ data, error } = await read());
      }
      if (error) return isNotSetUpError(error) ? { status: "not-set-up" } : { status: "unavailable" };
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
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
 * The kinds lectual 0112 adds. Before 0112 the table refuses them with 23514 naming one of 0103's two constraints:
 * `queue_card_event_kind` (line 98, the kind list) or `queue_card_event_shape` (lines ~100-104, which admits only the three
 * old shapes). Postgres prints the name in double quotes ("... violates check constraint "queue_card_event_kind""), and the
 * name is matched quote-delimited, so a constraint that merely starts with it (`queue_card_event_kind_check`) never matches.
 * Code AND message, and only for these kinds: another CHECK, a 22P02, or an old kind's refusal stays "failed", never "not
 * switched on".
 */
export const KINDS_0112: readonly CardEventKind[] = ["draft_to", "drafting", "drafted", "draft_failed", "pass_failed"];
export const KIND_CHECK_NAME = "queue_card_event_kind";
export const SHAPE_CHECK_NAME = "queue_card_event_shape";
export function isKindNotSetUpError(kind: CardEventKind, error: unknown): boolean {
  if (!KINDS_0112.includes(kind)) return false;
  // Read only to recognise the refusal; never shown or logged.
  const refusal = error as { code?: unknown; message?: unknown } | null;
  const text = typeof refusal?.message === "string" ? refusal.message : "";
  if (refusal?.code === "23514") return text.includes(`"${KIND_CHECK_NAME}"`) || text.includes(`"${SHAPE_CHECK_NAME}"`);
  // The attempt column 0112 adds isn't there yet (sent on drafting / drafted / draft_failed only).
  if (refusal?.code === "PGRST204" || refusal?.code === "42703") return /\battempt\b/.test(text);
  return false;
}

/** 23505: a unique index refused the row (0112's one claim per attempt, one `drafted` per item). */
const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

/** True only when the read says the `attempt` column isn't there (42703 / PGRST204); any other outcome is false. */
async function attemptColumnMissing(supabase: Awaited<ReturnType<typeof getScopedClient>>): Promise<boolean> {
  try {
    const { error } = await supabase.from("queue_card_event").select("attempt").limit(1);
    return !!error && isMissingColumn(error);
  } catch {
    return false;
  }
}

/**
 * Approver drafts (Nov 27): is lectual 0112 (passing an approved email to "Drafts go to") on this database? `no` only when
 * the read says its `attempt` column is missing; `unknown` for any other failure. Before 0112 a pass falls back to the
 * approver's own Outlook, so the approve path checks the approver's Outlook first exactly when this is `no`. The table
 * itself missing (42P01 / PGRST205, `isNotSetUpError`, as `recordCardEvent` reads it) is `no` too.
 */
export async function passingSwitchedOn(): Promise<"yes" | "no" | "unknown"> {
  try {
    const supabase = await getScopedClient();
    const { error } = await supabase.from("queue_card_event").select("attempt").limit(1);
    if (!error) return "yes";
    return isMissingColumn(error) || isNotSetUpError(error) ? "no" : "unknown";
  } catch {
    return "unknown";
  }
}

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
  /** lectual 0112: only for drafting / drafted / draft_failed; never sent for any other kind. */
  attempt?: number | null;
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
      ...(typeof input.attempt === "number" ? { attempt: input.attempt } : {}),
    });
    if (!error) return { ok: true };
    if (isNotSetUpError(error)) return { ok: false, reason: "not-set-up" };
    if (isKindNotSetUpError(input.kind, error)) {
      // A 23514 naming the kind or shape CHECK means "before 0112" only while 0112's `attempt` column is missing. Once it is
      // there, the same refusal is a real error (a bad shape) and shows as one. Decided per call by asking for the column.
      if ((error as { code?: unknown }).code !== "23514") return { ok: false, reason: "not-set-up" };
      return { ok: false, reason: (await attemptColumnMissing(supabase)) ? "not-set-up" : "failed" };
    }
    return { ok: false, reason: isUniqueViolation(error) ? "conflict" : "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
