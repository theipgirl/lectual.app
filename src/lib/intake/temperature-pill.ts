import { LANE_LABEL } from "@/lib/leads/lane";
import { temperatureTitle, type EffectiveTemperature } from "./effective-temperature";

/**
 * The ONE temperature pill (Leads list and board). PURE.
 *   a level a person set      the filled pill: "Hot" / "Warm" / "Cold"
 *   a level the system suggests  the same pill, lighter; "suggested" is in the title and the accessible name
 *   no level                  nothing at all
 */
export type TemperaturePill = { text: string; tone: "hot" | "warm" | "cold"; suggested: boolean; title: string; ariaLabel: string };

export function temperaturePill(t: EffectiveTemperature): TemperaturePill | null {
  if (t.value === null) return null;
  const text = LANE_LABEL[t.value];
  const suggested = t.source !== "person";
  const why = temperatureTitle(t);
  return {
    text,
    tone: t.value,
    suggested,
    title: suggested ? `Suggested: ${text}\n${why}` : why,
    ariaLabel: suggested ? `${text}, suggested` : text,
  };
}
