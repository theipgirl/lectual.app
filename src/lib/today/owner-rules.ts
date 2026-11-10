import { civilDaysBetween } from "@/lib/matters/calendar-rows";
import { civilInZone } from "@/lib/today/outcomes";
import { deadlineKindLabel, deadlineNeedsReview } from "@/lib/matters/deadline-rules";
import type { UpcomingDeadline } from "@/lib/matters";
import type { ConsultItem } from "@/lib/calendar/consult-sources";
import type { DeckSummary } from "@/lib/queue/deck-summary";
import {
  ownerCardsAbout,
  ownerCardsCount,
  ownerCardsNextDeal,
  ownerCardsWord,
  ownerDayChip,
  ownerDealLine,
  OWNER_CARDS_FOR_YOU,
  OWNER_CARDS_NONE_STATUS,
  OWNER_CARDS_NOT_CONNECTED,
  OWNER_CARDS_UNREACHABLE,
  OWNER_WEEK_DUE,
  OWNER_WEEK_LAST_DAY,
} from "@/lib/ui/words";

/** Pure rules for the owner's Today. No reads here; every source arrives already three-state. */

export const OWNER_DEADLINE_DAYS = 14;
export const OWNER_PROPOSALS_SHOWN = 6;
export const OWNER_DEADLINES_SHOWN = 6;

/* ── Your cards ── */

export type CardsLine = { state: "ok" | "unconfigured" | "unavailable"; headline: string; sub: string | null; canStart: boolean };

/** Never a number for a failed read. "All decided" only when the queue was reached and held nothing for her. */
export function cardsLine(summary: DeckSummary): CardsLine {
  if (summary.status === "unavailable") return { state: "unavailable", headline: OWNER_CARDS_UNREACHABLE, sub: null, canStart: false };
  if (summary.status === "unconfigured") return { state: "unconfigured", headline: OWNER_CARDS_NOT_CONNECTED, sub: null, canStart: false };
  const next = ownerCardsNextDeal(summary.count, summary.nextDealLabel, summary.laterArrivals);
  if (summary.count === 0) return { state: "ok", headline: next, sub: null, canStart: false };
  return { state: "ok", headline: ownerCardsCount(summary.count, summary.minutes), sub: next, canStart: true };
}
export { OWNER_CARDS_NONE_STATUS };

/** The hero's parts. `big` is null unless the queue was read and holds cards for her: a failed read never draws a number. */
export type CardsHero = {
  state: CardsLine["state"];
  big: string | null;
  /** "cards for you" (desktop) and the phone's "cards" + minutes. */
  unit: string;
  cards: string;
  about: string;
  /** The line when there is no number to show: all decided, couldn't load, not connected. */
  message: string | null;
  dealLine: string | null;
  canStart: boolean;
};

export function cardsHero(summary: DeckSummary): CardsHero {
  const line = cardsLine(summary);
  const none = { big: null, unit: "", cards: "", about: "", dealLine: null };
  if (summary.status !== "ok") return { state: line.state, ...none, message: line.headline, canStart: false };
  const dealLine = ownerDealLine(summary.dealLabel, summary.nextDealLabel, summary.laterArrivals);
  if (summary.count === 0) return { state: "ok", ...none, message: line.headline, canStart: false };
  return {
    state: "ok",
    big: String(summary.count),
    unit: `${ownerCardsWord(summary.count)} ${OWNER_CARDS_FOR_YOU}`,
    cards: ownerCardsWord(summary.count),
    about: ownerCardsAbout(summary.minutes),
    message: null,
    dealLine,
    canStart: true,
  };
}

/* ── Deadlines ── */

export type OwnerDeadline = { key: string; href: string; name: string; detail: string; dueDate: string; overdueDays: number };

export type Tone = "risk" | "warn" | "plain";

/** Pill for a day count: within 5 days (or overdue) is risk, within 10 is warn. */
export function dayTone(days: number): Tone {
  return days <= 5 ? "risk" : days <= 10 ? "warn" : "plain";
}

