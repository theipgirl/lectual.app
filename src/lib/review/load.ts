import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { listMatters } from "@/lib/matters";
import { listLeads, listStages } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { loadActiveQueue } from "@/lib/queue/load";
import { loadPendingApprovalsByLead } from "@/lib/queue/lead-pending";
import { getFirmTimeZone } from "@/lib/org/profile";
import { matterIdsNeedingReview } from "@/app/dashboard/matters/list-utils";
import { buildReviewRows, civilDateIn, reviewLeadStageIds, type ReviewActivityIn, type ReviewDeadlineIn, type ReviewTaskIn } from "./build";
import type { ReviewRow } from "./buckets";
import { CONTACT_TYPES } from "./contact";
import { OPTIONAL_SOURCES, type CriticalSource, type OptionalSource } from "./notes";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;
type ActivityType = Database["public"]["Tables"]["crm_activity"]["Row"]["type"];

/** Ids per `in(...)` list: keeps the URL short; one query per table per chunk, never one per record. */
export const CHUNK = 80;
const PAGE = 1000;
const MAX_PAGES = 10;

export type ReviewLoad =
  | {
      status: "ok";
      rows: ReviewRow[];
      today: string;
      timeZone: string;
      members: { userId: string; name: string; role: string }[];
      failed: OptionalSource[];
    }
  | { status: "unavailable"; failed: CriticalSource[] };

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reads every page of one query. PostgREST silently caps a response at 1000 rows, so a capped read
 * would look complete while missing rows: if the pages run out of budget the read FAILS rather than
 * returning what it has.
 */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
  throw new Error("review read exceeded its page budget");
}

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunks(ids).map(read));
  return parts.flat();
}

export async function readOpenTasks(db: ScopedClient, matterIds: readonly string[], leadIds: readonly string[]): Promise<ReviewTaskIn[]> {
  const select = "id, title, due_at, assignee_id, matter_id, lead_id, created_at";
  const [m, l] = await Promise.all([
    inChunks(matterIds, (chunk) =>
      readAllPages<ReviewTaskIn>((from, to) =>
        db.from("crm_task").select(select).eq("status", "open").in("matter_id", chunk).order("id").range(from, to),
      ),
    ),
    inChunks(leadIds, (chunk) =>
      readAllPages<ReviewTaskIn>((from, to) =>
        db.from("crm_task").select(select).eq("status", "open").in("lead_id", chunk).order("id").range(from, to),
      ),
    ),
  ]);
  return [...m, ...l];
}

export async function readContactActivity(db: ScopedClient, matterIds: readonly string[], leadIds: readonly string[]): Promise<ReviewActivityIn[]> {
  // Type, date and the two ids only. No payload is selected, so no body can reach this module.
  const select = "lead_id, matter_id, type, created_at";
  const types = [...CONTACT_TYPES] as unknown as ActivityType[];
  const [m, l] = await Promise.all([
    inChunks(matterIds, (chunk) =>
      readAllPages<ReviewActivityIn>((from, to) =>
        db.from("crm_activity").select(select).in("type", types).in("matter_id", chunk).order("created_at", { ascending: false }).order("id").range(from, to),
      ),
    ),
    inChunks(leadIds, (chunk) =>
      readAllPages<ReviewActivityIn>((from, to) =>
        db.from("crm_activity").select(select).in("type", types).in("lead_id", chunk).order("created_at", { ascending: false }).order("id").range(from, to),
      ),
    ),
  ]);
  return [...m, ...l];
}

export async function readOpenDeadlines(db: ScopedClient, matterIds: readonly string[]): Promise<ReviewDeadlineIn[]> {
  return inChunks(matterIds, (chunk) =>
    readAllPages<ReviewDeadlineIn>((from, to) =>
      db.from("crm_matter_deadline").select("matter_id, due_date, title").eq("status", "open").in("matter_id", chunk).order("id").range(from, to),
    ),
  );
}

export async function readLastStageChange(db: ScopedClient, leadIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await inChunks(leadIds, (chunk) =>
    readAllPages<{ lead_id: string | null; created_at: string }>((from, to) =>
      db.from("crm_activity").select("lead_id, created_at").eq("type", "stage_changed").in("lead_id", chunk).order("created_at", { ascending: false }).order("id").range(from, to),
    ),
  );
  const newest = new Map<string, string>();
  for (const r of rows) if (r.lead_id && !newest.has(r.lead_id)) newest.set(r.lead_id, r.created_at);
  return newest;
}

