import type { AgentMoveChip as Chip } from "@/lib/stage-keeper/moves";
import { AgentIcon } from "./icons";

/**
 * "Moved by agent · LOE sent Oct 20": this lead was placed by the Stage Keeper in the last
 * 7 days and nobody has moved it since. The tooltip states the evidence (the email type and
 * date, or the calendar event and time). The icon is drawn and hidden from screen readers;
 * the sentence carries the meaning.
 *
 * Informational only: it moves nothing. Undo lives on the lead's timeline.
 */
export default function AgentMoveChip({ move }: { move: Chip | undefined }) {
  if (!move) return null;
  return (
    <span className="intake-agent-chip" title={move.tooltip} data-agent-move={move.activityId}>
      <AgentIcon size={11} />
      <span>{move.text}</span>
    </span>
  );
}
