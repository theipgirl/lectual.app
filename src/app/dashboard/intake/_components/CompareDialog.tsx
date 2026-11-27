"use client";

import { useEffect, useId, useState } from "react";
import { LEADS_COMPARE_FAILED } from "@/lib/ui/words";
import { loadCompareAction } from "../actions";
import CompareView, { type CompareState } from "./CompareView";

export type CompareTarget = { leadId: string; otherId: string; trigger: HTMLElement | null };

/**
 * The "Possible duplicate" compare panel's loading: reads both leads when it opens (one server action, read only); the shared Dialog
 * closes it on Esc, the Close button or the backdrop and puts focus back on the marker that opened it. The two leads are never changed here; a Merge link (owner and admin) goes to the merge screen.
 */
export default function CompareDialog({ target, onClose }: { target: CompareTarget | null; onClose: () => void }) {
  const titleId = useId();
  const [state, setState] = useState<{ key: string; value: CompareState } | null>(null);
  const key = target ? `${target.leadId}:${target.otherId}` : null;

  useEffect(() => {
    if (!target || !key) return;
    let live = true;
    loadCompareAction(target.leadId, target.otherId)
      .then((result) => {
        if (live) setState({ key, value: result.ok ? { status: "ok", data: result.data } : { status: "failed", error: result.error } });
      })
      .catch(() => {
        if (live) setState({ key, value: { status: "failed", error: LEADS_COMPARE_FAILED } });
      });
    return () => {
      live = false;
    };
  }, [target, key]);

  if (!target) return null;
  const shown: CompareState = state && state.key === key ? state.value : { status: "loading" };
  return <CompareView state={shown} titleId={titleId} onClose={onClose} />;
}
