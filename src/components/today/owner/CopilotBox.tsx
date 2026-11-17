import Link from "next/link";
import { chipClass } from "@/components/list-page/Chips";
import { COPILOT_PATH, copilotHref } from "@/lib/today/owner-rules";
import {
  COPILOT_NAME,
  OWNER_COPILOT_ASK_PLACEHOLDER,
  OWNER_COPILOT_BUTTON,
  OWNER_COPILOT_CHIPS,
  OWNER_COPILOT_HEADING,
  OWNER_COPILOT_LABEL,
  OWNER_COPILOT_PHONE_CHIPS,
  OWNER_COPILOT_PHONE_PLACEHOLDER,
} from "@/lib/ui/words";

/**
 * A plain GET form to the Copilot page, plus three suggested questions that are plain links to it: both work without
 * scripts and put only the question in the address. The page never sends a question by itself.
 */
export function CopilotBox() {
  return (
    <section className="lx-card ot-card ot-copilot-card" aria-labelledby="ot-copilot-h">
      <div className="ot-card-head">
        <h2 id="ot-copilot-h" className="lx-h3">
          {OWNER_COPILOT_HEADING}
        </h2>
      </div>
      <form action={COPILOT_PATH} method="get" className="ot-copilot" role="search" aria-label={COPILOT_NAME}>
        <input name="q" type="text" maxLength={500} autoComplete="off" aria-label={OWNER_COPILOT_LABEL} placeholder={OWNER_COPILOT_ASK_PLACEHOLDER} className="lx-input ot-only-wide-block" />
        <input name="q" type="text" maxLength={500} autoComplete="off" aria-label={OWNER_COPILOT_LABEL} placeholder={OWNER_COPILOT_PHONE_PLACEHOLDER} className="lx-input ot-only-narrow-block" />
        <button type="submit" className="lx-btn lx-btn-pri ot-btn">
          {OWNER_COPILOT_BUTTON}
        </button>
      </form>
      <div className="ot-chips ot-only-wide-block">
        {OWNER_COPILOT_CHIPS.map((q) => (
          <Link key={q} href={copilotHref(q)} prefetch={false} className={chipClass(false)}>
            {q}
          </Link>
        ))}
      </div>
      <div className="ot-chips ot-only-narrow-block">
        {OWNER_COPILOT_PHONE_CHIPS.map((c) => (
          <Link key={c.label} href={copilotHref(c.question)} prefetch={false} className={chipClass(false)}>
            {c.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
