import type { Matter } from "./matters";
import type { MatterWaitingOn } from "./stage-rules";
import { daysInStage, matterIsStale } from "./stage-rules";
import { isOpenMatter } from "./docket-summary";

/**
 * The Matters worklist from the design (design/Matters_Prototype.dc.html):
 * one band per "whose move is it", so the page answers "what do we owe" before
 * "what exists". Pure, and imports only pure siblings, so it is safe anywhere.
 *
 * Bands come from the docket stage's own `waiting_on` (crm_matter_stage, 0042),
 * never from anything typed per matter. A matter no stage has been set for gets
 * its own band rather than disappearing, and a closed matter (either signal,
 * see isOpenMatter) goes to Closed whatever its stage says.
 */

export type BandKey = MatterWaitingOn | "unplaced" | "closed";

export const BAND_ORDER: readonly BandKey[] = ["firm", "client", "uspto", "court", "unplaced", "closed"];

export const BAND_COPY: Record<BandKey, { label: string; hint: string }> = {
  firm: { label: "Waiting on us", hint: "we owe the next move" },
  client: { label: "Waiting on the client", hint: "nudge past 21 days" },
  uspto: { label: "With the USPTO", hint: "nothing to do but watch" },
  court: { label: "With the court", hint: "watch the docket" },
  unplaced: { label: "Not on the docket yet", hint: "give these a stage" },
  closed: { label: "Closed", hint: "kept for the record" },
};

export function bandOf(matter: Matter): BandKey {
  if (!isOpenMatter(matter)) return "closed";
  return matter.stage ? matter.stage.waiting_on : "unplaced";
}

export type Band = { key: BandKey; matters: Matter[] };

/** Non-empty bands in BAND_ORDER; within a band, longest in stage first. */
export function groupIntoBands(matters: readonly Matter[], now: Date = new Date()): Band[] {
  const by = new Map<BandKey, Matter[]>();
  for (const m of matters) {
    const k = bandOf(m);
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  const age = (m: Matter) => daysInStage(m.stage_entered_at, now) ?? -1;
  return BAND_ORDER.filter((k) => by.has(k)).map((key) => ({
    key,
    matters: [...(by.get(key) ?? [])].sort((a, b) => age(b) - age(a)),
  }));
}

/** The segment chips. `review` and `stalled` need sets the page computes. */
export const SEGMENTS = [
  { key: "open", label: "Everything open" },
  { key: "firm", label: "Waiting on us" },
  { key: "client", label: "Waiting on the client" },
  { key: "uspto", label: "With the USPTO" },
  { key: "stalled", label: "Gone quiet" },
  { key: "review", label: "Needs your review" },
  { key: "unassigned", label: "Unassigned" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;
export type SegmentKey = (typeof SEGMENTS)[number]["key"];

export function isSegment(value: unknown): value is SegmentKey {
  return SEGMENTS.some((s) => s.key === value);
}

export function filterBySegment(
  matters: readonly Matter[],
  segment: SegmentKey,
  sets: { review: ReadonlySet<string>; stalled: ReadonlySet<string> },
): Matter[] {
  switch (segment) {
    case "all":
      return [...matters];
    case "open":
      return matters.filter(isOpenMatter);
    case "closed":
      return matters.filter((m) => !isOpenMatter(m));
    case "unassigned":
      return matters.filter((m) => isOpenMatter(m) && !m.assigned_to);
    case "review":
      return matters.filter((m) => sets.review.has(m.id));
    case "stalled":
      return matters.filter((m) => sets.stalled.has(m.id));
    default:
      return matters.filter((m) => isOpenMatter(m) && m.stage?.waiting_on === segment);
  }
}

/** "34d in stage", flagged when it is past the stage's threshold. */
export function stageAge(matter: Matter, now: Date = new Date()): { days: number | null; stale: boolean } {
  const days = daysInStage(matter.stage_entered_at, now);
  const stale =
    !!matter.stage && isOpenMatter(matter) &&
    matterIsStale({ stage_entered_at: matter.stage_entered_at, waiting_on: matter.stage.waiting_on }, now);
  return { days, stale };
}

/** Case-insensitive match on the fields a person would type. */
export function searchMatters(matters: readonly Matter[], q: string): Matter[] {
  const term = q.trim().toLowerCase();
  if (!term) return [...matters];
  return matters.filter((m) =>
    [m.matter_number, m.mark_text, m.title, m.owner_name, m.serial_number, m.registration_number]
      .some((v) => v?.toLowerCase().includes(term)),
  );
}
