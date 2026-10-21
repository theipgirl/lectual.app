import { greetingSuffix } from "@/lib/today/greeting-name";

export type PartOfDay = "morning" | "afternoon" | "evening";

/** The same 12 and 18 o'clock thresholds Today's heading uses (it keeps its copy private). */
export function partOfDay(hour: number): PartOfDay {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/** "Good morning, Taylor." or, with no usable first name, "Good morning." */
export function copilotGreeting(hour: number, firstName: string | null): string {
  return `Good ${partOfDay(hour)}${greetingSuffix(firstName)}.`;
}
