import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { formatRelative } from "@/lib/ui/dates";

/** "just now", "3 min ago", "2 h ago", "4 days ago", else a short date ("Nov 16"). Callers that know the firm's zone pass it. */
export function relativeTime(iso: string | null, now = Date.now(), tz: string = DEFAULT_TIME_ZONE): string {
  if (!iso) return "never";
  return formatRelative(iso, { tz, now: new Date(now) }) ?? "never";
}
