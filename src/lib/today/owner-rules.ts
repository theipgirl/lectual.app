import { civilDaysBetween } from "@/lib/matters/calendar-rows";
import { civilInZone } from "@/lib/today/outcomes";
import { deadlineKindLabel, deadlineNeedsReview } from "@/lib/matters/deadline-rules";
import type { UpcomingDeadline } from "@/lib/matters";
import type { ConsultItem } from "@/lib/calendar/consult-sources";
import type { DeckSummary } from "@/lib/queue/deck-summary";
import { ownerCardsCount, ownerCardsNextDeal, OWNER_CARDS_NONE_STATUS, OWNER_CARDS_NOT_CONNECTED, OWNER_CARDS_UNREACHABLE } from "@/lib/ui/words";

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

/* ── Deadlines ── */

export type OwnerDeadline = { key: string; href: string; name: string; detail: string; dueDate: string; overdueDays: number };

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
export type OwnerProposal = { id: string; href: string; client: string; title: string; expiry: string; expired: boolean; expiresOn: string | null };

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

export type WeekDay = { date: string; label: string; isToday: boolean; consults: number | null; deadlines: number | null };

export function addCivilDays(civil: string, n: number): string {
  return new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Seven days from today in firm time. A null source marks its count as unknown, never zero. */
export function weekStrip(input: { now: Date; tz: string; consults: readonly ConsultItem[] | null; deadlines: readonly OwnerDeadline[] | null }): WeekDay[] {
  const today = civilInZone(input.now, input.tz);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addCivilDays(today, i);
    const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
    return {
      date,
      label,
      isToday: i === 0,
      consults: input.consults ? input.consults.filter((c) => civilInZone(new Date(c.startsAt), input.tz) === date).length : null,
      // Overdue items belong to no day of the week; they are flagged in the deadlines card.
      deadlines: input.deadlines ? input.deadlines.filter((d) => d.dueDate === date).length : null,
    };
  });
}

/* ── Copilot ── */

/** The Copilot page takes no pre-filled question yet, so the box is a plain GET to the page with the text as `q`. */
export const COPILOT_PATH = "/dashboard/copilot/";
export function copilotHref(question: string): string {
  const q = question.trim().slice(0, 500);
  return q ? `${COPILOT_PATH}?q=${encodeURIComponent(q)}` : COPILOT_PATH;
}