/**
 * Everything the weekly review reads, through the caller's scoped client only. Matters, leads and
 * tasks are CRITICAL: if any fails there are no sections (a failed task read must not put everyone
 * under "Needs a next step"). The rest only enrich a row and are named when they fail.
 */
export async function loadReview(now: Date = new Date()): Promise<ReviewLoad> {
  const db = await getScopedClient();
  const [mattersS, leadsS, stagesS, membersS, tzS, queueS] = await Promise.allSettled([
    listMatters(),
    listLeads(),
    listStages(),
    listMemberDirectory(),
    getFirmTimeZone(),
    loadActiveQueue("pending"),
  ]);
  const timeZone = tzS.status === "fulfilled" ? tzS.value : "America/New_York";

  const failedCritical: CriticalSource[] = [];
  if (mattersS.status === "rejected") failedCritical.push("matters");
  if (leadsS.status === "rejected" || stagesS.status === "rejected") failedCritical.push("leads");

  const matters = mattersS.status === "fulfilled" ? mattersS.value : [];
  const leads = leadsS.status === "fulfilled" ? leadsS.value : [];
  const leadStages = stagesS.status === "fulfilled" ? stagesS.value : [];

  // Only records that can appear are asked about. Leads with a matter show once, as the matter.
  const matterIds = matters.filter((m) => m.status === "open" || m.status === "on_hold").map((m) => m.id);
  const withMatter = new Set(matters.map((m) => m.lead_id).filter((x): x is string => !!x));
  const eligibleStages = reviewLeadStageIds(leadStages);
  const leadIds = leads.filter((l) => !withMatter.has(l.id) && eligibleStages.has(l.current_stage_id)).map((l) => l.id);

  const dependsOnRecords = failedCritical.length === 0;
  const [tasksS, activityS, deadlinesS, changesS] = dependsOnRecords
    ? await Promise.allSettled([
        readOpenTasks(db, matterIds, leadIds),
        readContactActivity(db, matterIds, leadIds),
        readOpenDeadlines(db, matterIds),
        readLastStageChange(db, leadIds),
      ])
    : ([null, null, null, null] as const);
  if (dependsOnRecords && tasksS && tasksS.status === "rejected") failedCritical.push("tasks");
  if (failedCritical.length > 0) return { status: "unavailable", failed: failedCritical };

  const failed: OptionalSource[] = [];
  const activityOk = activityS?.status === "fulfilled";
  if (!activityOk) failed.push("last contact");
  const deadlinesOk = deadlinesS?.status === "fulfilled";
  if (!deadlinesOk) failed.push("deadlines");
  const changes = changesS?.status === "fulfilled" ? changesS.value : null;
  if (!changes) failed.push("stage history");

  // Approvals: the queue's own three states. Unconfigured = nothing pending to chip; unavailable = chip skipped, said so.
  let pendingMatterIds: Set<string> | null = new Set();
  let pendingLeadIds: Set<string> | null = new Set();
  const queue = queueS.status === "fulfilled" ? queueS.value : null;
  if (!queue || queue.status === "unavailable") {
    pendingMatterIds = null;
    pendingLeadIds = null;
    failed.push("approvals");
  } else if (queue.status === "ok") {
    pendingMatterIds = matterIdsNeedingReview(queue.items);
    const byLead = await loadPendingApprovalsByLead({ load: async () => queue });
    if (byLead.status === "ok") {
      pendingLeadIds = new Set(Object.entries(byLead.byLead).filter(([, list]) => list.length > 0).map(([id]) => id));
    } else {
      pendingLeadIds = null;
      failed.push("approvals");
    }
  }

  const memberList = membersS.status === "fulfilled" ? membersS.value : [];
  if (membersS.status === "rejected") failed.push("team names");

  const rows = buildReviewRows({
    matters,
    leads,
    leadStages,
    tasks: tasksS?.status === "fulfilled" ? tasksS.value : [],
    activity: activityOk ? activityS.value : [],
    deadlines: deadlinesOk ? deadlinesS.value : [],
    lastStageChange: changes,
    pendingMatterIds,
    pendingLeadIds,
    sources: { activity: activityOk ? "ok" : "unavailable", deadlines: deadlinesOk ? "ok" : "unavailable" },
    timeZone,
    now,
  });

  return {
    status: "ok",
    rows,
    today: civilDateIn(now, timeZone),
    timeZone,
    members: memberList.map((m) => ({ userId: m.userId, name: m.displayName || m.email || "Teammate", role: m.role })),
    failed: OPTIONAL_SOURCES.filter((s) => failed.includes(s)),
  };
}
