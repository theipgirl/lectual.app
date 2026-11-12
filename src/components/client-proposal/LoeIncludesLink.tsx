"use client";

import { SEE_INCLUDES_LINK } from "@/lib/loe/client-words";

/**
 * A link back to "what the package includes" for the later steps. On step 1 (and on a receipt, which shows the first step's
 * cards) the table is on the page, so the anchor works as a plain link; from steps 2 and 3 the page first returns to step 1.
 */
export function LoeIncludesLink({ onBackToStepOne }: { onBackToStepOne?: () => void }) {
  return (
    <p className="cp-back-includes">
      <a
        href="#cp-h-inc"
        onClick={(e) => {
          if (!onBackToStepOne) return;
          e.preventDefault();
          onBackToStepOne();
          requestAnimationFrame(() => document.getElementById("cp-h-inc")?.scrollIntoView({ block: "start" }));
        }}
      >
        {SEE_INCLUDES_LINK}
      </a>
    </p>
  );
}
