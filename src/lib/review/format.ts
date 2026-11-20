import { addDays, daysBetween } from "./buckets";
import { formatDay } from "@/lib/ui/dates";
import { SENT_COULDNT_LOAD, SENT_KIND_CALL, SENT_KIND_EMAIL, SENT_NOTHING_YET, SENT_ON } from "@/lib/ui/words";
import { contactWords, type ContactKind } from "./contact";

/** "Oct 30" (with the year when it isn't this year). `date` and `today` are YYYY-MM-DD. Pure; the shared day formatter draws it. */
export function shortDate(date: string, today: string): string {
  // A civil date is never shifted by a zone; `today` only says which year is "this year".
  const now = new Date(`${today}T12:00:00Z`);
  return formatDay(date, { tz: "UTC", now: Number.isNaN(now.getTime()) ? undefined : now }) ?? date;
}

/** "Oct 30 · we emailed", or the fixed sentences for no contact / unknown. */
export function lastContactText(
  row: { contactKnown: boolean; lastContact: { date: string; type: ContactKind } | null },
  today: string,
): string {
  if (!row.contactKnown) return "Couldn't load";
  if (!row.lastContact) return "No contact recorded";
  return `${shortDate(row.lastContact.date, today)} · ${contactWords(row.lastContact.type)}`;
}

/** "Due Oct 30", "Overdue since Oct 28", "Due today" or "No date set". */
export function dueText(dueDate: string | null, today: string): { text: string; overdue: boolean } {
  if (!dueDate) return { text: "No date set", overdue: false };
  if (dueDate < today) return { text: `Overdue since ${shortDate(dueDate, today)}`, overdue: true };
  if (dueDate === today) return { text: "Due today", overdue: false };
  return { text: `Due ${shortDate(dueDate, today)}`, overdue: false };
}

/** A deadline in the next 30 days reads as soon. */
export function deadlineIsSoon(dueDate: string, today: string): boolean {
  const n = daysBetween(today, dueDate);
  return Number.isFinite(n) && n <= 30 && dueDate <= addDays(today, 30);
}

/** "RM" for "Rebecca Miller", "R" for one word, "?" for nothing. Pure. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** "Last followed up Nov 4 · 5 days" from the newest outbound contact; fixed sentences for none and for unreadable. */
export function followUpText(row: { contactKnown: boolean; lastOutbound?: string | null }, today: string): string {
  if (!row.contactKnown) return "Follow-up couldn't be loaded";
  if (!row.lastOutbound) return "No follow-up recorded";
  const n = daysBetween(row.lastOutbound, today);
  const ago = !Number.isFinite(n) || n < 0 ? "" : n === 0 ? " · today" : n === 1 ? " · 1 day" : ` · ${n} days`;
  return `Last followed up ${shortDate(row.lastOutbound, today)}${ago}`;
}

const SENT_WORD: Partial<Record<ContactKind, string>> = { email_sent: SENT_KIND_EMAIL, call_logged: SENT_KIND_CALL };

/**
 * The card's timeline line: the newest thing SENT OUT for the record (an email we sent or a call we logged), as
 * "Sent Nov 11 · email". `days` (the Waiting-on-client cards) adds how long ago: "Sent Nov 4 · email · 5 days".
 * Fixed sentences for nothing sent and for an unreadable history; never "nothing sent" for a failed read.
 */
export function sentText(
  row: { contactKnown: boolean; lastOutbound?: string | null; lastOutboundType?: ContactKind | null },
  today: string,
  opts: { days?: boolean } = {},
): string {
  if (!row.contactKnown) return SENT_COULDNT_LOAD;
  if (!row.lastOutbound) return SENT_NOTHING_YET;
  const word = row.lastOutboundType ? SENT_WORD[row.lastOutboundType] : undefined;
  let text = SENT_ON(shortDate(row.lastOutbound, today), word);
  if (opts.days) {
    const n = daysBetween(row.lastOutbound, today);
    if (Number.isFinite(n) && n >= 0) text += n === 0 ? " · today" : n === 1 ? " · 1 day" : ` · ${n} days`;
  }
  return text;
}

/** The quiet line under a card's name: "Lead · Acme Inc · Fold · Consult held". The company shows only when it is not the name. */
export function cardSubline(row: { kind: "lead" | "matter"; company?: string | null; mark: string | null; stageLabel: string | null }): string {
  return [row.kind === "lead" ? "Lead" : "Matter", row.company, row.mark, row.stageLabel].filter(Boolean).join(" · ");
}
