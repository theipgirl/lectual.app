import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { countFilesByParent, countLettersByMatter } from "@/lib/files/read";
import { leadRead } from "@/lib/leads/live";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
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
import { firmSendersFrom, NO_FIRM_SENDERS, type FirmSenders } from "@/lib/mailbox/firm-sender";
import { proposalExpiryTag, type ProposalExpiryIn } from "./proposal-expiry";
import { CHANGE_SELECT, CHANGE_TYPES, changeWindowStart, lastChangeFor, pickLastChanges, withoutPeople, type ChangeRowIn } from "./last-changed";
import { DEFAULT_FEE_READS, type FeeReads } from "./fees-load";
import { feesFor } from "./fees-cells";
import { closeStagesOf, type CloseStage } from "./close-stage";
import { OPTIONAL_SOURCES, type CriticalSource, type OptionalSource } from "./notes";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;
type ActivityType = Database["public"]["Tables"]["crm_activity"]["Row"]["type"];

/** Ids per `in(...)` list: keeps the URL short; one query per table per chunk, never one per record. */
export const CHUNK = 80;
const PAGE = 1000;
const MAX_PAGES = 10;

type ProposalExpiryRead = ProposalExpiryIn & { id: string; lead_id: string | null; matter_id: string | null };

export type ReviewLoad =
  | {
      status: "ok";
      rows: ReviewRow[];
      today: string;
      timeZone: string;
      members: { userId: string; name: string; role: string }[];
      failed: OptionalSource[];
      /** The firm's lost / nurture stages, for the Lost / Nurture button. Empty hides the button. */
      closeStages: CloseStage[];
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
  // Type, date, the two ids, and two payload fields: the sender address and the party ("uspto"), which decide an
  // email's direction. Nothing else of the payload (no subject, no recipients) is selected; the payload holds no body.
  const select = "lead_id, matter_id, type, created_at, sender:payload->>from, party:payload->>party";
  type Raw = Omit<ReviewActivityIn, "from"> & { sender?: string | null };
  const types = [...CONTACT_TYPES] as unknown as ActivityType[];
  const [m, l] = await Promise.all([
    inChunks(matterIds, (chunk) =>
      readAllPages<Raw>((from, to) =>
        db.from("crm_activity").select(select).in("type", types).in("matter_id", chunk).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: unknown }>,
      ),
    ),
    inChunks(leadIds, (chunk) =>
      readAllPages<Raw>((from, to) =>
        db.from("crm_activity").select(select).in("type", types).in("lead_id", chunk).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: unknown }>,
      ),
    ),
  ]);
  return [...m, ...l].map(({ sender, ...rest }) => ({ ...rest, from: sender ?? null, party: rest.party ?? null }));
}

/**
 * The firm's own sender addresses, from its mailbox connections, read through the SAME scoped client (column
 * `email` only, never a token column: RLS shows the firm rows and the caller's own personal ones). Any failure is
 * "none known", which is the review's behaviour before this read existed.
 */
export async function readFirmSenders(db: ScopedClient): Promise<FirmSenders> {
  try {
    const raw = db as unknown as { from(table: string): { select(columns: string): PromiseLike<{ data: { email?: string | null }[] | null; error: unknown }> } };
    const { data, error } = await raw.from("mailbox_connection").select("email");
    if (error || !Array.isArray(data)) return NO_FIRM_SENDERS;
    return firmSendersFrom(data.map((r) => r.email));
  } catch {
    return NO_FIRM_SENDERS;
  }
}

export async function readOpenDeadlines(db: ScopedClient, matterIds: readonly string[]): Promise<ReviewDeadlineIn[]> {
  return inChunks(matterIds, (chunk) =>
    readAllPages<ReviewDeadlineIn>((from, to) =>
      db.from("crm_matter_deadline").select("id, matter_id, kind, due_date, title, attorney_confirmed").eq("status", "open").in("matter_id", chunk).order("id").range(from, to),
    ),
  );
}

