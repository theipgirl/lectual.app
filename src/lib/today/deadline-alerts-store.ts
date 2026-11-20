import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Json } from "@/lib/db/types";
import { listMemberDirectory } from "@/lib/members/directory";
import { createBrainEntry, updateBrainEntry } from "@/lib/brain/entries";
import { notifyOwnMany } from "@/lib/notifications/core";
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
    return { status: "ok", entryId: entry?.id ?? null, stored, userIds: currentRecipients(stored, members) };
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

const SELECT = "id, matter_id, kind, title, due_date, status, attorney_confirmed, source, crm_matter!inner(matter_number, title, mark_text, owner_name)";
/** Upcoming rows (today..+30) are paged: 1,000 a page, at most 5 pages. */
export const UPCOMING_PAGE = 1000;
export const UPCOMING_PAGES = 5;
/** Overdue rows are a separate read, newest first, at most this many (older ones are counted as cut short). */
export const OVERDUE_CAP = 200;

export type AlertDeadlineRead = {
  deadlines: AlertDeadline[];
  /** A read reached its cap: some rows are not listed. Said on the card, never silent. */
  cutShort: { upcoming: boolean; overdue: boolean };
};

function toAlert(d: DeadlineRow): AlertDeadline {
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
}

/**
 * Open deadlines for the Deadlines card and the alerts, in the firm's civil days, as TWO reads so old overdue rows can
 * never push the 7- and 30-day rows out: (1) due today..`horizon`, soonest first, paged; (2) overdue, newest first,
 * capped. A read that reaches its cap is reported (`cutShort`). A stale hand-entered date the "Needs review" list holds
 * (deadline-rules.ts) is left out, as on the rest of Today. Null = a read failed (the card says "Couldn't load").
 */
export async function loadAlertDeadlines(today: string, horizon: string): Promise<AlertDeadlineRead | null> {
  try {
    const supabase = await getScopedClient();
    const upcoming: DeadlineRow[] = [];
    let upcomingCut = false;
    for (let p = 0; ; p += 1) {
      if (p >= UPCOMING_PAGES) {
        upcomingCut = true;
        break;
      }
      const { data, error } = await supabase
        .from("crm_matter_deadline")
        .select(SELECT)
        .eq("status", "open")
        .gte("due_date", today)
        .lte("due_date", horizon)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(p * UPCOMING_PAGE, p * UPCOMING_PAGE + UPCOMING_PAGE - 1);
      if (error) return null;
      const rows = (data ?? []) as unknown as DeadlineRow[];
      upcoming.push(...rows);
      if (rows.length < UPCOMING_PAGE) break;
    }
    const over = await supabase
      .from("crm_matter_deadline")
      .select(SELECT)
      .eq("status", "open")
      .lt("due_date", today)
      .order("due_date", { ascending: false })
      .order("id", { ascending: true })
      .limit(OVERDUE_CAP + 1);
    if (over.error) return null;
    const overdueRows = (over.data ?? []) as unknown as DeadlineRow[];
    const overdueCut = overdueRows.length > OVERDUE_CAP;
    const keep = (d: DeadlineRow) =>
      d.status === "open" && !deadlineNeedsReview({ status: "open", attorney_confirmed: d.attorney_confirmed, source: d.source as never, due_date: d.due_date }, today);
    return {
      deadlines: [...overdueRows.slice(0, OVERDUE_CAP), ...upcoming].filter(keep).map(toAlert),
      cutShort: { upcoming: upcomingCut, overdue: overdueCut },
    };
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
    if (plans.length === 0) return 0;
    // One membership check, one org read and ONE insert for the whole batch (notifyOwnMany), not one per notice.
    return await notifyOwnMany(userId, plans.map((plan) => ({ kind: "mentioned" as const, matterId: plan.matterId, payload: noticePayload(plan) })));
  } catch {
    return 0;
  }
}
