"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { hideHubCardAction } from "@/lib/onboarding/hub-actions";

/** Hides the Today card. Optimistic: it goes at once, and a failed save only means it returns on a later visit. */
export function HideHubCard() {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <button
      type="button"
      className="lx-btn lx-btn-ghost lx-btn-sm"
      onClick={() => {
        setHidden(true);
        void hideHubCardAction()
          .catch(() => undefined)
          .finally(() => router.refresh());
      }}
    >
      Hide
    </button>
  );
}
