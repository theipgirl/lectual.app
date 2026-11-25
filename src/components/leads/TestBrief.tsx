"use client";

import { useState, useTransition } from "react";
import { sendTestBriefAction } from "@/app/dashboard/leads/[id]/consult-prep-actions";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { CONSULT_PREP_TEST_BUTTON, CONSULT_PREP_TEST_CONFIRM } from "@/lib/ui/words";

/** S2c: "Send a test brief" (owner only): asks first, then runs the server action, which re-checks the owner. Shows the action's own sentence. */
export function TestBrief({ leadId }: { leadId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 8 }}>
      <InlineConfirm
        label={CONSULT_PREP_TEST_BUTTON}
        question={CONSULT_PREP_TEST_CONFIRM}
        tone="primary"
        confirmLabel={CONSULT_PREP_TEST_BUTTON}
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const result = await sendTestBriefAction(leadId);
            setMessage(result.message ?? null);
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
