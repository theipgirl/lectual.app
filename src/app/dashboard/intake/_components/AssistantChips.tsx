import type { IntakeRow } from "@/lib/intake/rows";
import { assistantItems } from "@/lib/intake/assistant-column";
import AgentMoveChip from "./AgentMoveChip";

/**
 * What the assistants did or suggest on one lead: the "Moved automatically" chip and the Long-Term Nurture suggestion, in the
 * assistants' own colour (never the oxblood of a person's pills). The Assistant activity column holds these on the list and the
 * board card shows them in its chip row. Informational only: it moves nothing. Renders nothing when there is nothing to say.
 */
export default function AssistantChips({ row }: { row: Pick<IntakeRow, "agentMove" | "temperature"> }) {
  const items = assistantItems(row);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) =>
        item.kind === "moved" && row.agentMove ? (
          <AgentMoveChip key={item.key} move={row.agentMove} />
        ) : (
          <span key={item.key} className="intake-agent-chip ix-asst-suggest" title={item.title} data-assistant-suggestion>
            <span>{item.text}</span>
          </span>
        ),
      )}
    </>
  );
}
