/**
 * Sprint 3: the editor header's "who made this" line, from `content.made_by` and `content.made_from`.
 * Pure. The line is staff-only: `publicContent` never returns either key.
 */

import { MADE_BY_ASSISTANT, MADE_WITH_COPILOT, madeByAssistantFrom } from "@/lib/proposal-editor/vocabulary";
import { formatShortFirmDate } from "@/lib/quotes/labels";
import type { ProposalContent } from "./types";

/** "Made by the assistant from the Nov 10 consult", "Made with Copilot", or null (a person, or nothing recorded). */
export function madeByLine(content: Pick<ProposalContent, "made_by" | "made_from"> | null | undefined): string | null {
  if (!content) return null;
  if (content.made_by === "copilot") return MADE_WITH_COPILOT;
  if (content.made_by !== "assistant") return null;
  const date = content.made_from?.consult_date;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const shown = formatShortFirmDate(`${date}T12:00:00Z`, "UTC");
    if (shown) return madeByAssistantFrom(shown);
  }
  return MADE_BY_ASSISTANT;
}
