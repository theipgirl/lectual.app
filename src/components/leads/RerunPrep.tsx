"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rerunConsultPrepAction } from "@/app/dashboard/leads/[id]/consult-prep-actions";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { CONSULT_PREP_RERUN, CONSULT_PREP_RERUN_CONFIRM } from "@/lib/ui/words";

/** "Re-run prep": asks first (InlineConfirm), then runs the server action, which re-checks the role. Shows the action's own sentence. */
export function RerunPrep({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 8 }}>
      <InlineConfirm
        label={CONSULT_PREP_RERUN}
        question={CONSULT_PREP_RERUN_CONFIRM}
        tone="primary"
        confirmLabel={CONSULT_PREP_RERUN}
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const result = await rerunConsultPrepAction(leadId);
            setMessage(result.message ?? null);
            if (result.ok) router.refresh();
          })
        }
      />
      {message && (
        <p className="lx-note" role="status" style={{ margin: "6px 0 0" }}>
          {message}
        </p>
      )}
    </div>
  );
}
