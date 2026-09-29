/**
 * Pure Team-Status aggregation — no database, no server-only imports, safe to
 * import from a `"use client"` component. Same discipline as docket-summary.ts
 * and stage-rules.ts.
 *
 * This is the arithmetic behind the Monday-meeting-killer page (docs/specs —
 * §E of the 2026-08-21 dashboard plan): instead of Rebecca's team reading a
 * shared spreadsheet row by row for ~90 minutes, the page reorganizes the SAME
 * docket around "what changed since last week" — read straight off the
 * append-only crm_activity timeline every write in this codebase already logs
 * to (0019), never a new "last touched" column. Matters with no activity in
 * the window fall into "quiet" instead of vanishing, sorted worst-stale-first,
 * which is exactly the set the meeting needs to ask "whose court is this in
 * and why hasn't it moved."
 */

import {
  isOpenMatter,
  matterLabel,
  type DocketMatterInput,
} from "./docket-summary";
import { daysInStage, matterIsStale, type MatterWaitingOn } from "./stage-rules";
import { ownerChipFor, type OwnerChip } from "./owner-code";

/** The shape buildTeamStatusRows needs from a matter. Structural, like
 *  DocketMatterInput — `Matter` (server-side) satisfies it without this
 *  module importing the server-only matters lib. */
export type TeamStatusMatterInput = DocketMatterInput & {
  assigned_to: string | null;
};

/** The shape buildTeamStatusRows needs from a crm_activity row. `payload` is
 *  read defensively (it's jsonb — shape is a convention, not a guarantee).
 *  Both id fields are carried (matching the real table, which NOT NULLs on
 *  "at least one") so the same row shape serves both the matter board and the
 *  lead delta list below. */
export type TeamStatusActivityInput = {
  id: string;
  matter_id: string | null;
  lead_id?: string | null;
  type: string;
  payload: unknown;
  created_at: string;
};

/** The shape buildTeamStatusRows needs to resolve assigned_to into a chip. */
export type OwnerDirectoryEntry = {
  userId: string;
  displayName: string | null;
  email: string | null;
};

export type ActivityDelta = {
  id: string;
  type: string;
  /** One human-readable line — what a Monday-meeting attendee would say out loud. */
  summary: string;
  at: string;
};

export type TeamStatusRow = {
  matterId: string;
  matterNumber: string;
  label: string;
  status: string;
  stageCode: string | null;
  stageLabel: string | null;
  waitingOn: MatterWaitingOn | null;
  daysInStage: number | null;
  isStale: boolean;
  owner: OwnerChip | null;
  /** Newest first. */
  deltas: ActivityDelta[];
  lastActivityAt: string | null;
  changedThisWeek: boolean;
};

export type TeamStatusBoard = {
  /** Had at least one crm_activity row in the window — what the meeting reviews first. */
  moved: TeamStatusRow[];
  /** Open, no activity in the window — worst-stale-first, "needs a nudge." */
  quiet: TeamStatusRow[];
};

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * One human-readable line per activity row, dispatched on `type` and (for
 * matter_updated) on `payload.change`. Every write site that logs one of these
 * is in src/lib/matters/{matters,stages,deadlines}.ts — kept in sync with
 * their actual payload shapes; falls back to a de-slugged type name for
 * anything this hasn't been taught yet, so a future activity type never
 * renders as a blank delta.
 */
