import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Lead, Stage } from "@/lib/pipeline";
import { STANDARD_SEQUENCE_EMAIL_STEPS, type TemperatureFacts } from "./temperature";

/**
 * Loads the recorded facts temperature.ts cannot read off a lead row: whether the
 * standard email sequence ran out unanswered, whether the lead is booked, and when
 * we first reached out. Read-only, and every read goes through the caller's scoped
 * client (RLS), so a lead from another firm simply has no rows.
 *
 * TWO STATES, NOT ONE: `ok` means every read came back; `unavailable` means at
 * least one did not, and then NO facts are returned at all. The caller builds its
 * rows without them, so the existing rules run unchanged. A failed read is never
 * turned into a guessed "cold" (AGENTS.md: a failed read is never "none").
 *
 * `firstTouchAt` is deliberately NOT crm_lead.created_at: a lead can sit untouched
 * for days after it is created, and that would start the day-10 clock too early.
 * With no recorded outreach the fact is absent and the rule does not fire.
 */

type FactsResult = { data: unknown; error: unknown };

/** The narrow read surface used here: select / in / eq / order / range, nothing that writes. */
export interface FactsQuery extends PromiseLike<FactsResult> {
  select(columns: string): FactsQuery;
  in(column: string, values: readonly unknown[]): FactsQuery;
  eq(column: string, value: unknown): FactsQuery;
  order(column: string, options?: { ascending?: boolean }): FactsQuery;
  range(from: number, to: number): FactsQuery;
}
export interface FactsDb {
  from(table: string): FactsQuery;
}

export type TemperatureFactsRead =
  | { status: "ok"; byLead: Record<string, TemperatureFacts> }
  | { status: "unavailable" };

/** Leads per `.in()`: a uuid list this long stays well inside a PostgREST URL. */
const ID_CHUNK = 80;
/** PostgREST's default page; paging past it is what keeps a busy firm's rows from truncating silently. */
const PAGE = 1000;
/** A runaway read becomes `unavailable` rather than an unbounded loop. */
const MAX_PAGES = 30;

type Row = Record<string, unknown>;
type LeadInput = Pick<Lead, "id" | "current_stage_id" | "stage_entered_at" | "last_inbound_at">;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function earliestOf(values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const v of values) if (ms(v) !== null && (best === null || ms(v)! < ms(best)!)) best = v;
  return best;
}

function latestOf(values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const v of values) if (ms(v) !== null && (best === null || ms(v)! > ms(best)!)) best = v;
  return best;
}

/** Every row of one chunk's query, paged. Throws on any error so the caller reports `unavailable`. */
async function readAll(build: () => FactsQuery): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await build()
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("facts read failed");
    const got = Array.isArray(data) ? (data as Row[]) : [];
    rows.push(...got);
    if (got.length < PAGE) return rows;
  }
  throw new Error("facts read too large");
}

async function readChunked(ids: string[], build: (chunk: string[]) => FactsQuery): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...(await readAll(() => build(chunk))));
  }
  return out;
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const k = str(row[key]);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export async function loadTemperatureFacts(
  leads: readonly LeadInput[],
  stages: readonly Pick<Stage, "id" | "category">[],
  db?: FactsDb,
): Promise<TemperatureFactsRead> {
  if (leads.length === 0) return { status: "ok", byLead: {} };

  try {
    const client = db ?? ((await getScopedClient()) as unknown as FactsDb);
    const ids = leads.map((l) => l.id);

    const [enrollments, meetings, sessions, activity] = await Promise.all([
      readChunked(ids, (c) =>
        client.from("crm_drip_enrollment").select("id, lead_id, sequence_id, status, enrolled_at, completed_at").in("lead_id", c),
      ),
      readChunked(ids, (c) => client.from("crm_meeting").select("id, lead_id, started_at").in("lead_id", c)),
      readChunked(ids, (c) =>
        client.from("crm_discovery_session").select("id, lead_id, started_at, outcome").in("lead_id", c).eq("outcome", "booked_lss"),
      ),
      readChunked(ids, (c) =>
        client.from("crm_activity").select("id, lead_id, created_at, type").in("lead_id", c).in("type", ["email_sent", "call_logged"]),
      ),
    ]);

    // Which of the sequences these leads were in are "standard" (enough email steps).
    const sequenceIds = Array.from(new Set(enrollments.map((e) => str(e.sequence_id)).filter((v): v is string => !!v)));
    const steps = await readChunked(sequenceIds, (c) =>
      client.from("crm_drip_step").select("id, sequence_id, type").in("sequence_id", c).eq("type", "email"),
    );
    const emailSteps = new Map<string, number>();
    for (const step of steps) {
      const seq = str(step.sequence_id);
      if (seq && step.type === "email") emailSteps.set(seq, (emailSteps.get(seq) ?? 0) + 1);
    }
    const isStandard = (sequenceId: string | null) =>
      sequenceId !== null && (emailSteps.get(sequenceId) ?? 0) >= STANDARD_SEQUENCE_EMAIL_STEPS;

    const wonStages = new Set(stages.filter((s) => s.category === "won").map((s) => s.id));
    const enrollmentsByLead = groupBy(enrollments, "lead_id");
    const meetingsByLead = groupBy(meetings, "lead_id");
    const sessionsByLead = groupBy(sessions, "lead_id");
    const activityByLead = groupBy(activity, "lead_id");

    const byLead: Record<string, TemperatureFacts> = {};
    for (const lead of leads) {
      const mine = enrollmentsByLead.get(lead.id) ?? [];

      // Only a COMPLETED run of a standard sequence is "the sequence ended". A stopped one
      // ended for a reason (signed, paid, replied, booked, by hand) and says nothing here.
      const ended = mine
        .filter((e) => e.status === "completed" && isStandard(str(e.sequence_id)))
        .filter((e) => {
          const enrolledAt = ms(str(e.enrolled_at));
          const inbound = ms(lead.last_inbound_at);
          // A reply after enrolment means the lead is not silent; no reply on file is not a reply.
          return enrolledAt !== null && ms(str(e.completed_at)) !== null && (inbound === null || inbound <= enrolledAt);
        })
        .map((e) => str(e.completed_at));
      const sequenceEndedNoReplyAt = latestOf(ended);

      const bookedAt = latestOf([
        ...(meetingsByLead.get(lead.id) ?? []).map((m) => str(m.started_at)),
        ...(sessionsByLead.get(lead.id) ?? []).map((s) => str(s.started_at)),
        wonStages.has(lead.current_stage_id) ? str(lead.stage_entered_at) : null,
      ]);

      const firstTouchAt = earliestOf([
        ...(activityByLead.get(lead.id) ?? []).map((a) => str(a.created_at)),
        ...mine.map((e) => str(e.enrolled_at)),
      ]);

      if (sequenceEndedNoReplyAt || bookedAt || firstTouchAt) {
        byLead[lead.id] = { sequenceEndedNoReplyAt, bookedAt, firstTouchAt };
      }
    }

    return { status: "ok", byLead };
  } catch (err) {
    // The failure's own message only: never a row, a lead or a name.
    console.warn(`[intake] temperature facts unavailable: ${err instanceof Error ? err.message : "read failed"}`);
    return { status: "unavailable" };
  }
}
