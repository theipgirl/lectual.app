import { parsePrepKey, normalizedStart } from "./keys";

/**
 * The three emails of an event-keyed prep, and what a run owes (pure; the clock is passed in).
 *
 *   booked   sent now, by the run that made the prep (or retried after a recorded failure)
 *   24h      scheduled for start - 24 h, ONLY if the prep was made more than 24 h before the start
 *   1h       scheduled for start - 1 h, only while that is still in the future (under an hour left: nothing more)
 *
 * Resend takes a `scheduled_at` only for a send inside the next 72 hours here; a later one is OWED and a later run
 * (the sweeps run several times a day) schedules it. A stage-keyed prep (no consult yet) sends `booked` only.
 */

export type SendKind = "booked" | "24h" | "1h";
export const SEND_KINDS: readonly SendKind[] = ["booked", "24h", "1h"];
export type SendStatus = "sent" | "scheduled" | "cancelled" | "failed";

export const HOUR_MS = 3_600_000;
/** Only a send inside this window is handed to Resend with a time; a later one waits for a later run. */
export const SCHEDULE_HORIZON_MS = 72 * HOUR_MS;
/** A booked email already sent for a stage-keyed prep within this long means a consult booking does not send another. */
export const BOOKED_SUPPRESS_MS = 7 * 24 * HOUR_MS;

/** One send record as read back from the timeline (ids and times only). */
export type SendRecord = {
  /** The lead the row is filed on (the row's own `lead_id`). */
  leadId: string | null;
  prepKey: string;
  kind: SendKind;
  resendId: string | null;
  scheduledFor: string | null;
  status: SendStatus;
  /** When the record was written. */
  at: string;
};

export const recordSlot = (prepKey: string, kind: SendKind): string => `${prepKey}|${kind}`;

const isKind = (v: unknown): v is SendKind => v === "booked" || v === "24h" || v === "1h";
const isStatus = (v: unknown): v is SendStatus => v === "sent" || v === "scheduled" || v === "cancelled" || v === "failed";

/** A `crm_activity` row that may be a send record. Anything that is not exactly one is null. */
export function parseSendRecord(row: { lead_id?: string | null; created_at?: string | null; payload?: unknown }): SendRecord | null {
  const p = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : null;
  if (!p || typeof p.prep_key !== "string" || !isKind(p.kind) || !isStatus(p.status)) return null;
  return {
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    prepKey: p.prep_key,
    kind: p.kind,
    resendId: typeof p.resend_id === "string" ? p.resend_id : null,
    scheduledFor: typeof p.scheduled_for === "string" ? p.scheduled_for : null,
    status: p.status,
    at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

/** The payload of a send record. Ids and times only. */
export function sendRecordPayload(r: Omit<SendRecord, "at" | "leadId">): Record<string, unknown> {
  return { source: "consult-prep-send", prep_key: r.prepKey, kind: r.kind, resend_id: r.resendId, scheduled_for: r.scheduledFor, status: r.status };
}

/**
 * The newest record per (prep key, kind). Records are append-only: a cancel or a retry is a NEW row, so the newest one
 * is the truth. Two rows with one timestamp: the later in the list wins (the caller reads oldest first).
 */
export function foldSendRecords(records: readonly SendRecord[]): Map<string, SendRecord> {
  const out = new Map<string, SendRecord>();
  for (const r of records) {
    const slot = recordSlot(r.prepKey, r.kind);
    const have = out.get(slot);
    if (!have || Date.parse(r.at) >= Date.parse(have.at) || !Number.isFinite(Date.parse(have.at))) out.set(slot, r);
  }
  return out;
}

const done = (r: SendRecord | undefined): boolean => !!r && (r.status === "sent" || r.status === "scheduled");

export type SendAction = { kind: SendKind; mode: "now" } | { kind: SendKind; mode: "schedule"; at: string };
export type SendPlan = { actions: SendAction[]; owedLater: SendKind[] };

export type PlanInput = {
  prepKey: string;
  /** The consult's start; null for a stage-keyed prep. */
  startsAtMs: number | null;
  nowMs: number;
  /** When the prep was made (the marker's time). */
  preppedAtMs: number;
  /** The run that made the prep may send `booked`; a later run only retries one that was recorded as failed. */
  madeNow: boolean;
  /** A stage-keyed booked email went out in the last 7 days: this consult's booking does not send another. */
  suppressBooked: boolean;
  existing: ReadonlyMap<string, SendRecord>;
};

export function planSends(input: PlanInput): SendPlan {
  const actions: SendAction[] = [];
  const owedLater: SendKind[] = [];
  const get = (kind: SendKind) => input.existing.get(recordSlot(input.prepKey, kind));

  const booked = get("booked");
  if (!done(booked) && !input.suppressBooked && (input.madeNow || booked?.status === "failed")) actions.push({ kind: "booked", mode: "now" });

  if (input.startsAtMs === null) return { actions, owedLater };
  const start = input.startsAtMs;
  const reminders: Array<[SendKind, number, boolean]> = [
    ["24h", start - 24 * HOUR_MS, start - input.preppedAtMs > 24 * HOUR_MS],
    ["1h", start - HOUR_MS, true],
  ];
  for (const [kind, at, wanted] of reminders) {
    if (!wanted || done(get(kind))) continue;
    if (at <= input.nowMs) continue; // its time has passed: nothing more is owed for it
    if (at - input.nowMs <= SCHEDULE_HORIZON_MS) actions.push({ kind, mode: "schedule", at: new Date(at).toISOString() });
    else owedLater.push(kind);
  }
  return { actions, owedLater };
}

/** True when a stage-keyed prep of this lead sent (or scheduled) its booked email in the last 7 days. */
export function stageBookedRecently(records: readonly SendRecord[], leadId: string, nowMs: number): boolean {
  return records.some((r) => {
    if (r.kind !== "booked" || (r.status !== "sent" && r.status !== "scheduled")) return false;
    const parsed = parsePrepKey(r.prepKey);
    if (!parsed || parsed.kind !== "stage" || parsed.leadId !== leadId) return false;
    const at = Date.parse(r.at);
    return Number.isFinite(at) && nowMs - at <= BOOKED_SUPPRESS_MS && at <= nowMs + 1000;
  });
}

/** What the calendar says about the event a scheduled send was made for, now. `null` = the event is not there. */
export type EventNow = { startsAt: string | null; leadId: string | null; isConsult: boolean | null } | null;

/**
 * A scheduled send is cancelled when the event is gone, its start changed, it is no longer a consult, or its lead
 * changed. A stage-keyed send is never scheduled, so it never reaches here (it is simply not cancelled).
 */
export function shouldCancel(record: SendRecord, event: EventNow): boolean {
  if (record.status !== "scheduled") return false;
  const parsed = parsePrepKey(record.prepKey);
  if (!parsed || parsed.kind !== "event") return false;
  if (!event) return true;
  if (event.isConsult !== true) return true;
  if (event.leadId !== parsed.leadId) return true;
  return normalizedStart(event.startsAt) !== normalizedStart(parsed.startsAt);
}