export function summarizeMatterActivity(row: TeamStatusActivityInput): string {
  const p = asRecord(row.payload);

  switch (row.type) {
    case "stage_changed": {
      const to = str(p, "to_code");
      const toLabel = str(p, "to_label");
      const from = str(p, "from_code");
      const arrow = from ? `${from} → ${to ?? "?"}` : `→ ${to ?? "?"}`;
      return toLabel ? `Stage: ${arrow} (${toLabel})` : `Stage: ${arrow}`;
    }
    case "matter_opened":
      return "Matter opened";
    case "matter_updated": {
      const change = str(p, "change");
      switch (change) {
        case "ip_fields":
          return "Filing details updated";
        case "deadline_docketed":
          return `Deadline docketed${str(p, "due_date") ? ` — due ${str(p, "due_date")}` : ""}`;
        case "deadline_confirmed":
          return "Deadline confirmed by attorney";
        case "deadline_closed":
          return `Deadline closed${str(p, "status") ? ` (${str(p, "status")})` : ""}`;
        case "deadline_extended":
          return `Deadline extended${str(p, "to") ? ` to ${str(p, "to")}` : ""}`;
        case "owner_assigned":
          return "Owner reassigned";
        default:
          return "Matter updated";
      }
    }
    case "note":
      return "Note added";
    case "voice_note":
      return "Voice note added";
    case "task_created":
      return "Task added";
    case "task_completed":
      return "Task completed";
    default:
      return row.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

/**
 * Buckets the org's docket into "moved this week" and "quiet, needs a nudge",
 * with each matter's owner resolved to a chip.
 *
 * `activity` should already be filtered to the review window (matterActivitySince
 * in src/lib/matters/activity.ts) — this function does not re-filter by date,
 * only groups what it's handed.
 */
export function buildTeamStatusRows(
  matters: readonly TeamStatusMatterInput[],
  activity: readonly TeamStatusActivityInput[],
  directory: readonly OwnerDirectoryEntry[],
  now: Date = new Date(),
): TeamStatusBoard {
  const byUser = new Map(directory.map((d) => [d.userId, d]));
  const activityByMatter = new Map<string, TeamStatusActivityInput[]>();
  for (const row of activity) {
    if (!row.matter_id) continue;
    const bucket = activityByMatter.get(row.matter_id);
    if (bucket) bucket.push(row);
    else activityByMatter.set(row.matter_id, [row]);
  }

  const moved: TeamStatusRow[] = [];
  const quiet: TeamStatusRow[] = [];

  for (const matter of matters) {
    const own = (activityByMatter.get(matter.id) ?? [])
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const deltas: ActivityDelta[] = own.map((r) => ({
      id: r.id,
      type: r.type,
      summary: summarizeMatterActivity(r),
      at: r.created_at,
    }));

    const identity = matter.assigned_to ? (byUser.get(matter.assigned_to) ?? {
      userId: matter.assigned_to,
      displayName: null,
      email: null,
    }) : null;

    const stale = matter.stage
      ? matterIsStale({ stage_entered_at: matter.stage_entered_at, waiting_on: matter.stage.waiting_on }, now)
      : false;

    const row: TeamStatusRow = {
      matterId: matter.id,
      matterNumber: matter.matter_number,
      label: matterLabel(matter),
      status: matter.status,
      stageCode: matter.stage?.code ?? null,
      stageLabel: matter.stage?.label ?? null,
      waitingOn: matter.stage?.waiting_on ?? null,
      daysInStage: daysInStage(matter.stage_entered_at, now),
      isStale: stale,
      owner: ownerChipFor(identity),
      deltas,
      lastActivityAt: deltas[0]?.at ?? null,
      changedThisWeek: deltas.length > 0,
    };

    if (row.changedThisWeek) {
      moved.push(row);
    } else if (isOpenMatter(matter)) {
      quiet.push(row);
    }
  }

  moved.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  quiet.sort((a, b) => {
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    return (b.daysInStage ?? 0) - (a.daysInStage ?? 0);
  });

  return { moved, quiet };
}

/**
 * The Monday (00:00 UTC) on/before `date` — the week key crm_team_status_note
 * and the activity-window query both use. UTC, not local time, so a firm's
 * "this week" doesn't shift with the server's timezone.
 */
export function weekStartOf(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: Sun=0..Sat=6. ISO Monday-start offset.
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (isoDay - 1));
  return d;
}

/** civil YYYY-MM-DD for a UTC-midnight Date, e.g. for a `date` column or a query param. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Monday one week before `weekStart` (also UTC-midnight). */
export function previousWeekStart(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

/**
 * Leads get the same owner convention as matters (crm_lead.assigned_to
 * already existed — see AGENTS.md check before adding a column). This is a
 * lighter companion to buildTeamStatusRows: a compact "leads on the move"
 * list, not a second full board, since the meeting this page replaces is run
 * off the matter docket.
 */
export type TeamStatusLeadInput = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  assigned_to: string | null;
};

export type LeadDeltaRow = {
  leadId: string;
  label: string;
  owner: OwnerChip | null;
  deltas: ActivityDelta[];
  lastActivityAt: string;
};

export function leadLabel(lead: TeamStatusLeadInput): string {
  return (
    lead.business_name?.trim() ||
    `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() ||
    "Unnamed lead"
  );
}

/** Leads with at least one activity row in the window, newest-activity first. */
export function buildLeadDeltaRows(
  leads: readonly TeamStatusLeadInput[],
  activity: readonly TeamStatusActivityInput[],
  directory: readonly OwnerDirectoryEntry[],
): LeadDeltaRow[] {
  const byUser = new Map(directory.map((d) => [d.userId, d]));
  const activityByLead = new Map<string, TeamStatusActivityInput[]>();
  for (const row of activity) {
    if (!row.lead_id) continue;
    const bucket = activityByLead.get(row.lead_id);
    if (bucket) bucket.push(row);
    else activityByLead.set(row.lead_id, [row]);
  }

  const rows: LeadDeltaRow[] = [];
  for (const lead of leads) {
    const own = activityByLead.get(lead.id);
    if (!own || own.length === 0) continue;
    const sorted = own.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const identity = lead.assigned_to
      ? byUser.get(lead.assigned_to) ?? { userId: lead.assigned_to, displayName: null, email: null }
      : null;
    rows.push({
      leadId: lead.id,
      label: leadLabel(lead),
      owner: ownerChipFor(identity),
      deltas: sorted.map((r) => ({
        id: r.id,
        type: r.type,
        summary: summarizeMatterActivity(r),
        at: r.created_at,
      })),
      lastActivityAt: sorted[0].created_at,
    });
  }

  rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return rows;
}
