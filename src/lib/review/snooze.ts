import { addDays } from "./buckets";

/**
 * Snooze moves a next step's due DATE only. `today` is the firm's calendar date (YYYY-MM-DD), so the
 * answer never depends on the server's own zone. "Next Monday" from a Monday is a week on. Pure.
 */
export const SNOOZE_CHOICES = ["tomorrow", "monday", "two-weeks"] as const;
export type SnoozeChoice = (typeof SNOOZE_CHOICES)[number];

export const SNOOZE_LABEL: Record<SnoozeChoice, string> = {
  tomorrow: "Tomorrow",
  monday: "Next Monday",
  "two-weeks": "In 2 weeks",
};

export function isSnoozeChoice(value: unknown): value is SnoozeChoice {
  return typeof value === "string" && (SNOOZE_CHOICES as readonly string[]).includes(value);
}

function weekday(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return Number.NaN;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

export function snoozeDate(choice: SnoozeChoice, today: string): string {
  if (choice === "tomorrow") return addDays(today, 1);
  if (choice === "two-weeks") return addDays(today, 14);
  const dow = weekday(today);
  const ahead = ((8 - dow) % 7) || 7;
  return addDays(today, ahead);
}
