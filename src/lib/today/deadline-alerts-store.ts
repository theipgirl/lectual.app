import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Json } from "@/lib/db/types";
import { listMemberDirectory } from "@/lib/members/directory";
import { createBrainEntry, updateBrainEntry } from "@/lib/brain/entries";
import { notify } from "@/lib/notifications/core";
import { deadlineKindLabel, deadlineNeedsReview, type DeadlineKind } from "@/lib/matters/deadline-rules";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import {
  DEADLINE_ALERT_KEY,
  DEADLINE_NOTICE_SOURCE,
  currentRecipients,
  noticePayload,
  noticesToRaise,
  parseRecipientData,
  raisedKeys,
  type AlertDeadline,
  type RecipientRead,
} from "./deadline-alerts";

/**
 * The deadline alerts' reads and writes, all through the signed-in caller's scoped client (RLS keeps every row to
 * the caller's firm). No service role. The rules are in deadline-alerts.ts (pure).
 */

export type RecipientSetting =
  | { status: "ok"; entryId: string | null; stored: string[]; userIds: string[] }
  | { status: "unavailable" };

/** The firm note holding the list, and the member directory (a removed member is dropped). Either failing = unavailable. */
export async function loadRecipientSetting(): Promise<RecipientSetting> {
  try {
    const supabase = await getScopedClient();
    const [entryRes, members] = await Promise.all([
      supabase.from("crm_firm_brain_entry").select("id, data").eq("category", "other").eq("key", DEADLINE_ALERT_KEY).order("created_at").limit(1),
      listMemberDirectory(),
    ]);
    if (entryRes.error) return { status: "unavailable" };
    const entry = (entryRes.data ?? [])[0] ?? null;
    const stored = entry ? parseRecipientData(entry.data) : [];
    return { status: "ok", entryId: entry?.id ?? null, stored, userIds: currentRecipients(stored, members.map((m) => m.userId)) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadAlertRecipients(): Promise<RecipientRead> {
  const s = await loadRecipientSetting();
  return s.status === "ok" ? { status: "ok", userIds: s.userIds } : { status: "unavailable" };
}

/**
 * Saves the list (admin tier: `createBrainEntry` / `updateBrainEntry` re-check the role, and RLS is the boundary).
 * The caller has already checked every id against the member directory.
 */
export async function saveAlertRecipients(userIds: readonly string[], entryId: string | null): Promise<void> {
  const data = { user_ids: [...new Set(userIds)] } as unknown as Json;
  if (entryId) {
    await updateBrainEntry(entryId, { data });
    return;
  }
  await createBrainEntry({ category: "other", key: DEADLINE_ALERT_KEY, title: "Deadline alert recipients", body: "", data });
}

type DeadlineRow = {
  id: string;
  matter_id: string;
  kind: string;
  title: string | null;
  due_date: string;
  status: string;
  attorney_confirmed: boolean;
  source: string;
  crm_matter: { matter_number: string | null; title: string | null; mark_text: string | null; owner_name: string | null } | null;
};

function kindLabel(kind: string): string {
  try {
    return deadlineKindLabel(kind as DeadlineKind);
  } catch {
    return "Deadline";
  }
}

/**
 * Open deadlines due on or before `today` + 30 days, overdue ones included, in the firm's civil days. A stale
 * hand-entered date the "Needs review" list holds (deadline-rules.ts) is left out here, as on the rest of Today.
 * Null = the read failed (the card says "Couldn't load", never "no deadlines").
 */
export async function loadAlertDeadlines(today: string, horizon: string): Promise<AlertDeadline[] | null> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_matter_deadline")
      .select("id, matter_id, kind, title, due_date, status, attorney_confirmed, source, crm_matter!inner(matter_number, title, mark_text, owner_name)")
      .eq("status", "open")
      .lte("due_date", horizon)
      .order("due_date", { ascending: true })
      .limit(500);
    if (error) return null;
    return ((data ?? []) as unknown as DeadlineRow[])
      .filter((d) => d.status === "open" && !deadlineNeedsReview({ status: "open", attorney_confirmed: d.attorney_confirmed, source: d.source as never, due_date: d.due_date }, today))
      .map((d) => {
        const m = d.crm_matter;
        const label = m ? matterDisplayTitle({ matter_number: m.matter_number ?? "", title: m.title, mark_text: m.mark_text, owner_name: m.owner_name }).title : "";
        return {
          id: d.id,
          matterId: d.matter_id,
          title: d.title?.trim() || kindLabel(d.kind),
          dueDate: d.due_date.slice(0, 10),
          confirmed: Boolean(d.attorney_confirmed),
          matterLabel: [m?.matter_number, label && label !== m?.matter_number ? label : null].filter(Boolean).join(" · ") || "A matter",
        };
      });
  } catch {
    return null;
  }
}

/**
 * Raises the signed-in recipient's own bell notices for deadlines that entered a window. De-dupe: the caller's own
 * notification rows for these deadlines (RLS returns only their own). A failed read raises nothing. Never throws.
 */
export async function raiseOwnDeadlineNotices(userId: string, deadlines: readonly AlertDeadline[], today: string): Promise<number> {
  try {
    if (deadlines.length === 0) return 0;
    const supabase = await getScopedClient();
    const ids = [...new Set(deadlines.map((d) => d.id))];
    const payloads: unknown[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const { data, error } = await supabase
        .from("crm_notification")
        .select("payload")
        .eq("kind", "mentioned")
        .eq("payload->>source", DEADLINE_NOTICE_SOURCE)
        .in("payload->>deadline_id", ids.slice(i, i + 80))
        .limit(1000);
      if (error) return 0;
      for (const row of data ?? []) payloads.push(row.payload);
    }
    const plans = noticesToRaise(deadlines, today, raisedKeys(payloads));
    for (const plan of plans) {
      await notify({ userId, kind: "mentioned", matterId: plan.matterId, actorId: null, payload: noticePayload(plan) });
    }
    return plans.length;
  } catch {
    return 0;
  }
}
