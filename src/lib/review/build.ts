import { stageAgeDisplay } from "@/lib/lifecycle/stage-age";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import { isOpenMatter } from "@/lib/matters/docket-summary";
import { normalizeStageName } from "@/lib/lawmatics/stage-map";
import type { MatterWaitingOn } from "@/lib/matters/stage-rules";
import { newEnquiryStage } from "@/lib/pipeline/new-enquiry";
import type { ReviewRow, ReviewNextStep } from "./buckets";
import { summarizeContact, type ContactActivity } from "./contact";
import { stageIsWithUspto, waitingOn } from "./waiting";

/**
 * Turns what the page read into review rows. Pure: structural inputs, no database, no server
 * imports (the callers pass rows from the scoped client).
 */

export type ReviewMatterIn = {
  id: string;
  matter_number: string;
  title: string | null;
  mark_text: string | null;
  owner_name: string | null;
  status: string;
  type?: string | null;
  lead_id: string | null;
  assigned_to: string | null;
  stage_entered_at: string | null;
  created_at: string;
  lawmatics_id: string | null;
  lawmatics_synced_at: string | null;
  stage: { code: string; label: string; is_open: boolean; waiting_on: MatterWaitingOn; order_index?: number } | null;
};

export type ReviewLeadIn = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  mark_text: string | null;
  current_stage_id: string;
  assigned_to: string | null;
  stage_entered_at: string | null;
  created_at: string;
  lawmatics_id: string | null;
  lawmatics_synced_at: string | null;
  sheet_key: string | null;
};

export type ReviewStageIn = { id: string; name: string; category?: string | null; order_index: number | null };

export type ReviewTaskIn = {
  id: string;
  title: string;
  due_at: string | null;
  assignee_id: string | null;
  matter_id: string | null;
  lead_id: string | null;
  created_at?: string | null;
};

export type ReviewActivityIn = ContactActivity & { lead_id: string | null; matter_id: string | null };

export type ReviewDeadlineIn = { matter_id: string; due_date: string; title: string | null };

/** The state of one source the page read. `unavailable` is never drawn as empty. */
export type SourceState = "ok" | "unavailable";

export type ReviewInput = {
  matters: readonly ReviewMatterIn[];
  leads: readonly ReviewLeadIn[];
  leadStages: readonly ReviewStageIn[];
  tasks: readonly ReviewTaskIn[];
  activity: readonly ReviewActivityIn[];
  deadlines: readonly ReviewDeadlineIn[];
  /** Newest `stage_changed` per lead; null when it could not be read. */
  lastStageChange: ReadonlyMap<string, string> | null;
  /** Records with a pending approval; null when the queue could not be mapped (the chip is then skipped). */
  pendingMatterIds: ReadonlySet<string> | null;
  pendingLeadIds: ReadonlySet<string> | null;
  sources: { activity: SourceState; deadlines: SourceState };
  timeZone: string;
  now: Date;
};

/** Matters sort after every lead stage in pipeline order. */
export const MATTER_ORDER_BASE = 100_000;

