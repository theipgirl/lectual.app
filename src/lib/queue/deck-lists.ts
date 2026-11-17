import type { QueueItem } from "@/lib/queue/api";
import { currentHolder, decidedToday, laterUntil, type CardEvent, type CardState } from "@/lib/queue/deck";
import { mineItems } from "@/lib/queue/mine";
import { canApproveItem, classifyQueueItem, type ApprovalRouting, type Viewer } from "@/lib/queue/routing";
import { sameFirmDay } from "@/lib/deal/times";
import {
  DECK_CHIP_APPROVED,
  DECK_CHIP_REJECTED,
  DECK_LIST_BACK_WITH_YOU,
  DECK_LIST_TAIL_CLIENT_EMAIL,
  DECK_LIST_TAIL_INTERNAL,
  DECK_LIST_TAIL_NOTE_KEPT,
  deckLaterOtherDay,
  deckLaterTomorrow,
  deckListDecidedSub,
  deckListHandedTo,
  deckListQuote,
  deckListSentBack,
  deckListWith,
} from "@/lib/ui/words";

/**
 * The Decided / Handed off / Later lists of the approval deck. Pure: the items, the card events, the viewer, the clock and
 * the name lookup come in. A source that could not be read is its own state (`ListSource`), never an empty list.
 */

export type ListSource<T> = { status: "ok"; rows: T[] } | { status: "not-set-up" } | { status: "not-connected" } | { status: "unavailable" };

/** What a chip shows: the count, or a dash for any source that was not read. Never 0 for a failure. */
export const sourceCount = (s: ListSource<unknown>): string => (s.status === "ok" ? String(s.rows.length) : "—");

/** The deck appends "Receipt: sha256 <12 hex>" to an approval note. A person never sees it. */
const RECEIPT_LINE = /^\s*Receipt:\s*sha256\s+[0-9a-f]{6,64}\s*$/i;

