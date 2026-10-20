"use client";

import { useActionState, useRef, useState } from "react";
import { logConsultOutcomeAction, type ConsultOutcomeState } from "@/app/dashboard/leads/[id]/outcome-actions";
import { CONSULT_OUTCOMES, CONSULT_OUTCOME_LABEL, type ConsultOutcome } from "@/lib/pipeline/consult-outcome-labels";

/**
 * "Log a consult outcome" on the lead page: no-show, asked to reschedule, or
 * rebooked after a no-show, with an optional note. It writes a timeline row and
 * tells the lead's owner and the intake team in the app. Nothing is sent to the
 * client.
 */
export function ConsultOutcomeForm({ leadId }: { leadId: string }) {
  const [outcome, setOutcome] = useState<ConsultOutcome | "">("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ConsultOutcomeState, FormData>(async (prev, fd) => {
    const res = await logConsultOutcomeAction(prev, fd);
    if (!res.error) {
      formRef.current?.reset();
      setOutcome("");
    }
    return res;
  }, {});

  return (
    <form ref={formRef} action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <div className="lx-label">Log a consult outcome</div>
      <div className="lx-segs" role="radiogroup" aria-label="Consult outcome">
        {CONSULT_OUTCOMES.map((value) => (
          <label key={value} className={outcome === value ? "on" : undefined}>
            <input
              type="radio"
              name="outcome"
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
              className="lx-sr"
            />
            {CONSULT_OUTCOME_LABEL[value]}
          </label>
        ))}
      </div>
      <textarea className="lx-input" name="note" rows={2} placeholder="Optional note: what you heard, when they might rebook." />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending || outcome === ""}>
          {pending ? "Saving…" : "Log outcome"}
        </button>
        <span className="lx-note">Tells the lead&apos;s owner and the intake team in the app. Nothing is sent to the client.</span>
      </div>
      {state.error && (
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="lx-note" style={{ margin: 0 }}>
          Logged on the timeline.
        </p>
      )}
    </form>
  );
}
