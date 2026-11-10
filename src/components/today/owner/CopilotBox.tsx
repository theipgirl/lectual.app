import { COPILOT_PATH } from "@/lib/today/owner-rules";
import { COPILOT_NAME, OWNER_COPILOT_BUTTON, OWNER_COPILOT_HEADING, OWNER_COPILOT_LABEL, OWNER_COPILOT_NOTE, OWNER_COPILOT_PLACEHOLDER } from "@/lib/ui/words";

/** A plain GET form to the Copilot page: it works without scripts and sends nothing but the typed question in the address. */
export function CopilotBox() {
  return (
    <section className="lx-card ot-card" aria-labelledby="ot-copilot-h">
      <h2 id="ot-copilot-h" className="lx-h2" style={{ fontSize: 25 }}>
        {OWNER_COPILOT_HEADING}
      </h2>
      <form action={COPILOT_PATH} method="get" className="ot-copilot" role="search" aria-label={COPILOT_NAME}>
        <input name="q" type="text" maxLength={500} autoComplete="off" aria-label={OWNER_COPILOT_LABEL} placeholder={OWNER_COPILOT_PLACEHOLDER} />
        <button type="submit" className="lx-btn lx-btn-pri">
          {OWNER_COPILOT_BUTTON}
        </button>
      </form>
      <p className="lx-note" style={{ margin: 0 }}>
        {OWNER_COPILOT_NOTE}
      </p>
    </section>
  );
}
