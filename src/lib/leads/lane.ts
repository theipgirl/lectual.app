/**
 * A lead's lane: a person's temperature call where one was made, otherwise
 * the triage agent's, read off ai_summary ("HOT — reason"). Pure.
 */
export type Lane = "hot" | "warm" | "cold";

export function laneOf(lead: { temperature: string | null; ai_summary: string | null }): Lane | null {
  if (lead.temperature === "hot" || lead.temperature === "warm" || lead.temperature === "cold") return lead.temperature;
  const m = lead.ai_summary?.match(/^(HOT|WARM|COLD)\b/);
  return m ? (m[1].toLowerCase() as Lane) : null;
}

/** The triage reason without its "HOT — " prefix. */
export function laneReason(aiSummary: string | null): string | null {
  return aiSummary?.replace(/^(HOT|WARM|COLD)\s*[—-]\s*/, "").trim() || null;
}
