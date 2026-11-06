"use client";

import { useActionState, useState } from "react";
import { closeLeadAction, type ReviewActionState } from "@/app/dashboard/review/actions";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { CLOSE_REASON_MAX } from "@/lib/review/input";
import type { CloseStage } from "@/lib/review/close-stage";
import "./review.css";

/** Lost / Nurture for one lead: pick a stage, add an optional reason, confirm. The action re-checks everything. */
export function LostNurture({ id, stages }: { id: string; stages: CloseStage[] }) {
  const [open, setOpen] = useState(false);
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(async (prev, fd) => closeLeadAction(prev, fd), {});
  if (stages.length === 0) return null;
  const chosen = stages.find((s) => s.id === stageId) ?? stages[0];
  const send = () => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("stageId", chosen.id);
    fd.set("reason", reason);
    void action(fd);
  };
  return (
    <div className="rv-form">
      {!open ? (
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(true)}>
          Lost / Nurture
        </button>
      ) : (
        <>
          <select className="lx-input" aria-label="Move this lead to" value={chosen.id} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input className="lx-input" aria-label="Reason (optional)" placeholder="Reason (optional)" maxLength={CLOSE_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
          <InlineConfirm label="Move lead" question={`Move this lead to ${chosen.name}?`} confirmLabel="Move" pending={pending} onConfirm={send} />
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </>
      )}
      {state.error && (
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
