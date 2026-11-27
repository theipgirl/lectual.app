import {
  MERGE_FIELDS,
  defaultChoice,
  isLeadId,
  sameValue,
  suggestKeeper,
  type KeeperWhy,
  type MergeField,
  type MergeSide,
} from "./merge";

/**
 * What the merge screen shows (M5): both leads, which one is suggested to keep and why, the fields that differ
 * with the default choice, and what moves and what stays (counted for the lead being merged). Every read goes
 * through the caller's client (the scoped client: RLS makes another firm's id read as missing). Each count is its
 * own read and has three states: a failed one is `unavailable`, never 0. Nothing is written.
 */

export type MergeLeadRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  business_name: string | null;
  website: string | null;
  mark_text: string | null;
  referral_source: string | null;
  referral_detail: string | null;
  practice_area: string | null;
  assigned_to: string | null;
  temperature: string | null;
  lane: string | null;
  current_stage_id: string | null;
  lawmatics_id: string | null;
  created_at: string | null;
  merged_into_id?: string | null;
};

export type Count = { status: "ok"; count: number } | { status: "unavailable" };

export const MOVE_COUNTS = ["tasks", "time", "matters", "meetings", "calendar", "discovery", "scorecards", "submissions", "consultNotes", "enrollments", "tags"] as const;
export const STAY_COUNTS = ["activity", "files", "proposals", "quotes"] as const;
export type CountKey = (typeof MOVE_COUNTS)[number] | (typeof STAY_COUNTS)[number];

/** Which table and filter each count reads. Enrollments count only the ones the function moves or stops. */
export const COUNT_SOURCES: Record<CountKey, { table: string; activeOnly?: true }> = {
  tasks: { table: "crm_task" },
  time: { table: "crm_time_entry" },
  matters: { table: "crm_matter" },
  meetings: { table: "crm_meeting" },
  calendar: { table: "crm_calendar_event" },
  discovery: { table: "crm_discovery_session" },
  scorecards: { table: "crm_booth_scorecard" },
  submissions: { table: "crm_intake_submission" },
  consultNotes: { table: "crm_consult_note" },
  enrollments: { table: "crm_drip_enrollment", activeOnly: true },
  tags: { table: "crm_lead_tag" },
  activity: { table: "crm_activity" },
  files: { table: "crm_file" },
  proposals: { table: "client_proposal" },
  quotes: { table: "crm_quote" },
};

export type MergeFieldRow = { field: MergeField; keeper: string | null; loser: string | null; same: boolean; choice: MergeSide };

export type MergeView =
  | { status: "bad-ids" }
  | { status: "unavailable" }
  | { status: "not-a-lead"; matterId: string }
  | { status: "gone" }
  | { status: "already-merged"; name: string; keeperId: string | null }
  | {
      status: "ok";
      keeper: MergeLeadRow;
      loser: MergeLeadRow;
      why: KeeperWhy;
      fields: MergeFieldRow[];
      counts: Record<CountKey, Count>;
      loserMatters: { id: string; label: string }[] | null;
    };

export type MergeReads = {
  lead: (id: string) => Promise<MergeLeadRow | null>;
  matterExists: (id: string) => Promise<boolean>;
  matters: (leadId: string) => Promise<{ id: string; label: string }[]>;
  count: (key: CountKey, leadId: string) => Promise<number>;
};

export function leadName(l: Pick<MergeLeadRow, "first_name" | "last_name" | "email" | "business_name">): string {
  return `${(l.first_name ?? "").trim()} ${(l.last_name ?? "").trim()}`.trim() || (l.business_name ?? "").trim() || (l.email ?? "").trim() || "This lead";
}

async function counted(read: () => Promise<number>): Promise<Count> {
  try {
    const n = await read();
    return Number.isInteger(n) && n >= 0 ? { status: "ok", count: n } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export function fieldRows(keeper: MergeLeadRow, loser: MergeLeadRow): MergeFieldRow[] {
  return MERGE_FIELDS.map((field) => {
    const k = keeper[field] ?? null;
    const l = loser[field] ?? null;
    return { field, keeper: k, loser: l, same: sameValue(k, l), choice: defaultChoice(k, l) };
  });
}

export async function loadMergeView(aId: unknown, bId: unknown, keep: unknown, reads: MergeReads): Promise<MergeView> {
  if (!isLeadId(aId) || !isLeadId(bId) || aId.toLowerCase() === bId.toLowerCase()) return { status: "bad-ids" };
  let a: MergeLeadRow | null;
  let b: MergeLeadRow | null;
  try {
    [a, b] = await Promise.all([reads.lead(aId), reads.lead(bId)]);
  } catch {
    return { status: "unavailable" };
  }
  for (const [row, id] of [
    [a, aId],
    [b, bId],
  ] as const) {
    if (row) continue;
    try {
      if (await reads.matterExists(id)) return { status: "not-a-lead", matterId: id };
    } catch {
      return { status: "unavailable" };
    }
    return { status: "gone" };
  }
  if (!a || !b) return { status: "gone" };
  for (const row of [a, b]) {
    if (row.merged_into_id) return { status: "already-merged", name: leadName(row), keeperId: isLeadId(row.merged_into_id) ? row.merged_into_id : null };
  }

  let aMatters: { id: string; label: string }[] | null = null;
  let bMatters: { id: string; label: string }[] | null = null;
  try {
    [aMatters, bMatters] = await Promise.all([reads.matters(a.id), reads.matters(b.id)]);
  } catch {
    aMatters = bMatters = null;
  }
  const suggested = suggestKeeper(
    { id: a.id, createdAt: a.created_at, hasMatter: (aMatters?.length ?? 0) > 0, hasLawmatics: !!a.lawmatics_id },
    { id: b.id, createdAt: b.created_at, hasMatter: (bMatters?.length ?? 0) > 0, hasLawmatics: !!b.lawmatics_id },
  );
  const chosen = keep === a.id || keep === b.id ? (keep as string) : null;
  const keeperId = chosen ?? suggested.keeperId;
  const why: KeeperWhy = chosen && chosen !== suggested.keeperId ? "chosen" : suggested.why;
  const keeper = keeperId === a.id ? a : b;
  const loser = keeperId === a.id ? b : a;
  const loserMatters = loser.id === a.id ? aMatters : bMatters;

  const keys = [...MOVE_COUNTS, ...STAY_COUNTS] as CountKey[];
  const values = await Promise.all(keys.map((key) => counted(() => reads.count(key, loser.id))));
  const counts = Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<CountKey, Count>;

  return { status: "ok", keeper, loser, why, fields: fieldRows(keeper, loser), counts, loserMatters };
}
