import { sameLeadSameTime } from "@/lib/calendar/booked-merge";

/**
 * One call booked twice: the same lead's events whose starts are within the same-call window of `booked-merge.ts`
 * (`SAME_CALL_MINUTES`, the rule Today and the lead page already use; no second constant lives here). Pure.
 */

export type TwinEvent = { id: string; leadId: string; startsAt: string; source: string | null };

/**
 * Collapses twins into one event per call. The one kept is the twin that already has a prep marker, else the Lawmatics row,
 * else the earliest. Returns the kept events (soonest first) and how many were dropped.
 */
export function collapseTwins<T extends TwinEvent>(events: readonly T[], hasMarker: (e: T) => boolean): { kept: T[]; dropped: number } {
  const sorted = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const clusters: T[][] = [];
  for (const e of sorted) {
    const home = clusters.find((c) => c.some((m) => sameLeadSameTime({ leadId: m.leadId, startsAt: m.startsAt }, { leadId: e.leadId, startsAt: e.startsAt })));
    if (home) home.push(e);
    else clusters.push([e]);
  }
  const kept = clusters.map((c) => c.find(hasMarker) ?? c.find((e) => e.source === "lawmatics") ?? c[0]);
  kept.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { kept, dropped: events.length - kept.length };
}

/** True when the lead already has a prep marker whose start is within the same-call window of this start, whatever the event id. */
export function hasTwinMarker(markers: ReadonlyArray<{ leadId: string; startAt: string }>, leadId: string, startsAt: string): boolean {
  return markers.some((m) => sameLeadSameTime({ leadId: m.leadId, startsAt: m.startAt }, { leadId, startsAt }));
}
