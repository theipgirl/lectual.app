/**
 * Automatic consult prep: the keys and markers (pure, no imports, so the lead step engine can read them).
 *
 * A prep is keyed to ONE consult:
 *   with an event       `<lead id>:<event id>:<start ISO>`   (a new start time is a new key: a reschedule gets a fresh prep)
 *   without one         `<lead id>:stage:<id>`                (the newest `stage_changed` row into the consult stage)
 *   a person's re-run   either of the above + `:rerun:<epoch ms>`
 *
 * Markers hold ids and times only, never a name, address or word of the brief.
 */

/** `payload.source` on the `ai_insight` rows that record one email send (booked, 24h, 1h). */
export const PREP_SEND_SOURCE = "consult-prep-send";

/** `payload.source` on the `ai_insight` rows that record a full-brief build attempt (`started`) and a queued full brief (`queued`, its item id). S2b. */
export const PREP_BUILD_SOURCE = "consult-prep-build";

/** `payload.kind` of the `queue_drafted` marker that records the prep itself and points at its stored brief. */
export const PREP_BRIEF_KIND = "brief";

const RERUN = /:rerun:\d+$/;

/** A civil instant as one stable string, so the same start always makes the same key. Null for a value that is not a time. */
export function normalizedStart(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function eventPrepKey(leadId: string, eventId: string, startsAt: string): string {
  return `${leadId}:${eventId}:${normalizedStart(startsAt) ?? startsAt}`;
}

export function stagePrepKey(leadId: string, stageRowId: string): string {
  return `${leadId}:stage:${stageRowId}`;
}

export function rerunKey(baseKey: string, nowMs: number): string {
  return `${baseKey}:rerun:${Math.trunc(nowMs)}`;
}

export type ParsedPrepKey = { leadId: string; kind: "event"; eventId: string; startsAt: string; rerun: boolean } | { leadId: string; kind: "stage"; stageRowId: string; rerun: boolean };

/** Reads a key back. Anything that is not one of the two shapes is null. */
export function parsePrepKey(key: string): ParsedPrepKey | null {
  const rerun = RERUN.test(key);
  const base = rerun ? key.replace(RERUN, "") : key;
  const first = base.indexOf(":");
  if (first <= 0) return null;
  const second = base.indexOf(":", first + 1);
  if (second <= first + 1) return null;
  const leadId = base.slice(0, first);
  const middle = base.slice(first + 1, second);
  const rest = base.slice(second + 1);
  if (!rest) return null;
  if (middle === "stage") return { leadId, kind: "stage", stageRowId: rest, rerun };
  return { leadId, kind: "event", eventId: middle, startsAt: rest, rerun };
}

/** The `event_id` a marker carries: the event's id, or `stage:<row id>` for a stage-keyed prep. */
export function markerEventId(key: string): string | null {
  const parsed = parsePrepKey(key);
  if (!parsed) return null;
  return parsed.kind === "event" ? parsed.eventId : `stage:${parsed.stageRowId}`;
}
