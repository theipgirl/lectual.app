import { deckWaiting } from "@/lib/ui/words";

export type ChipTone = "accent" | "warn" | "ok" | "crit" | "quiet";

/** "2 h", "1 day", "40 min": how long ago, for the Waiting lines. */
export function ageText(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "0 min";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export const waitingText = (iso: string, now: Date) => deckWaiting(ageText(iso, now));

/** Time of day for today, "Nov 9, 6:40 PM" for another day. */
export function queuedLabel(iso: string | null, now: Date, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = (x: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(x);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  if (day(d) === day(now)) return time;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
  return `${date}, ${time}`;
}

export type ListRow = { id: string; href: string; title: string; kind: string; to: string | null; from: string; queued: string; deal: string; statusLabel: string; statusTone: "plain" | "warn" | "ox" | "line" | "ok" | "risk"; waiting: string };
export type BoardCard = { id: string; href: string; kind: string; forName: string | null; badge: string; badgeTone: "plain" | "warn" | "ox" | "line" | "ok" | "risk"; title: string; sub: string };
