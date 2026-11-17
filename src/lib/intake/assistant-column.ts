import type { IntakeRow } from "./rows";
import { LEADS_ASSISTANT_SUGGESTS_LTN, LEADS_ASSISTANT_SUGGESTS_LTN_TITLE } from "@/lib/ui/words";

/**
 * What the assistants did or suggest on a lead, for the "Assistant activity" column. PURE, from the row the page already
 * built: no new read. Two kinds, in this order:
 *   moved       the Stage Keeper placed the lead in the last 7 days and nobody has moved it since ("Moved automatically · LOE sent Oct 20");
 *   suggestion  the temperature rule suggests Long-Term Nurture (unbooked by day 10).
 * "Needs attorney" is NOT here: it is a person's to-do and sits with the stage markers. When the moves could not be read the row
 * carries no `agentMove`, so nothing is drawn for them (the page's own note says the read failed).
 */
export type AssistantItem = { kind: "moved" | "suggestion"; key: string; text: string; title: string };

export function assistantItems(row: Pick<IntakeRow, "agentMove" | "temperature">): AssistantItem[] {
  const out: AssistantItem[] = [];
  if (row.agentMove) out.push({ kind: "moved", key: row.agentMove.activityId, text: row.agentMove.text, title: row.agentMove.tooltip });
  if (row.temperature.suggestion === "long_term_nurture") {
    out.push({ kind: "suggestion", key: "suggest-ltn", text: LEADS_ASSISTANT_SUGGESTS_LTN, title: LEADS_ASSISTANT_SUGGESTS_LTN_TITLE });
  }
  return out;
}

/** The column is drawn only while at least one row in view has something for it. */
export function assistantColumnShown(rows: readonly Pick<IntakeRow, "agentMove" | "temperature">[]): boolean {
  return rows.some((row) => assistantItems(row).length > 0);
}
