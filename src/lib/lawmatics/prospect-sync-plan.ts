/**
 * The Lawmatics daily sync's prospect step, decided. PURE: no database, no network, the clock is passed in.
 *
 * One set of matching rules, not two: after the records are filtered (cutoff, hired) and the people who
 * "came back" are set aside, the rest go through the importer's own `planImport` (practice-area filter OFF,
 * overwrite OFF). Of its result only two things are kept:
 *   - `creates`  -> a new lead in the new-enquiry stage (never won, lost or nurture), capped;
 *   - `updates` that LINK a lead found by email (`linksRecord && matchedBy === "email"`) -> write `lawmatics_id`
 *     ONLY, capped. The field changes `planImport` lists are ignored: this sync never fills or edits a lead's fields.
 * Everything else writes nothing and is counted by reason. Lawmatics contacts with no prospect are dropped.
 *
 * Came back (Taylor, Nov 23): the prospect is on no lead by `lawmatics_id`, and its email belongs to exactly ONE
 * lead (merged leads followed to the keeper) whose stage category is lost, won or nurture, with a name that does
 * not contradict. The lead gets `lawmatics_id` only when it has none, its stage is never touched, and one
 * `came_back` row is written per lead and Lawmatics id (the runner checks first).
 *
 * The cutoff: 2026-11-01 on the first run or when the stored value can't be read; after that
 * max(2026-11-01, last complete run - 2 days). A targeted read for a consult ignores the cutoff.
 */
import { keeperIn, type MergePointer } from "@/lib/leads/live";
import { isHiredStageName } from "./stage-map";
import { nameKey, planImport, type ExistingLead, type PlanStage, type PlannedCreate } from "./import-plan";
import type { LawmaticsSourceRecord } from "./normalize";

export const SYNC_CUTOFF_FLOOR = "2026-11-01T00:00:00.000Z";
export const CUTOFF_OVERLAP_DAYS = 2;
export const LEAD_CREATE_CAP = 50;
export const LEAD_LINK_CAP = 50;
const DAY_MS = 86_400_000;

/** The stored "last complete run" as read: a value, none yet, or couldn't be read (incl. before lectual 0118). */
export type LastSyncRead = { status: "ok"; value: string | null } | { status: "not-set-up" } | { status: "unavailable" };

/** The run's cutoff, as an ISO instant. */
export function syncCutoff(last: LastSyncRead): string {
  if (last.status !== "ok" || !last.value) return SYNC_CUTOFF_FLOOR;
  const ms = Date.parse(last.value);
  if (!Number.isFinite(ms)) return SYNC_CUTOFF_FLOOR;
  return new Date(Math.max(Date.parse(SYNC_CUTOFF_FLOOR), ms - CUTOFF_OVERLAP_DAYS * DAY_MS)).toISOString();
}

/** A prospect as the step needs it: the importer's sanitized record plus the two hired attributes. */
export type ProspectCandidate = {
  record: LawmaticsSourceRecord;
  /** Lawmatics `status` attribute (hired is case-insensitive). */
  status: string | null;
  /** Lawmatics `converted_date` attribute: set means hired. */
  convertedDate: string | null;
};

export function isHiredProspect(p: ProspectCandidate): boolean {
  if ((p.status ?? "").trim().toLowerCase() === "hired") return true;
  if (p.convertedDate && p.convertedDate.trim()) return true;
  return p.record.stageName !== null && isHiredStageName(p.record.stageName);
}

/** A lead as the step reads it: the importer's fields, the merge pointer and its stage's category. */
export type SyncLead = ExistingLead & MergePointer;

export type CameBackCategory = "lost" | "won" | "nurture";

export type PlannedCameBack = {
  leadId: string;
  lawmaticsId: string;
  category: CameBackCategory;
  /** True when the lead has no `lawmatics_id` yet: the runner writes it (fenced on null). */
  writeId: boolean;
};

export type PlannedLink = { leadId: string; lawmaticsId: string };

export type ProspectPlan = {
  creates: PlannedCreate[];
  links: PlannedLink[];
  cameBack: PlannedCameBack[];
  counts: {
    read: number;
    beforeCutoff: number;
    noCreatedDate: number;
    leftForHired: number;
    /** Matched a lead by Lawmatics id, or planImport found nothing to do. */
    unchanged: number;
    /** planImport's skips and unmapped records (no email, no name, ambiguous, merged-only, no open stage...). */
    needALook: number;
    contactsDropped: number;
    overCap: number;
  };
};

function lower(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return t || null;
}

const CLOSED: ReadonlySet<string> = new Set(["lost", "won", "nurture"]);