/** The firm-local calendar date of an instant, YYYY-MM-DD. */
export function civilDateIn(instant: Date | string, timeZone: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Open stages a lead is "past first contact" in: any open stage except the new-enquiry stage and a
 * Follow-Up stage. Won, lost and nurture stages are not open stages.
 */
export function reviewLeadStageIds(stages: readonly ReviewStageIn[]): Set<string> {
  const enquiry = newEnquiryStage(stages)?.id ?? null;
  const ids = new Set<string>();
  for (const s of stages) {
    if (s.category !== "open" || s.id === enquiry) continue;
    if (/^follow ?up\b/.test(normalizeStageName(String(s.name ?? "")))) continue;
    ids.add(s.id);
  }
  return ids;
}

/** A task's due date is stored as that day at midnight UTC: only the day is kept. */
function dueDay(dueAt: string | null): string | null {
  return dueAt ? dueAt.slice(0, 10) : null;
}

/** The earliest open task per record: soonest due first, tasks with no date last, then oldest created. */
export function earliestTasks(tasks: readonly ReviewTaskIn[], by: "matter_id" | "lead_id"): Map<string, ReviewNextStep> {
  const best = new Map<string, ReviewTaskIn>();
  const rank = (t: ReviewTaskIn) => `${dueDay(t.due_at) ?? "9999-12-31"}|${t.created_at ?? ""}|${t.id}`;
  for (const t of tasks) {
    const key = t[by];
    if (!key) continue;
    const cur = best.get(key);
    if (!cur || rank(t) < rank(cur)) best.set(key, t);
  }
  return new Map(
    [...best].map(([k, t]) => [k, { id: t.id, title: t.title, dueDate: dueDay(t.due_at), assigneeId: t.assignee_id }]),
  );
}

function groupBy<T>(items: readonly T[], key: (t: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function nearestDeadline(list: readonly ReviewDeadlineIn[] | undefined): ReviewRow["deadline"] {
  if (!list || list.length === 0) return null;
  const first = [...list].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  return { dueDate: first.due_date.slice(0, 10), title: first.title };
}

export function buildReviewRows(input: ReviewInput): ReviewRow[] {
  const { now, timeZone } = input;
  const matterTasks = earliestTasks(input.tasks, "matter_id");
  const leadTasks = earliestTasks(input.tasks, "lead_id");
  const activityByMatter = groupBy(input.activity, (a) => a.matter_id);
  const activityByLead = groupBy(input.activity, (a) => a.lead_id);
  const deadlinesByMatter = groupBy(input.deadlines, (d) => d.matter_id);
  const contactKnown = input.sources.activity === "ok";

  const contactOf = (list: readonly ContactActivity[] | undefined) => {
    if (!contactKnown) return { lastContact: null, direction: null };
    const { last, direction } = summarizeContact(list ?? [], now);
    return { lastContact: last ? { date: civilDateIn(last.at, timeZone), type: last.type } : null, direction };
  };

  const rows: ReviewRow[] = [];

  const openMatters = input.matters.filter((m) => isOpenMatter(m) && (m.status === "open" || m.status === "on_hold"));
  for (const m of openMatters) {
    const age = stageAgeDisplay({
      stageEnteredAt: m.stage_entered_at,
      createdAt: m.created_at,
      importedAt: m.lawmatics_synced_at,
      imported: Boolean(m.lawmatics_id || m.lawmatics_synced_at),
      now,
    });
    const { lastContact, direction } = contactOf(activityByMatter.get(m.id));
    const display = matterDisplayTitle(m);
    const client = m.owner_name?.trim() || display.title;
    rows.push({
      key: `m-${m.id}`,
      kind: "matter",
      id: m.id,
      href: `/dashboard/matters/${m.id}/`,
      client,
      mark: display.title !== client ? display.title : null,
      stageLabel: m.stage ? m.stage.label : null,
      matterType: m.type ?? null,
      stageDays: age.days,
      stageNote: age.days === null ? age.label : null,
      stageOrder: m.stage ? MATTER_ORDER_BASE + (m.stage.order_index ?? 0) : null,
      assignedTo: m.assigned_to,
      contactKnown,
      lastContact,
      lastDirection: direction,
      waiting: waitingOn({
        withUspto: stageIsWithUspto(m.stage),
        pendingApproval: input.pendingMatterIds?.has(m.id) ?? false,
        lastDirection: direction,
      }),
      nextStep: matterTasks.get(m.id) ?? null,
      deadline: input.sources.deadlines === "ok" ? nearestDeadline(deadlinesByMatter.get(m.id)) : null,
    });
  }

  // A lead that has become a matter is shown once, as the matter (any matter, open or closed).
  const leadsWithMatter = new Set(input.matters.map((m) => m.lead_id).filter((x): x is string => !!x));
  const stageIds = reviewLeadStageIds(input.leadStages);
  const stageName = new Map(input.leadStages.map((s) => [s.id, s.name]));
  const stageOrderOf = new Map(input.leadStages.map((s) => [s.id, s.order_index]));
  for (const l of input.leads) {
    if (!stageIds.has(l.current_stage_id) || leadsWithMatter.has(l.id)) continue;
    const age = stageAgeDisplay({
      stageEnteredAt: l.stage_entered_at,
      createdAt: l.created_at,
      importedAt: l.lawmatics_synced_at,
      imported: Boolean(l.lawmatics_id || l.lawmatics_synced_at || l.sheet_key),
      lastStageChangeAt: input.lastStageChange?.get(l.id) ?? null,
      now,
    });
    const { lastContact, direction } = contactOf(activityByLead.get(l.id));
    const full = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
    const client = l.business_name?.trim() || full || l.email || "Unnamed lead";
    rows.push({
      key: `l-${l.id}`,
      kind: "lead",
      id: l.id,
      href: `/dashboard/leads/${l.id}/`,
      client,
      mark: l.mark_text?.trim() || null,
      stageLabel: stageName.get(l.current_stage_id) ?? null,
      stageDays: age.days,
      stageNote: age.days === null ? age.label : null,
      stageOrder: typeof stageOrderOf.get(l.current_stage_id) === "number" ? stageOrderOf.get(l.current_stage_id)! : null,
      assignedTo: l.assigned_to,
      contactKnown,
      lastContact,
      lastDirection: direction,
      waiting: waitingOn({
        withUspto: false,
        pendingApproval: input.pendingLeadIds?.has(l.id) ?? false,
        lastDirection: direction,
      }),
      nextStep: leadTasks.get(l.id) ?? null,
      deadline: null,
    });
  }
  return rows;
}
