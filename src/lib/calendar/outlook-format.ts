/** "Thu, Oct 22, 2:00 PM" in the firm's zone; an all-day event shows its date only (it is stored at UTC midnight). */
export function formatEventWhen(event: { starts_at: string; all_day: boolean | null }, timeZone: string): string {
  if (event.all_day) {
    return new Date(event.starts_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  return new Date(event.starts_at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/** The meeting link, only when it is an https URL (the column's own check says the same). */
export function joinHref(url: string | null | undefined): string | null {
  return url && url.startsWith("https://") ? url : null;
}