export function planProspectSync(input: {
  prospects: readonly ProspectCandidate[];
  stages: readonly PlanStage[];
  leads: readonly SyncLead[];
  cutoff: string;
  /** A consult's targeted read: the cutoff does not apply. */
  ignoreCutoff?: boolean;
  /** Creates already made this run (targeted reads share the cap). */
  createsUsed?: number;
  linksUsed?: number;
}): ProspectPlan {
  const counts: ProspectPlan["counts"] = { read: input.prospects.length, beforeCutoff: 0, noCreatedDate: 0, leftForHired: 0, unchanged: 0, needALook: 0, contactsDropped: 0, overCap: 0 };
  const cutoffMs = Date.parse(input.cutoff);
  const category = new Map(input.stages.map((s) => [s.id, s.category ?? null]));
  const byId = new Map<string, MergePointer>(input.leads.map((l) => [l.id, l]));
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const anyLawmatics = new Set(input.leads.map((l) => l.lawmatics_id).filter((x): x is string => !!x));
  const keepersByEmail = new Map<string, Set<string>>();
  for (const l of input.leads) {
    const e = lower(l.email);
    const keeper = keeperIn(l.id, byId);
    if (!e || !keeper) continue;
    keepersByEmail.set(e, (keepersByEmail.get(e) ?? new Set()).add(keeper));
  }

  const rest: LawmaticsSourceRecord[] = [];
  const cameBack: PlannedCameBack[] = [];
  const seenCameBack = new Set<string>();
  let linksUsed = input.linksUsed ?? 0;
  for (const p of input.prospects) {
    const rec = p.record;
    if (!input.ignoreCutoff) {
      const created = rec.createdAt ? Date.parse(rec.createdAt) : NaN;
      if (!Number.isFinite(created)) {
        counts.noCreatedDate += 1;
        continue;
      }
      if (created < cutoffMs) {
        counts.beforeCutoff += 1;
        continue;
      }
    }
    if (isHiredProspect(p)) {
      counts.leftForHired += 1;
      continue;
    }
    // Came back: on no lead by id, and the email reaches exactly one keeper in a closing or holding stage.
    const email = lower(rec.email);
    if (rec.lawmaticsId && !anyLawmatics.has(rec.lawmaticsId) && email) {
      const keepers = keepersByEmail.get(email);
      if (keepers && keepers.size === 1) {
        const keeper = leadById.get([...keepers][0]);
        const cat = keeper ? category.get(keeper.current_stage_id) : null;
        if (keeper && cat && CLOSED.has(cat)) {
          const local = nameKey([keeper.first_name, keeper.last_name].join(" "));
          const incoming = nameKey([rec.firstName, rec.lastName].join(" "));
          if (local && incoming && local !== incoming) {
            counts.needALook += 1; // the importer's "differently-named lead" skip: no flag
            continue;
          }
          const key = `${keeper.id}|${rec.lawmaticsId}`;
          if (seenCameBack.has(key)) continue;
          seenCameBack.add(key);
          const writeId = !keeper.lawmatics_id;
          if (writeId && linksUsed >= LEAD_LINK_CAP) {
            counts.overCap += 1;
            continue;
          }
          if (writeId) linksUsed += 1;
          cameBack.push({ leadId: keeper.id, lawmaticsId: rec.lawmaticsId, category: cat as CameBackCategory, writeId });
          continue;
        }
      }
    }
    rest.push(rec);
  }

  const plan = planImport(rest, input.stages, input.leads, { overwriteEditedFields: false, practiceAreaFilter: null }, []);
  counts.contactsDropped = plan.contactCreates.length;
  counts.needALook += plan.skipped.length + plan.unmapped.length;
  counts.unchanged += plan.unchanged.length;

  const creates: PlannedCreate[] = [];
  let createsUsed = input.createsUsed ?? 0;
  for (const c of plan.creates) {
    // The new-enquiry stage is never a closing stage (newEnquiryStage). Checked again: a create is never won/lost/nurture.
    const cat = category.get(c.stageId);
    if (cat && CLOSED.has(cat)) {
      counts.needALook += 1;
      continue;
    }
    if (createsUsed >= LEAD_CREATE_CAP) {
      counts.overCap += 1;
      continue;
    }
    createsUsed += 1;
    creates.push(c);
  }

  const links: PlannedLink[] = [];
  for (const u of plan.updates) {
    if (!(u.linksRecord && u.matchedBy === "email")) {
      // Matched by Lawmatics id: someone already brought this person in. This sync never updates them.
      counts.unchanged += 1;
      continue;
    }
    if (linksUsed >= LEAD_LINK_CAP) {
      counts.overCap += 1;
      continue;
    }
    linksUsed += 1;
    links.push({ leadId: u.leadId, lawmaticsId: u.lawmaticsId });
  }

  return { creates, links, cameBack, counts };
}

/** The stage-age rule for a created lead: `created_at` / `last_activity_at` = the Lawmatics created date (past only). */
export function createdDates(createdAt: string | null, nowMs: number): { created_at?: string; last_activity_at?: string } {
  const ms = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(ms) || ms > nowMs) return {};
  const iso = new Date(ms).toISOString();
  return { created_at: iso, last_activity_at: iso };
}

/**
 * "Last complete run" moves only when the prospect step read /prospects and /contacts completely, kept its
 * includes, finished inside its budget and left nobody over the per-run limit. It is then the run's START time.
 */
export function nextLastSync(input: { complete: boolean; inTime: boolean; overCap: number; runStartedAt: string }): string | null {
  return input.complete && input.inTime && input.overCap === 0 ? input.runStartedAt : null;
}
