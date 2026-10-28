/**
 * A time zone as a person says it: "Eastern time", not "America/New York". Pure. The common US
 * zones get their usual names; any other zone is named by its city ("London time").
 */
const US: Record<string, string> = {
  "America/New_York": "Eastern time",
  "America/Detroit": "Eastern time",
  "America/Chicago": "Central time",
  "America/Denver": "Mountain time",
  "America/Phoenix": "Arizona time",
  "America/Los_Angeles": "Pacific time",
  "America/Anchorage": "Alaska time",
  "Pacific/Honolulu": "Hawaii time",
};

export function zoneLabel(timeZone: string): string {
  if (US[timeZone]) return US[timeZone];
  const city = timeZone.split("/").pop()?.replaceAll("_", " ").trim();
  return city ? `${city} time` : "your firm's time zone";
}

/** "Previous month" / "Next week": what the calendar's arrows move by. */
export function stepLabel(direction: "previous" | "next", view: string): string {
  const unit = view === "month" || view === "week" || view === "day" ? view : "period";
  return `${direction === "previous" ? "Previous" : "Next"} ${unit}`;
}
