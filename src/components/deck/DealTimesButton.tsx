"use client";

import { useRef } from "react";
import { requestDealTimesDialog } from "@/lib/deal/person-times";
import { DEAL_TIMES_OPEN } from "@/lib/ui/words";

/** The small "Change deal times" link in the deck header. Focus returns to it when the dialog closes. */
export function DealTimesButton() {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button" className="dk-linkbtn" onClick={() => requestDealTimesDialog(window, ref.current)}>
      {DEAL_TIMES_OPEN}
    </button>
  );
}
