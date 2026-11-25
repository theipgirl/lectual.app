import type { QueueItem } from "@/lib/queue/api";
import { NEXT_UPDATE_LINE } from "./brief";

/**
 * Reusing a prep that already exists (S2a, pure; the clock and every read are passed in).
 *
 * A consult's prep may already have been drafted: by the prep-consult skill, by a person, or by this assistant earlier. It sits in
 * Approvals as a BRIEFING. Before a NEW prep is built for a consult (never for a person's re-run), the run looks there, and when it
 * finds a FULL one for that lead it ADOPTS it: no second briefing is queued, and every email of the prep carries THAT item's text.
 * The lead's files are not searched (this app never reads the contents of a PDF or Word file); see AGENTS.md.
 */

/** The agents whose BRIEFING can be adopted: the skill's and this assistant's own. */
export const ADOPT_AGENTS: readonly string[] = ["prep-consult", "consult-prep"];

const LINE_MAX = 100;
/** A heading line: short, so a sentence that merely mentions a word does not count as the section. */
const HEADING_PREFIX = /^[\s>#*_\-\d.)(:]*/;

const SECTIONS: ReadonlyArray<readonly RegExp[]> = [
  [/\blikely classes\b/i],
  [/\brisk read\b/i, /\bpreliminary risk\b/i],
  [/\bpackage recommendation\b/i],
];

/** The text of a queue item as it stands now: the approver's edit if there is one, else the draft. */
export const itemText = (item: Pick<QueueItem, "draft_body" | "final_body">): string => (item.final_body && item.final_body.trim() ? item.final_body : item.draft_body) ?? "";

/**
 * True when the text is a FULL prep: it has the class, risk and package sections. Headings are matched case-insensitively
 * ("Likely classes", "Risk read" or "Preliminary risk", "Package recommendation"). A heads-up or a facts-only brief is not full, and
 * Lectual's own S1 facts brief is never full (it says the classes come "in the next update").
 */
export function isFullBrief(text: string): boolean {
  if (!text || text.includes(NEXT_UPDATE_LINE)) return false;
  const lines = text.split(/\r?\n/).map((l) => l.replace(HEADING_PREFIX, "").trim()).filter((l) => l.length > 0 && l.length <= LINE_MAX);
  return SECTIONS.every((alternatives) => lines.some((line) => alternatives.some((re) => re.test(line))));
}

type Item = Pick<QueueItem, "id" | "agent" | "type" | "status" | "draft_body" | "final_body" | "created_at">;

/** The items worth resolving to a lead: right type, right agent, still in Approvals, recent enough, and full. */
export function adoptableItems<T extends Item>(items: readonly T[], sinceMs: number): T[] {
  return items.filter((i) => {
    if (i.type !== "BRIEFING" || !ADOPT_AGENTS.includes(i.agent)) return false;
    if (i.status !== "pending" && i.status !== "approved") return false;
    const at = Date.parse(i.created_at);
    if (!Number.isFinite(at) || at < sinceMs) return false;
    return isFullBrief(itemText(i));
  });
}

/** Item id -> the lead ids the queue's own linking rules found for it. */
export type ResolvedLeads = ReadonlyMap<string, { leadIds: readonly string[] }>;

/** The newest adoptable item linked to EXACTLY this one lead (an item that names two leads is nobody's). */
export function pickAdoption<T extends Item>(candidates: readonly T[], resolved: ResolvedLeads, leadId: string): T | null {
  const mine = candidates.filter((i) => {
    const r = resolved.get(i.id);
    return !!r && r.leadIds.length === 1 && r.leadIds[0] === leadId;
  });
  mine.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return mine[0] ?? null;
}

/** A prep that adopted an item on an earlier run: that item, if it is still in Approvals (pending or approved) and still a full brief. */
export function stillAdoptable<T extends Item>(items: readonly T[], itemId: string): T | null {
  const hit = items.find((i) => i.id === itemId);
  if (!hit || hit.type !== "BRIEFING" || !ADOPT_AGENTS.includes(hit.agent)) return null;
  if (hit.status !== "pending" && hit.status !== "approved") return null;
  return isFullBrief(itemText(hit)) ? hit : null;
}

/** The instant the firm's calendar day containing `nowMs` began, in its zone. */
export function startOfFirmDayMs(nowMs: number, tz: string): number {
  const parts = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return { y: n("year"), m: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
  };
  const t = parts(nowMs);
  // Wall-clock midnight of that civil day, as if it were UTC, then corrected by the zone's offset at that moment (twice, for a DST change).
  const wallUtc = Date.UTC(t.y, t.m - 1, t.d, 0, 0, 0);
  let guess = wallUtc;
  for (let i = 0; i < 3; i += 1) {
    const g = parts(guess);
    const asUtc = Date.UTC(g.y, g.m - 1, g.d, g.h, g.mi, g.s);
    guess += wallUtc - asUtc;
  }
  return guess;
}

/**
 * Items created at or after this instant count: the consult's booking, or the start of the firm's day today, whichever is EARLIER
 * ("since the booking, or the same day"). With no booking time known, the day's start.
 */
export function adoptionSinceMs(bookedAt: string | null | undefined, nowMs: number, tz: string): number {
  const day = startOfFirmDayMs(nowMs, tz);
  const booked = bookedAt ? Date.parse(bookedAt) : NaN;
  return Number.isFinite(booked) ? Math.min(booked, day) : day;
}
