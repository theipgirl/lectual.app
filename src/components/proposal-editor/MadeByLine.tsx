import { madeByLine } from "@/lib/proposals/made-by";
import type { ProposalContent } from "@/lib/proposals/types";

/** The header's "who made this" line. Draws nothing for a person's own draft or an older proposal. */
export function MadeByLine({ content }: { content: Pick<ProposalContent, "made_by" | "made_from"> }) {
  const line = madeByLine(content);
  if (!line) return null;
  return (
    <span className="lx-note" data-made-by>
      {line}
    </span>
  );
}
