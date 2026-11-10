import Link from "next/link";
import { COPILOT_PATH, copilotHref } from "@/lib/today/owner-rules";
import {
  COPILOT_NAME,
  OWNER_COPILOT_ASK_PLACEHOLDER,
  OWNER_COPILOT_BUTTON,
  OWNER_COPILOT_CHIPS,
  OWNER_COPILOT_HEADING,
  OWNER_COPILOT_LABEL,
  OWNER_COPILOT_SUB,
  OWNER_COPILOT_SUB_SHORT,
} from "@/lib/ui/words";

/**
 * A plain GET form to the Copilot page, plus three suggested questions that are plain links to it: both work without
 * scripts and put only the question in the address. The page never sends a question by itself.
 */
export function CopilotBox() {
  return (
    <section className="ot-card ot-copilot-card" aria-labelledby="ot-copilot-h">
      <div className="ot-card-head">
        <h2 id="ot-copilot-h" className="ot-card-title">
          {OWNER_COPILOT_HEADING}
        </h2>
        <span className="ot-sub ot-only-wide">{OWNER_COPILOT_SUB}</span>
        <span className="ot-sub ot-only-narrow">{OWNER_COPILOT_SUB_SHORT}</span>
      </div>
      <form action={COPILOT_PATH} method="get" className="ot-copilot" role="search" aria-label={COPILOT_NAME}>
        <input name="q" type="text" maxLength={500} autoComplete="off" aria-label={OWNER_COPILOT_LABEL} placeholder={OWNER_COPILOT_ASK_PLACEHOLDER} />
        <button type="submit" className="ot-btn">
          {OWNER_COPILOT_BUTTON}
        </button>
      </form>
      <div className="ot-chips">
        {OWNER_COPILOT_CHIPS.map((q) => (
          <Link key={q} href={copilotHref(q)} prefetch={false} className="ot-chip">
            {q}
          </Link>
        ))}
      </div>
    </section>
  );
}