/** "Fri Nov 14" for a civil date. */
export function weekdayDate(civil: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${civil}T12:00:00Z`));
}

export function deadlineChip(d: Pick<OwnerDeadline, "dueDate" | "overdueDays">, today: string): { text: string; tone: Tone } {
  const days = d.overdueDays > 0 ? -d.overdueDays : civilDaysBetween(today, d.dueDate);
  return { text: ownerDayChip(days), tone: dayTone(days) };
}

/** Open deadlines due within 14 days, overdue ones included and flagged. A stale unconfirmed phantom is left out, as on Today. */
export function ownerDeadlines(deadlines: readonly UpcomingDeadline[], now: Date, tz: string): OwnerDeadline[] {
  const today = civilInZone(now, tz);
  return deadlines
    .filter((d) => !deadlineNeedsReview(d, today))
    .filter((d) => civilDaysBetween(today, d.due_date) <= OWNER_DEADLINE_DAYS)
    .map((d) => ({
      key: d.id,
      href: `/dashboard/matters/${d.matter_id}/`,
      name: d.title ?? deadlineKindLabel(d.kind),
      detail: [d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket",
      dueDate: d.due_date,
      overdueDays: Math.max(0, civilDaysBetween(d.due_date, today)),
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function dueText(d: Pick<OwnerDeadline, "dueDate" | "overdueDays">, today: string): string {
  if (d.overdueDays > 0) return d.overdueDays === 1 ? "1 day overdue" : `${d.overdueDays} days overdue`;
  const days = civilDaysBetween(today, d.dueDate);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/* ── Proposals out ── */

export type ProposalIn = { id: string; family_id: string; client_name: string; title: string; status: string; expires_on: string | null; matter_title?: string | null; brands?: string[] };
export type OwnerProposal = {
  id: string;
  href: string;
  client: string;
  title: string;
  expiry: string;
  expired: boolean;
  expiresOn: string | null;
  /** Times the client opened the live link; "unavailable" when that read failed; absent when not read. Never a guess. */
  opens?: number | "unavailable";
};

/** Pill tone for a proposal's last day: expired or within 3 days is risk, within 7 warn. No last day set is plain. */
export function proposalTone(p: Pick<OwnerProposal, "expired" | "expiresOn">, today: string): Tone {
  if (p.expired) return "risk";
  if (!p.expiresOn) return "plain";
  const days = civilDaysBetween(today, p.expiresOn);
  return days <= 3 ? "risk" : days <= 7 ? "warn" : "plain";
}

/** Live proposals: the newest version of a family, and only while its link is live (`sent`). Soonest last day first, expired first of all. */
export function proposalsOut(items: readonly ProposalIn[], today: string): OwnerProposal[] {
  return items
    .filter((p) => p.status === "sent")
    .map((p) => {
      const expired = !!p.expires_on && p.expires_on < today;
      const expiry = !p.expires_on ? "No last day set" : p.expires_on === today ? "Last day today" : expired ? `Expired ${shortDay(p.expires_on)}` : `Last day ${shortDay(p.expires_on)}`;
      return {
        id: p.id,
        href: `/dashboard/proposals/${p.id}/`,
        client: p.client_name || "Client",
        title: p.matter_title || p.brands?.join(", ") || p.title,
        expiry,
        expired,
        expiresOn: p.expires_on,
      };
    })
    .sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31"));
}

function shortDay(civil: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${civil}T12:00:00Z`));
}

/* ── Week strip ── */

export type WeekItem = { kind: "consult" | "deadline"; lead: string; text: string };
export type WeekDay = {
  date: string;
  label: string;
  weekday: string;
  num: string;
  isToday: boolean;
  consults: number | null;
  deadlines: number | null;
  items: WeekItem[];
};

export function addCivilDays(civil: string, n: number): string {
  return new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function clock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * Seven days from today in firm time. A null source marks its count as unknown, never zero. Proposals' last days (when the
 * firm has the feature and the read worked) are listed as deadline-coloured items; they do not change the deadline counts.
 */
export function weekStrip(input: {
  now: Date;
  tz: string;
  consults: readonly ConsultItem[] | null;
  deadlines: readonly OwnerDeadline[] | null;
  proposals?: readonly OwnerProposal[] | null;
}): WeekDay[] {
  const today = civilInZone(input.now, input.tz);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addCivilDays(today, i);
    const at = new Date(`${date}T12:00:00Z`);
    const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(at);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(at);
    const dayConsults = input.consults ? input.consults.filter((c) => civilInZone(new Date(c.startsAt), input.tz) === date) : null;
    // Overdue items belong to no day of the week; they are flagged in the deadlines card.
    const dayDeadlines = input.deadlines ? input.deadlines.filter((d) => d.dueDate === date) : null;
    const dayProposals = (input.proposals ?? []).filter((p) => p.expiresOn === date && !p.expired);
    const items: WeekItem[] = [
      ...(dayConsults ?? []).map((c): WeekItem => ({ kind: "consult", lead: c.allDay ? "All day" : clock(c.startsAt, input.tz), text: c.title })),
      ...(dayDeadlines ?? []).map((d): WeekItem => ({ kind: "deadline", lead: OWNER_WEEK_DUE, text: `${d.name} \u00b7 ${d.detail}` })),
      ...dayProposals.map((p): WeekItem => ({ kind: "deadline", lead: OWNER_WEEK_LAST_DAY, text: `Proposal \u00b7 ${p.client}` })),
    ];
    return { date, label, weekday, num: String(Number(date.slice(8))), isToday: i === 0, consults: dayConsults ? dayConsults.length : null, deadlines: dayDeadlines ? dayDeadlines.length : null, items };
  });
}

/* ── Copilot ── */

/** The Copilot page takes no pre-filled question yet, so the box is a plain GET to the page with the text as `q`. */
export const COPILOT_PATH = "/dashboard/copilot/";
export function copilotHref(question: string): string {
  const q = question.trim().slice(0, 500);
  return q ? `${COPILOT_PATH}?q=${encodeURIComponent(q)}` : COPILOT_PATH;
}
