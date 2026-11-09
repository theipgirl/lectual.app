import { addDays, daysBetween } from "./buckets";
import { contactWords, type ContactType } from "./contact";

/** "Oct 30" (with the year when it isn't this year). `date` and `today` are YYYY-MM-DD. Pure. */
export function shortDate(date: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${names[Number(m[2]) - 1]} ${Number(m[3])}`;
  return m[1] === today.slice(0, 4) ? label : `${label}, ${m[1]}`;
}

/** "Oct 30 · we emailed", or the fixed sentences for no contact / unknown. */
export function lastContactText(
  row: { contactKnown: boolean; lastContact: { date: string; type: ContactType } | null },
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