/**
 * Proposals linked to the given leads and matters. Only ids, status and the expiry DATE are selected:
 * no content, client name or email ever reaches this module.
 */
export async function readProposalExpiries(db: ScopedClient, matterIds: readonly string[], leadIds: readonly string[]): Promise<ProposalExpiryRead[]> {
  const select = "id, family_id, version, status, lead_id, matter_id, expires_on";
  // The generated Database type has no 0089 tables: the same scoped connection seen through a narrow shape (as the proposals store does).
  type Q = PromiseLike<{ data: ProposalExpiryRead[] | null; error: unknown }> & {
    in(column: string, values: readonly string[]): Q;
    order(column: string): Q;
    range(from: number, to: number): Q;
  };
  const raw = db as unknown as { from(table: string): { select(columns: string): Q } };
  const [m, l] = await Promise.all([
    inChunks(matterIds, (chunk) =>
      readAllPages<ProposalExpiryRead>((from, to) => raw.from("client_proposal").select(select).in("matter_id", chunk).order("id").range(from, to)),
    ),
    inChunks(leadIds, (chunk) =>
      readAllPages<ProposalExpiryRead>((from, to) => raw.from("client_proposal").select(select).in("lead_id", chunk).order("id").range(from, to)),
    ),
  ]);
  return [...m, ...l];
}

/**
 * The change rows of the given records (type, actor, date, and the two stamp fields only), newest first, paged and chunked like
 * the other reads. A read that cannot finish (an error, or the page budget) rejects: the caller then draws NO line, never "not changed".
 */