/** The note a person wrote, with the receipt line (and any inline copy of it) removed. */
export function stripReceipt(note: string | null | undefined): string {
  if (!note) return "";
  return note
    .split(/\r?\n/)
    .filter((l) => !RECEIPT_LINE.test(l))
    .map((l) => l.replace(/\s*Receipt:\s*sha256\s+[0-9a-f]{6,64}\b/gi, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

const NOTE_MAX = 140;
function clip(s: string): string {
  return s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1).trimEnd()}…` : s;
}

export type ListFormat = {
  /** "7:12 AM" */
  time: (iso: string) => string;
  /** "Nov 7" */
  day: (iso: string) => string;
  /** The same firm day as now. */
  isToday: (iso: string) => boolean;
};

export type DecidedRow = { id: string; href: string; title: string; sub: string; pill: string; tone: "ok" | "crit" };
export type HandedRow = { id: string; href: string; title: string; sub: string; pill: string; tone: "line" | "warn"; back: boolean };
export type LaterRow = { id: string; href: string; title: string; kind: string; pill: string };

const itemHref = (id: string) => `/dashboard/queue/${encodeURIComponent(id)}/`;

/**
 * Items this person resolved today (matched on the session address, which is what the queue records in `resolved_by`),
 * newest first. An approved client email says only that it was a client email: nothing stored proves a draft was made, so no Outlook claim and no link.
 */
export function decidedRows(items: readonly QueueItem[], email: string | null, fmt: ListFormat): DecidedRow[] {
  return decidedToday(items, email, (d) => fmt.isToday(d.toISOString())).map((i) => {
    const at = i.resolved_at ?? "";
    if (i.status === "approved") {
      const tail = classifyQueueItem(i) === "internal_briefing" ? DECK_LIST_TAIL_INTERNAL : i.type === "CLIENT_EMAIL" ? DECK_LIST_TAIL_CLIENT_EMAIL : null;
      return { id: i.id, href: itemHref(i.id), title: i.headline, sub: deckListDecidedSub("Approved", fmt.time(at), tail), pill: DECK_CHIP_APPROVED, tone: "ok" };
    }
    const note = clip(stripReceipt(i.resolution_note));
    return { id: i.id, href: itemHref(i.id), title: i.headline, sub: deckListDecidedSub("Rejected", fmt.time(at), note ? deckListQuote(note) : DECK_LIST_TAIL_NOTE_KEPT), pill: DECK_CHIP_REJECTED, tone: "crit" };
  });
}

function lastHandoffBy(events: readonly CardEvent[], itemId: string, viewerId: string): CardEvent | null {
  let found: CardEvent | null = null;
  for (const e of events) if (e.queueItemId === itemId && e.kind === "handoff" && e.actorId === viewerId && e.targetUserId) found = e;
  return found;
}

/**
 * The viewer's hand-offs on pending items: still with the colleague ("With <name>"), or sent back after the viewer's own
 * hand-off ("Back with you"). Events are oldest first, as `loadCardState` returns them. A hand-off a colleague made on to
 * someone else is not the viewer's.
 */
export function handedRows(pending: readonly QueueItem[], events: readonly CardEvent[], viewerId: string, firstNameOf: (userId: string) => string, fmt: ListFormat, decidable: ReadonlySet<string>): HandedRow[] {
  const out: Array<HandedRow & { at: string }> = [];
  for (const item of pending) {
    if (item.status !== "pending") continue;
    const holder = currentHolder(events, item.id);
    if (holder) {
      if (holder.by !== viewerId) continue;
      const first = firstNameOf(holder.userId);
      const note = clip(stripReceipt(holder.note));
      out.push({
        id: item.id,
        href: itemHref(item.id),
        title: item.headline,
        sub: deckListHandedTo(first, fmt.isToday(holder.at) ? fmt.time(holder.at) : fmt.day(holder.at), note || null),
        pill: deckListWith(first),
        tone: "line",
        back: false,
        at: holder.at,
      });
      continue;
    }
    const mine = lastHandoffBy(events, item.id, viewerId);
    if (!mine) continue;
    let ret: CardEvent | null = null;
    for (const e of events) if (e.queueItemId === item.id && e.kind === "returned" && e.createdAt >= mine.createdAt) ret = e;
    if (!ret) continue;
    // Back with the usual approvers: only this viewer's own to decide. After a later re-hand-off it is someone else's.
    if (!decidable.has(item.id)) continue;
    out.push({
      id: item.id,
      href: itemHref(item.id),
      title: item.headline,
      sub: deckListSentBack(firstNameOf(mine.targetUserId as string), fmt.day(mine.createdAt), fmt.time(ret.createdAt)),
      pill: DECK_LIST_BACK_WITH_YOU,
      tone: "warn",
      back: true,
      at: ret.createdAt,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).map(dropKey("at"));
}

/** A copy of a row without its sort key. */
function dropKey<K extends string>(key: K) {
  return <T extends Record<K, unknown>>(row: T): Omit<T, K> => {
    const copy: Record<string, unknown> = { ...row };
    delete copy[key];
    return copy as Omit<T, K>;
  };
}

/** The viewer's own Later cards still in force. An expired Later is back on the deck, so it is not listed. */
export function laterRows(pending: readonly QueueItem[], events: readonly CardEvent[], viewerId: string, now: Date, decidable: ReadonlySet<string>, kindOf: (i: QueueItem) => string, backLabel: (untilIso: string) => string): LaterRow[] {
  const out: Array<LaterRow & { until: string }> = [];
  for (const item of pending) {
    if (item.status !== "pending") continue;
    const until = laterUntil(events, item.id, viewerId, now);
    if (!until) continue;
    // Exactly the cards the deck's own Later counts: the viewer's to decide, or handed to the viewer. A card now with a
    // colleague is on the Handed off list, not here.
    const holder = currentHolder(events, item.id);
    if (holder ? holder.userId !== viewerId : !decidable.has(item.id)) continue;
    out.push({ id: item.id, href: itemHref(item.id), title: item.headline, kind: kindOf(item), pill: backLabel(until), until });
  }
  return out.sort((a, b) => a.until.localeCompare(b.until) || a.id.localeCompare(b.id)).map(dropKey("until"));
}

/** The pill of a Later row: "2:00 PM" today, "Tomorrow 7:00 AM" the next day, else "Nov 14 7:00 AM". Time only, no sentence. */
export function laterTimePill(time: string, dayDiff: number, day: string): string {
  return dayDiff === 0 ? time : dayDiff === 1 ? deckLaterTomorrow(time) : deckLaterOtherDay(day, time);
}

/** Handed off and Later come from the card events and the pending list; either failing makes them unavailable. */
export function eventSources(args: { pendingStatus: string; cardState: CardState | null; handed: () => HandedRow[]; later: () => LaterRow[] }): { handed: ListSource<HandedRow>; later: ListSource<LaterRow> } {
  let bad: { status: "not-set-up" } | { status: "not-connected" } | { status: "unavailable" } | null = null;
  if (args.pendingStatus === "unconfigured") bad = { status: "not-connected" };
  else if (args.pendingStatus !== "ok" || !args.cardState || args.cardState.status === "unavailable") bad = { status: "unavailable" };
  else if (args.cardState.status === "not-set-up") bad = { status: "not-set-up" };
  if (bad) return { handed: bad, later: bad };
  return { handed: { status: "ok", rows: args.handed() }, later: { status: "ok", rows: args.later() } };
}

/** Decided needs both resolved lists; either failing is unavailable, never a shorter list. */
export function decidedSource(approved: { status: string; items?: QueueItem[] }, rejected: { status: string; items?: QueueItem[] }, email: string | null, fmt: ListFormat): ListSource<DecidedRow> {
  if (approved.status === "unconfigured" || rejected.status === "unconfigured") return { status: "not-connected" };
  if (approved.status !== "ok" || rejected.status !== "ok") return { status: "unavailable" };
  return { status: "ok", rows: decidedRows([...(approved.items ?? []), ...(rejected.items ?? [])], email, fmt) };
}

/**
 * The viewer's own approvals to decide: the same filter `buildDeck` uses (`mineItems`, then `canApproveItem`), so the lists
 * and the deck count the same cards.
 */
export function decidableIds(pending: readonly QueueItem[], routing: ApprovalRouting, viewer: Viewer): Set<string> {
  const open = pending.filter((i) => i.status === "pending");
  const mine = new Set(mineItems(open, routing, viewer).map((i) => i.id));
  return new Set(open.filter((i) => mine.has(i.id) && canApproveItem({ role: viewer.role, userId: viewer.userId, item: i, routing })).map((i) => i.id));
}

export type ListParam = "decided" | "handed" | "later" | "need";
export function parseListParam(raw: string | string[] | undefined): ListParam | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "decided" || v === "handed" || v === "later" || v === "need" ? v : null;
}
export const listHref = (l: ListParam) => `/dashboard/queue/deck/?list=${l}`;

/** The firm's clock for the lists: time of day, short date, and "same firm day as now". */
export function makeListFormat(now: Date, tz: string): ListFormat {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const ok = (iso: string) => !Number.isNaN(new Date(iso).getTime());
  return {
    time: (iso) => (ok(iso) ? time.format(new Date(iso)) : "—"),
    day: (iso) => (ok(iso) ? day.format(new Date(iso)) : "—"),
    isToday: (iso) => ok(iso) && sameFirmDay(new Date(iso), now, tz),
  };
}

/** Where a Later card comes back, in the firm's clock. */
export function laterBackPill(untilIso: string, now: Date, tz: string): string {
  const at = new Date(untilIso);
  const fmt = makeListFormat(now, tz);
  const dayNumber = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) / 86_400_000;
  };
  return laterTimePill(fmt.time(untilIso), dayNumber(at) - dayNumber(now), fmt.day(untilIso));
}