export async function readChangeRows(db: ScopedClient, matterIds: readonly string[], leadIds: readonly string[], now: Date = new Date()): Promise<ChangeRowIn[]> {
  const since = changeWindowStart(now);
  type Raw = ChangeRowIn;
  const types = [...CHANGE_TYPES] as unknown as ActivityType[];
  const page = (column: "matter_id" | "lead_id", chunk: string[]) =>
    readAllPages<Raw>(
      (from, to) =>
        db.from("crm_activity").select(CHANGE_SELECT).in("type", types).gte("created_at", since).in(column, chunk).order("created_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: unknown }>,
    );
  const [m, l] = await Promise.all([inChunks(matterIds, (c) => page("matter_id", c)), inChunks(leadIds, (c) => page("lead_id", c))]);
  return [...m, ...l];
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
 * child lead id -> keeper id, for the leads merged into any of `leadIds`: one batched read per chunk through the live-leads
 * helper (before 0107 there is no pointer and nothing is merged). Any failure, or a read that may have hit PostgREST's
 * 1000-row cap, rejects: a keeper's count must never be too low, so the caller draws no tag and names "documents".
 */
async function readMergedChildren(db: ScopedClient, leadIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    chunks(leadIds).map(async (chunk) => {
      const result = await leadRead<{ data: unknown; error: unknown }>((kit) => {
        if (!kit.merged) return Promise.resolve({ data: [], error: null });
        // live-guard: the live-leads helper itself reads the merge pointer
        return db.from("crm_lead").select("id, merged_into_id").in("merged_into_id", [...chunk]).limit(PAGE);
      });
      if (result.error) throw new Error("merged read failed");
      const rows = (result.data ?? []) as { id: string; merged_into_id: string | null }[];
      if (rows.length >= PAGE) throw new Error("merged read may be cut short");
      for (const r of rows) if (r.merged_into_id) out.set(r.id, r.merged_into_id);
    }),
  );
  return out;
}

/**
 * Documents per record: stored files (lead and matter) plus, for a matter in a firm with Document Center, its
 * generated letters. One batched read per chunk of ids and table, never one per record. Keys are `kind:id`; a record
 * with none has no key. Any failed read, or a module list that cannot be read (the letters would be uncounted),
 * rejects, so the caller draws no tag and names "documents" in the note, never a 0.
 */
export async function readDocumentCounts(db: ScopedClient, matterIds: readonly string[], leadIds: readonly string[]): Promise<Map<string, number>> {
  const modules = await activeOrgModulesOrNull();
  if (modules === null) throw new Error("modules unreadable");
  const withLetters = modules.includes("document-center");
  const counts = new Map<string, number>();
  const add = (kind: string, parts: Map<string, number>[]) => {
    for (const part of parts) for (const [id, n] of part) counts.set(`${kind}:${id}`, (counts.get(`${kind}:${id}`) ?? 0) + n);
  };
  const matterParts = chunks(matterIds).map(async (chunk) => {
    const [files, letters] = await Promise.all([countFilesByParent(db, "matter", chunk), withLetters ? countLettersByMatter(db, chunk) : Promise.resolve(new Map<string, number>())]);
    return [files, letters];
  });
  const leadParts = chunks(leadIds).map((chunk) => countFilesByParent(db, "lead", chunk));
  // Leads merged into these keep their files on themselves (lectual 0107); the keeper's count includes them, as its page lists them.
  const mergedChildren = await readMergedChildren(db, leadIds);
  const childParts = chunks([...mergedChildren.keys()]).map((chunk) => countFilesByParent(db, "lead", chunk));
  const [matterDone, leadDone, childDone] = await Promise.all([Promise.all(matterParts), Promise.all(leadParts), Promise.all(childParts)]);
  add("matter", matterDone.flat());
  add("lead", leadDone);
  for (const part of childDone) {
    for (const [childId, n] of part) {
      const keeper = mergedChildren.get(childId);
      if (keeper) counts.set(`lead:${keeper}`, (counts.get(`lead:${keeper}`) ?? 0) + n);
    }
  }
  return counts;
}

/** A matter row also shows proposals filed against its lead (a quote drafted before the matter opened). */
function proposalsFor(row: ReviewRow, all: readonly ProposalExpiryRead[], matters: readonly { id: string; lead_id: string | null }[]): ProposalExpiryRead[] {
  if (row.kind === "lead") return all.filter((p) => p.lead_id === row.id);
  const leadId = matters.find((m) => m.id === row.id)?.lead_id ?? null;
  return all.filter((p) => p.matter_id === row.id || (leadId !== null && p.lead_id === leadId));
}

/**
 * Everything the weekly review reads, through the caller's scoped client only. Matters, leads and
 * tasks are CRITICAL: if any fails there are no sections (a failed task read must not put everyone
 * under "Needs a next step"). The rest only enrich a row and are named when they fail.
 */
export async function loadReview(now: Date = new Date(), options: { withFees?: boolean; reads?: Partial<FeeReads> } = {}): Promise<ReviewLoad> {
  const withFees = options.withFees === true;
  const feeReads: FeeReads = { ...DEFAULT_FEE_READS, ...options.reads };
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
  const proposalLeadIds = [...new Set([...leadIds, ...matters.filter((m) => m.status === "open" || m.status === "on_hold").map((m) => m.lead_id).filter((x): x is string => !!x)])];
  const [tasksS, activityS, deadlinesS, changesS, proposalsS, countsS, sendersS, changeRowsS, feeProposalsS, feeTrackerS] = dependsOnRecords
    ? await Promise.allSettled([
        readOpenTasks(db, matterIds, leadIds),
        // A matter shows its lead's mail too (the emails were filed on the lead before it signed), so the lead ids behind matters are read as well.
        readContactActivity(db, matterIds, proposalLeadIds),
        readOpenDeadlines(db, matterIds),
        readLastStageChange(db, leadIds),
        readProposalExpiries(db, matterIds, proposalLeadIds),
        readDocumentCounts(db, matterIds, leadIds),
        readFirmSenders(db),
        readChangeRows(db, matterIds, proposalLeadIds, now),
        // Owner-only money, in the same parallel batch (each read's failure stays its own). Asked for only when the page's re-resolved role may see it.
        withFees ? feeReads.acceptedProposalFees(db, matterIds, proposalLeadIds) : Promise.resolve([] as Awaited<ReturnType<FeeReads["acceptedProposalFees"]>>),
        withFees ? feeReads.trackerFees(db, matterIds) : Promise.resolve([] as Awaited<ReturnType<FeeReads["trackerFees"]>>),
      ])
    : ([null, null, null, null, null, null, null, null, null, null] as const);
  if (dependsOnRecords && tasksS && tasksS.status === "rejected") failedCritical.push("tasks");
  if (failedCritical.length > 0) return { status: "unavailable", failed: failedCritical };

  // One source, `fees`: either read failing (or being cut short) leaves the fee fields absent on every row.
  const feesS = withFees && feeProposalsS && feeTrackerS ? ([feeProposalsS, feeTrackerS] as const) : null;

  const failed: OptionalSource[] = [];
  const activityOk = activityS?.status === "fulfilled";
  if (!activityOk) failed.push("last contact");
  const deadlinesOk = deadlinesS?.status === "fulfilled";
  if (!deadlinesOk) failed.push("deadlines");
  const changes = changesS?.status === "fulfilled" ? changesS.value : null;
  if (!changes) failed.push("stage history");

  const proposals = proposalsS?.status === "fulfilled" ? proposalsS.value : null;
  if (!proposals) failed.push("proposals");

  const lastChanges = changeRowsS?.status === "fulfilled" ? pickLastChanges(changeRowsS.value, timeZone, now) : null;
  if (!lastChanges) failed.push("last change");

  const docCounts = countsS?.status === "fulfilled" ? countsS.value : null;
  if (!docCounts) failed.push("documents");

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

  const today = civilDateIn(now, timeZone);
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
    firmSenders: sendersS?.status === "fulfilled" ? sendersS.value : NO_FIRM_SENDERS,
    timeZone,
    now,
  });

  // Tags only: a failed read draws no tags (and the KPI tile is a dash), never "no proposal".
  const tagged = proposals ? rows.map((r) => ({ ...r, proposalExpiry: proposalExpiryTag(proposalsFor(r, proposals, matters), today) })) : rows;

  // A count only where the read worked; a record with no stored documents is a real 0 (never drawn), a failed read leaves the field unset.
  const counted = docCounts ? tagged.map((r) => ({ ...r, documentCount: docCounts.get(`${r.kind}:${r.id}`) ?? 0 })) : tagged;

  // The last change only where the read worked: a record with no change row is a real `null`; a failed read leaves it unset (no line).
  // A matter also takes the changes filed on its lead. With the member directory unreadable a person's change draws no line (never "a teammate").
  const leadOfMatter = new Map(matters.map((m) => [m.id, m.lead_id]));
  const namesKnown = membersS.status === "fulfilled";
  const feeData = feesS && feesS[0].status === "fulfilled" && feesS[1].status === "fulfilled" ? { proposals: feesS[0].value, tracker: feesS[1].value } : null;
  if (feesS && !feeData) failed.push("fees");

  const changed = lastChanges
    ? counted.map((r) => {
        const c = lastChangeFor(lastChanges, r.kind, r.id, r.kind === "matter" ? leadOfMatter.get(r.id) : null);
        return { ...r, lastChange: namesKnown ? c : withoutPeople(c) };
      })
    : counted;

  const withMoney = feeData ? changed.map((r) => ({ ...r, fees: feesFor(r, r.kind === "matter" ? leadOfMatter.get(r.id) ?? null : null, feeData.proposals, feeData.tracker) })) : changed;

  return {
    status: "ok",
    rows: withMoney,
    closeStages: closeStagesOf(leadStages),
    today,
    timeZone,
    members: memberList.map((m) => ({ userId: m.userId, name: m.displayName || m.email || "Teammate", role: m.role })),
    failed: OPTIONAL_SOURCES.filter((s) => failed.includes(s)),
  };
}
